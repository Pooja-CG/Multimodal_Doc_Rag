import os
import shutil
import uuid
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from llama_parse import LlamaParse
from flashrank import Ranker, RerankRequest
from google import genai

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

load_dotenv()

# Setup global structural variables
client = None
qdrant_client = None
ranker = None
COLLECTION_NAME = "multidoc_chunks"


def get_gemini_embedding(text: str) -> list[float]:
    """Generates 768-dimensional vector embedding for a single string (used by chat query)."""
    if not client:
        raise RuntimeError("Gemini client is not initialized.")
    response = client.models.embed_content(
        model="text-embedding-004",
        contents=text,
    )
    return response.embedding.values


def get_gemini_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generates 768-dimensional vector embeddings in batched network calls for fast document ingestion."""
    if not client:
        raise RuntimeError("Gemini client is not initialized.")
    if not texts:
        return []
    
    response = client.models.embed_content(
        model="text-embedding-004",
        contents=texts,
    )
    return [e.values for e in response.embeddings]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages application lifecycle context smoothly across runtime reloads."""
    global client, qdrant_client
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("⚠️ WARNING: GEMINI_API_KEY is missing from your environment configurations.")
        
        # Initialize Google GenAI official SDK client wrapper
        client = genai.Client(api_key=api_key)
        
        # Initialize In-Memory isolated Vector Storage driver
        qdrant_client = QdrantClient(location=":memory:")
        
        # text-embedding-004 produces 768-dimensional vectors
        if not qdrant_client.collection_exists(collection_name=COLLECTION_NAME):
            qdrant_client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE),
            )
        print("🚀 Infrastructure Startup Verification Complete. Systems Operational.")
        
    except Exception as init_err:
        print(f"❌ INFRASTRUCTURE BOOT ERROR: {str(init_err)}")
        traceback.print_exc()
        
    yield
    
    if qdrant_client:
        qdrant_client.close()


# Initialize FastAPI app with lifespan handler
app = FastAPI(title="Multi-Document Intelligence Pipeline", lifespan=lifespan)

