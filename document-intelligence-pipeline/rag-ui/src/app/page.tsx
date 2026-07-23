'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Send, UploadCloud, Loader2, Layers } from 'lucide-react';

interface DocumentIndex {
  document_id: string;
  filename: string;
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentIndex[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState<string>('');
  const [conversation, setConversation] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    fetchDocumentsList();
  }, []);

  const fetchDocumentsList = async () => {
    try {
      // 🛠️ HARDCODED FIXED IP: Forces absolute routing via system loopback, skipping DNS interpretation crashes
     // Replace 'backend' with your actual service name from docker-compose.yml
const res = await fetch('http://backend:8000/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
        if (data.length > 0 && !selectedDocId) {
          setSelectedDocId(data[0].document_id);
        }
      }
    } catch (err) {
      console.error('Failed to sync structural repository indexes:', err);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('Processing layout & building vector maps...');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Replace 'backend' with your actual service name from docker-compose.yml
      const res = await fetch('http://backend:8000/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Ingestion engine pipeline crash.');
      }

      const data = await res.json();
      setUploadStatus(`Ready! Processed ${data.extracted_chunks} structural blocks.`);
      setFile(null);
      
      await fetchDocumentsList();
      setSelectedDocId(data.document_id);
    } catch (err: any) {
      setUploadStatus('');
      setErrorMessage(err.message || 'File upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !selectedDocId) return;

    const userMessage = query.trim();
    setQuery('');
    setErrorMessage('');
    setIsGenerating(true);

    setConversation((prev) => [...prev, { role: 'user', text: userMessage }]);
    setConversation((prev) => [...prev, { role: 'assistant', text: '' }]);

    try {
      const res = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          document_id: selectedDocId,
        }),
      });

      if (!res.ok) throw new Error('Generation failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Failed to initialize streaming channels.');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        
        setConversation((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
            updated[lastIndex].text += chunkText;
          }
          return updated;
        });
      }
    } catch (err: any) {
      setErrorMessage('Error: Failed to collect connection streams.');
      setConversation((prev) => prev.filter((msg, idx) => !(idx === prev.length - 1 && msg.text === '')));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-80 bg-slate-900 border-r border-slate-800 p-6 flex flex-col justify-between select-none">
        <div className="space-y-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-cyan-400 flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" /> DocIntel Pipeline
            </h1>
            <p className="text-xs text-slate-400 mt-1">Advanced Multi-RAG Engine</p>
          </div>

          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800 space-y-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-300">Ingest New Document</h2>
            <form onSubmit={handleFileUpload} className="space-y-3">
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer bg-slate-900 border-slate-700 hover:border-cyan-500/50 hover:bg-slate-900/80 transition-all duration-200">
                  <div className="flex flex-col items-center justify-center pt-3 pb-3 text-center px-2">
                    <UploadCloud className="w-6 h-6 text-slate-400 mb-1" />
                    <p className="text-xs text-slate-300 font-medium truncate max-w-[240px]">
                      {file ? file.name : 'Choose File'}
                    </p>
                    {!file && <p className="text-[10px] text-slate-500 mt-0.5">PDF Documents Only</p>}
                  </div>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={!file || isUploading}
                className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-medium text-sm py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/20"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Ingesting...
                  </>
                ) : (
                  'Ingest & Parse'
                )}
              </button>
            </form>

            {uploadStatus && <p className="text-[11px] font-mono text-emerald-400 mt-2">{uploadStatus}</p>}
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase">Active Document Context</h2>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-2">No items inside memory repository index.</p>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.document_id}
                    onClick={() => setSelectedDocId(doc.document_id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs rounded-lg border transition-all duration-150 group ${
                      selectedDocId === doc.document_id
                        ? 'bg-cyan-950/40 border-cyan-500 text-cyan-300 font-medium'
                        : 'bg-slate-950/20 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <FileText className={`w-4 h-4 flex-shrink-0 ${selectedDocId === doc.document_id ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <span className="truncate w-full">{doc.filename}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-600 font-mono tracking-wider border-t border-slate-800/60 pt-4">
          STATUS: IN-MEMORY VECTOR STANDALONE
        </div>
      </aside>

      {/* MAIN CHAT INTERFACE */}
      <main className="flex-1 flex flex-col justify-between bg-slate-950 relative">
        <section className="flex-1 overflow-y-auto p-8 space-y-6">
          {conversation.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-3 select-none">
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800/60 text-cyan-500/80">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-semibold text-slate-200">Interactive Processing Console</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Upload or select an active context layout document container on the sidebar panel. 
                Type target domain logic inquiries below to compute structural intelligence mappings.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {conversation.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-cyan-600 text-white shadow-md font-medium rounded-tr-none'
                        : 'bg-slate-900 text-slate-100 border border-slate-800/80 rounded-tl-none whitespace-pre-wrap shadow-sm'
                    }`}
                  >
                    {msg.text === '' && isGenerating && index === conversation.length - 1 ? (
                      <span className="flex items-center gap-2 text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" /> Connecting to streams...
                      </span>
                    ) : (
                      msg.text
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="max-w-md mx-auto bg-rose-950/40 text-rose-400 text-xs border border-rose-800/60 p-3.5 rounded-xl flex items-center justify-center text-center font-medium">
              {errorMessage}
            </div>
          )}
        </section>

        <footer className="p-6 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent border-t border-slate-900">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSendQuery} className="relative flex items-center">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isGenerating || !selectedDocId}
                placeholder={selectedDocId ? "Query selected document findings..." : "Please ingest or select a document context..."}
                className="w-full bg-slate-900 text-slate-100 placeholder-slate-500 text-sm py-3.5 pl-4 pr-14 rounded-xl border border-slate-800 focus:border-cyan-500/80 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!query.trim() || isGenerating || !selectedDocId}
                className="absolute right-2 p-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white rounded-lg transition-colors disabled:cursor-not-allowed shadow-md"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </footer>
      </main>
    </div>
  );
}