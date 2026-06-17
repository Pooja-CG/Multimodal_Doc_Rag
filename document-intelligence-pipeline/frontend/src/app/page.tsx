'use client';
import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files);
  };

  const handleUpload = async () => {
    if (!file) return alert("Select a PDF first.");
    setUploadStatus('Parsing document architecture...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://127.0.0.1:8000/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) setUploadStatus(`Ready! Processed ${data.extracted_chunks} structured sections.`);
      else setUploadStatus(`Error: ${data.detail}`);
    } catch {
      setUploadStatus('Failed to connect to backend.');
    }
  };

  const handleSendQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = query;
    setMessages((prev) => [...prev, { role: 'user', text: userMessage }]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok) throw new Error('Generation failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);

      while (true) {
        const chunk = await reader?.read();
        if (chunk?.done) break;
        const text = decoder.decode(chunk?.value);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1].text += text;
          return updated;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex h-screen bg-slate-900 text-slate-100 font-sans">
      <section className="w-1/4 bg-slate-950 p-6 border-r border-slate-800 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-blue-500">
            DocIntel Pipeline
          </h1>
          <p className="text-xs text-slate-400 mt-1">Advanced Layout-Aware RAG Engine</p>
        </div>

        <div className="flex flex-col gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800">
          <label className="text-sm font-medium text-slate-300">Upload Target Document</label>
          <input type="file" accept=".pdf" onChange={handleFileChange} className="text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-300 hover:file:bg-slate-700" />
          <button onClick={handleUpload} className="bg-teal-600 hover:bg-teal-500 text-white font-medium py-2 rounded text-sm transition mt-2 cursor-pointer">
            Ingest & Parse
          </button>
          {uploadStatus && <p className="text-xs text-teal-400 mt-1 font-mono">{uploadStatus}</p>}
        </div>
      </section>

      <section className="flex-1 flex flex-col h-full bg-slate-900">
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              Ingest a data document to initiate structural cross-examinations.
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-2xl px-4 py-3 rounded-lg text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                {msg.text || "Thinking..."}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSendQuery} className="p-4 border-t border-slate-800 bg-slate-950 flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Query document findings..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded px-4 py-2 text-sm focus:outline-none focus:border-teal-500 text-slate-100"
          />
          <button type="submit" disabled={loading} className="bg-gradient-to-r from-teal-500 to-blue-600 hover:opacity-90 px-6 py-2 rounded text-sm font-medium transition disabled:opacity-50 cursor-pointer">
            Query
          </button>
        </form>
      </section>
    </main>
  );
}