# Add CORS middleware to allow cross-origin requests from Vercel/local frontends
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (or specify your Vercel URL)
    allow_credentials=True,
    allow_methods=["*"],  # Allows GET, POST, OPTIONS, etc.
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    document_id: str


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """Handles PDF ingestion, structural text parsing, chunk embedding, and storage maps."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    os.makedirs("data", exist_ok=True)
    temp_path = os.path.abspath(f"data/{file.filename}")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    if not os.getenv("LLAMA_CLOUD_API_KEY"):
        raise HTTPException(status_code=500, detail="LLAMA_CLOUD_API_KEY is missing from your environment.")
        
    try:
        parser = LlamaParse(result_type="markdown")
        parsed_docs = parser.load_data(temp_path)
        
        raw_text = "\n\n".join([doc.text for doc in parsed_docs])
        paragraphs = raw_text.split("\n\n")
        
        # Clean & filter meaningful paragraphs (> 50 chars)
        clean_paras = [p.strip() for p in paragraphs if len(p.strip()) > 50]
        
        doc_id = str(uuid.uuid4())
        points = []
        
        if clean_paras:
            # FAST BATCH EMBEDDING: Process in batches of 20 paragraphs at once
            batch_size = 20
            all_vectors = []
            
            for i in range(0, len(clean_paras), batch_size):
                batch_text = clean_paras[i:i + batch_size]
                batch_vectors = get_gemini_embeddings_batch(batch_text)
                all_vectors.extend(batch_vectors)

            # Build Qdrant structs quickly
            for para, vector in zip(clean_paras, all_vectors):
                points.append(
                    PointStruct(
                        id=str(uuid.uuid4()),
                        vector=vector,
                        payload={
                            "text": para, 
                            "filename": file.filename,
                            "document_id": doc_id
                        }
                    )
                )
        
        if points:
            qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points)
                
        return {
            "status": "Success", 
            "document_id": doc_id,
            "filename": file.filename,
            "extracted_chunks": len(points)
        }
    except Exception as e:
        print(f"❌ PARSING ERROR EXCEPTION: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documents")
async def get_uploaded_documents():
    """Scans structural metadata maps to return a library catalog list."""
    try:
        if not qdrant_client:
            return []
        scroll_results = qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            limit=100,
            with_payload=True,
            with_vectors=False
        )[0]
        
        seen_docs = {}
        for point in scroll_results:
            p_load = point.payload
            if p_load and "document_id" in p_load and p_load["document_id"] not in seen_docs:
                seen_docs[p_load["document_id"]] = p_load["filename"]
                
        return [{"document_id": d_id, "filename": name} for d_id, name in seen_docs.items()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat_pipeline(request: ChatRequest):
    """Queries structural context matrices, executes cross-encoder reranking, and streams answers."""
    global ranker
    try:
        if not qdrant_client:
            raise HTTPException(status_code=500, detail="Core vector store uninitialized.")

        query_vector = get_gemini_embedding(request.message)
        
        doc_filter = Filter(
            must=[
                FieldCondition(
                    key="document_id",
                    match=MatchValue(value=request.document_id)
                )
            ]
        )
        
        response_data = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            query_filter=doc_filter,
            limit=15
        )
        
        search_results = []
        if hasattr(response_data, "points"):
            search_results = response_data.points
        elif isinstance(response_data, dict) and "points" in response_data:
            search_results = response_data["points"]
        elif isinstance(response_data, list):
            search_results = response_data
        else:
            search_results = getattr(response_data, "scored_points", [])

        if not search_results:
            raise HTTPException(status_code=400, detail="Target document context empty or unreachable.")
        
        retrieved_passages = []
        for idx, hit in enumerate(search_results):
            payload = getattr(hit, "payload", None) if not isinstance(hit, dict) else hit.get("payload")
            if payload and "text" in payload:
                retrieved_passages.append({"id": idx, "text": payload["text"]})
        
        if not retrieved_passages:
            raise HTTPException(status_code=400, detail="No readable content found within matching structures.")

        # Lazy load FlashRank reranker
        if ranker is None:
            ranker = Ranker(model_name="ms-marco-MiniLM-L-12-v2")

        # Compute neural relevance via FlashRank Cross-Encoder
        rerank_req = RerankRequest(query=request.message, passages=retrieved_passages)
        reranked_results = ranker.rerank(rerank_req)
        
        top_contexts = []
        for item in reranked_results[:4]:
            if isinstance(item, dict):
                text_content = item.get('text') or item.get('body')
            else:
                text_content = getattr(item, 'text', None) or getattr(item, 'body', None)
            if text_content:
                top_contexts.append(text_content)

        context_str = "\n---\n".join(top_contexts) if top_contexts else "No context available."
        
        system_instruction = (
            "You are an advanced document intelligence system. Answer the user prompt based "
            "ONLY on the context provided below. If the answer cannot be found in the context, "
            "say 'I cannot find that in the uploaded document.' Do not make up facts.\n\n"
            f"CONTEXT:\n{context_str}"
        )
        
        if not client:
            raise HTTPException(status_code=500, detail="Gemini SDK wrapper client is unavailable.")

        def response_generator():
            try:
                response_stream = client.models.generate_content_stream(
                    model='gemini-2.5-flash',
                    contents=request.message,
                    config={'system_instruction': system_instruction}
                )
                for chunk in response_stream:
                    if chunk.text is not None:
                        yield chunk.text
            except Exception as stream_err:
                print(f"❌ GENERATOR STREAM EXCEPTION: {str(stream_err)}")
                yield f"\n[Streaming error: {str(stream_err)}]"

        return StreamingResponse(response_generator(), media_type="text/plain")

    except HTTPException as he:
        print(f"⚠️ HTTP PIPELINE BUBBLE: {he.detail}")
        raise he
    except Exception as e:
        print(f"❌ REASON FOR GENERATION 500 CRASH: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal Execution Failure: {str(e)}")