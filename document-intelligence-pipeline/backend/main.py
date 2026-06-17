import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from llama_parse import LlamaParse
from flashrank import Ranker, RerankRequest
from google import genai

load_dotenv()

app = FastAPI(title="Document Intelligence Pipeline")

# Enable CORS so your Next.js frontend can talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Developer APIs & Reranker
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
ranker = Ranker(model_name="ms-marco-MiniLM-L-12-v2")  # <-- Changed to 12-layer version

# In-memory store to hold document chunks for this session
DOCUMENT_CHUNKS = []

class ChatRequest(BaseModel):
    message: str

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """Handles PDF ingestion, structured Markdown layout extraction, and chunking."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    # Ensure BOTH absolute and relative directories exist to prevent path errors
    os.makedirs("data", exist_ok=True)
    os.makedirs("../data", exist_ok=True)
    
    temp_path = os.path.abspath(f"data/{file.filename}")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Check for keys early so we don't hit an abstract error object
    if not os.getenv("LLAMA_CLOUD_API_KEY"):
        raise HTTPException(status_code=500, detail="LLAMA_CLOUD_API_KEY is missing from your .env file.")
        
    try:
        # Advanced layout-aware parsing using LlamaParse
        parser = LlamaParse(result_type="markdown")
        parsed_docs = parser.load_data(temp_path)
        
        global DOCUMENT_CHUNKS
        DOCUMENT_CHUNKS = [] # Clear old chunks
        
        raw_text = parsed_docs.text
        paragraphs = raw_text.split("\n\n")
        
        for idx, para in enumerate(paragraphs):
            if len(para.strip()) > 50: 
                DOCUMENT_CHUNKS.append({"id": idx, "text": para.strip()})
                
        return {"status": "Success", "extracted_chunks": len(DOCUMENT_CHUNKS), "filename": file.filename}
    
    except Exception as e:
        # Print the exact failure reason directly to your terminal logs
        print(f"--- PARSING CRITICAL ERROR: {str(e)} ---")
        raise HTTPException(status_code=500, detail=f"Parsing Failed: {str(e)}")

@app.post("/chat")
async def chat_pipeline(request: ChatRequest):
    """Executes a two-stage high-precision Reranking flow followed by generation."""
    if not DOCUMENT_CHUNKS:
        raise HTTPException(status_code=400, detail="No document processed yet. Please upload a file first.")
    
    try:
        # Cross-Encoder Reranking over our layout chunks
        rerank_req = RerankRequest(query=request.message, passages=DOCUMENT_CHUNKS)
        reranked_results = ranker.rerank(rerank_req)
        
        # Select the top 4 highly relevant context pieces
        top_contexts = [item['text'] for item in reranked_results[:4]]
        context_str = "\n---\n".join(top_contexts)
        
        # Grounding instruction for the LLM
        system_instruction = (
            "You are an advanced document intelligence system. Answer the user prompt based "
            "ONLY on the context provided below. If the answer cannot be found in the context, "
            "say 'I cannot find that in the uploaded document.' Do not make up facts.\n\n"
            f"CONTEXT:\n{context_str}"
        )
        
        # Stream responses live using the new google-genai SDK
        def response_generator():
            response_stream = client.models.generate_content_stream(
                model='gemini-2.5-flash',
                contents=request.message,
                config={'system_instruction': system_instruction}
            )
            for chunk in response_stream:
                yield chunk.text

        return StreamingResponse(response_generator(), media_type="text/plain")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")