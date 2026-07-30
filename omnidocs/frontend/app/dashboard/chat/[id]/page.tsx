"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "../../../../lib/api";
import { useTheme } from "../../../../lib/theme";
import "../../../homepage.css";

interface Citation {
  content: string;
  page_number?: number;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Citation[];
  created_at?: string;
}

interface Document {
  id: string;
  filename: string;
  file_size: number;
  status: "processing" | "completed" | "failed";
  uploaded_at: string;
}

// Drives the right-hand Inspector panel — which citation is currently
// selected, sourced from a specific message's source list.
interface SelectedCitation {
  citation: Citation;
  messageIndex: number;
  sourceIndex: number;
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { isLoaded, userId, getToken } = useAuth();
  const { theme, toggleTheme } = useTheme();
  
  const documentId = params?.id as string;
  
  const [document, setDocument] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  
  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inspector panel state — tracks which citation is selected, and a
  // monotonically increasing token used to re-trigger the highlight-flash
  // animation on every new selection (even re-selecting the same citation).
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);
  const [flashToken, setFlashToken] = useState(0);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  
  const toggleSources = (index: number) => {
    setExpandedSources((prev) => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Selects a citation to display in the Inspector panel and flashes it.
  const selectCitation = (messageIndex: number, sourceIndex: number, citation: Citation) => {
    setSelectedCitation({ citation, messageIndex, sourceIndex });
    setFlashToken((t) => t + 1);
    setMobileInspectorOpen(true);
  };
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the chat list
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  // Fetch document details to verify ownership and check processing status
  const fetchDocumentDetails = async () => {
    try {
      setIsLoadingDocument(true);
      setError(null);
      const token = await getToken();
      
      // List all documents and find the matching ID (simplifies router endpoint matching)
      const docs: Document[] = await apiFetch("/api/documents", {}, token);
      const currentDoc = docs.find((d) => d.id === documentId);
      
      if (!currentDoc) {
        setError("Document not found or access denied.");
        return;
      }
      
      setDocument(currentDoc);
      
      // If completed, fetch chat history
      if (currentDoc.status === "completed") {
        fetchChatHistory();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load document information.");
    } finally {
      setIsLoadingDocument(false);
    }
  };

  // Fetch chat message history for the document
  const fetchChatHistory = async () => {
    try {
      setIsLoadingChat(true);
      const token = await getToken();
      const history = await apiFetch(`/api/documents/${documentId}/chat`, {}, token);
      setMessages(history);
    } catch (err: any) {
      console.error(err);
      // Don't override main layout error if it's minor
    } finally {
      setIsLoadingChat(false);
    }
  };

  useEffect(() => {
    if (isLoaded && userId && documentId) {
      fetchDocumentDetails();
    }
  }, [isLoaded, userId, documentId]);

  // Poll document status if it is processing
  useEffect(() => {
    if (!document || document.status !== "processing") return;

    const interval = setInterval(async () => {
      try {
        const token = await getToken();
        const docs: Document[] = await apiFetch("/api/documents", {}, token);
        const currentDoc = docs.find((d) => d.id === documentId);
        
        if (currentDoc && currentDoc.status !== "processing") {
          setDocument(currentDoc);
          if (currentDoc.status === "completed") {
            fetchChatHistory();
          }
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Error polling document status:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [document, documentId]);

  // Send a chat message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputMessage.trim();
    if (!query || isSending) return;

    // Clear input
    setInputMessage("");
    
    // Add user message locally for immediate UI update
    const userMsg: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    
    try {
      setIsSending(true);
      setError(null);
      const token = await getToken();
      
      const response = await apiFetch(`/api/documents/${documentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query }),
      }, token);
      
      // Append RAG response
      setMessages((prev) => [...prev, response]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  // Helper to format bytes
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Find the most recent assistant answer that has sources, so the
  // Inspector has something useful to show before any citation is clicked.
  let latestSourcesEntry: { message: Message; index: number } | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.sources && m.sources.length > 0) {
      latestSourcesEntry = { message: m, index: i };
      break;
    }
  }

  const statusTextColor =
    document?.status === "processing" ? "text-amber-600 dark:text-amber-400" : document?.status === "failed" ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-zinc-400";
  const statusDotColor =
    document?.status === "processing" ? "bg-amber-500" : document?.status === "failed" ? "bg-red-600" : "bg-slate-400 dark:bg-zinc-500";

  // Renders the Inspector panel body — shared between the desktop side
  // panel and the mobile bottom sheet.
  const renderInspectorBody = () => {
    if (selectedCitation) {
      const { citation, sourceIndex } = selectedCitation;
      return (
        <div key={`selected-${flashToken}`} className="highlight-flash rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-0.5 rounded-full">
              Source {sourceIndex + 1}
            </span>
            {citation.page_number && (
              <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">pg. {citation.page_number}</span>
            )}
          </div>
          <p className="text-xs font-mono text-slate-400 dark:text-zinc-500 truncate" title={document?.filename}>
            {document?.filename}
          </p>
          <p className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">{citation.content}</p>
        </div>
      );
    }

    if (latestSourcesEntry) {
      return (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 dark:text-zinc-400">Sources cited in the latest answer:</p>
          <div className="space-y-2">
            {latestSourcesEntry.message.sources!.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectCitation(latestSourcesEntry!.index, i, s)}
                className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-zinc-25 dark:bg-slate-900 hover:border-amber-300 dark:hover:border-amber-500/50 hover:bg-amber-50/60 dark:hover:bg-amber-500/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-mono text-amber-700 dark:text-amber-300">Source {i + 1}</span>
                  {s.page_number && <span className="text-xs font-mono text-slate-400 dark:text-zinc-500">pg. {s.page_number}</span>}
                </div>
                <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed line-clamp-2">{s.content}</p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-10 px-4">
        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-300">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-sm text-slate-400 dark:text-zinc-400">Click a citation to see its source passage.</p>
      </div>
    );
  };

  if (!isLoaded || isLoadingDocument) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-slate-900 dark:text-zinc-100 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-amber-200 dark:border-amber-500/20 border-t-amber-500 animate-spin" />
          <p className="text-sm text-slate-400 dark:text-zinc-400">Loading document…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-slate-900 text-slate-900 dark:text-zinc-100 font-sans antialiased">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 h-16 shrink-0">
        <div className="max-w-6xl mx-auto px-6 h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 mr-1 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-300 shrink-0">
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-medium text-lg text-slate-900 dark:text-zinc-100 truncate max-w-xs sm:max-w-md md:max-w-lg" title={document?.filename}>
                {document?.filename}
              </h1>
              {document && (
                <p className="text-xs text-slate-400 dark:text-zinc-400 flex items-center gap-1.5 font-mono">
                  <span>{formatFileSize(document.file_size)}</span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className={`inline-flex items-center gap-1.5 font-medium ${statusTextColor}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor} ${document.status === "processing" ? "animate-pulse" : ""}`} />
                    {document.status.toUpperCase()}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-zinc-50 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 cursor-pointer"
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <Link href="/dashboard" className="px-4 h-9 flex items-center justify-center rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-slate-700 transition-colors shrink-0">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Error notification */}
      {error && (
        <div className="max-w-6xl w-full mx-auto px-6 pt-4 shrink-0">
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold ml-4 cursor-pointer">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Layout Area: canvas + inspector */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row max-w-6xl w-full mx-auto overflow-hidden">
        {/* Processing State */}
        {document && document.status === "processing" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 p-6">
            <div className="w-16 h-16 border-4 border-amber-200 dark:border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <div className="space-y-2 max-w-sm">
              <h3 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Indexing document chunks…</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                We are currently extracting text, dividing it into segments, and compiling vector embeddings. This normally takes a few seconds.
              </p>
            </div>
            <button 
              onClick={fetchDocumentDetails}
              className="px-6 h-10 flex items-center justify-center rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium transition-colors cursor-pointer"
            >
              Check status now
            </button>
          </div>
        ) : document && document.status === "failed" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 p-6">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-center justify-center text-red-600 dark:text-red-300">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-2 max-w-sm">
              <h3 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Indexing failed</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                We encountered an error during text parsing or embedding generation. Scanned PDFs containing only images or corrupt files cannot be indexed.
              </p>
            </div>
            <Link 
              href="/dashboard"
              className="px-6 h-10 flex items-center justify-center rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
            >
              Return to dashboard
            </Link>
          </div>
        ) : (
          <>
            {/* Main Canvas */}
            <main className="flex-1 min-h-0 flex flex-col overflow-hidden border-r border-slate-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-900">
              <div className="px-6 pt-5 pb-3 shrink-0">
                <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Chat with this document</h2>
                <p className="text-xs text-slate-400 dark:text-zinc-400">Ask a question and every answer is grounded in a cited passage.</p>
              </div>

              {/* Messages Scroll Container */}
              <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5 flex flex-col">
                {messages.length === 0 && !isLoadingChat && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 dark:text-zinc-400 gap-4 max-w-sm mx-auto">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-300">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <h4 className="font-display font-medium text-slate-800 dark:text-zinc-100 text-lg">Ask a question</h4>
                    <p className="text-sm text-slate-500 dark:text-zinc-400 leading-relaxed">
                      Start chatting with this document. Ask questions, query definitions, request summaries, or compile insights.
                    </p>
                  </div>
                )}

                {isLoadingChat && (
                  <div className="flex-1 flex flex-col justify-center gap-3">
                    <div className="h-16 w-2/3 rounded-2xl shimmer-bg" />
                    <div className="h-16 w-1/2 rounded-2xl shimmer-bg self-end" />
                    <div className="h-16 w-3/5 rounded-2xl shimmer-bg" />
                  </div>
                )}

                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 max-w-[85%] animate-fade-up ${
                      msg.role === "user" ? "self-end flex-row-reverse" : "self-start"
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        msg.role === "user"
                          ? "bg-zinc-200 dark:bg-slate-700 text-slate-600 dark:text-zinc-300"
                          : "bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-300"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      className={`min-w-0 px-4 py-3 rounded-2xl border ${
                        msg.role === "user"
                          ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-slate-800 dark:text-zinc-100 rounded-tr-sm"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-zinc-300 rounded-tl-sm shadow-sm"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="text-sm leading-relaxed">
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-zinc-100">{children}</strong>,
                              em: ({ children }) => <em className="italic text-slate-600 dark:text-zinc-400">{children}</em>,
                              ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 pl-2">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 pl-2">{children}</ol>,
                              li: ({ children }) => <li className="text-slate-700 dark:text-zinc-300">{children}</li>,
                              code: ({ children }) => <code className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono text-xs">{children}</code>,
                              pre: ({ children }) => <pre className="my-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-x-auto text-xs font-mono">{children}</pre>,
                              h1: ({ children }) => <h1 className="font-display text-base font-medium text-slate-900 dark:text-zinc-100 mt-3 mb-1">{children}</h1>,
                              h2: ({ children }) => <h2 className="font-display text-sm font-medium text-slate-900 dark:text-zinc-100 mt-3 mb-1">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mt-2 mb-1">{children}</h3>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-amber-300 dark:border-amber-500/40 pl-3 italic text-slate-500 dark:text-zinc-400 my-2">{children}</blockquote>,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      )}

                      {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => toggleSources(index)}
                            className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 transition-colors flex items-center gap-1 cursor-pointer focus:outline-hidden"
                          >
                            <svg
                              className={`w-3.5 h-3.5 transform transition-transform duration-200 ${
                                expandedSources[index] ? "rotate-90" : ""
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {expandedSources[index] ? "Hide sources" : `${msg.sources.length} source${msg.sources.length > 1 ? "s" : ""}`}
                          </button>

                          {expandedSources[index] && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {msg.sources.map((source, srcIdx) => {
                                const isSelected =
                                  selectedCitation?.messageIndex === index && selectedCitation?.sourceIndex === srcIdx;
                                return (
                                  <button
                                    key={srcIdx}
                                    type="button"
                                    onClick={() => selectCitation(index, srcIdx, source)}
                                    title={source.content}
                                    className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-full border transition-colors cursor-pointer ${
                                      isSelected
                                        ? "bg-amber-100 dark:bg-amber-500/20 border-amber-400 dark:border-amber-500/50 text-amber-900 dark:text-amber-200 ring-1 ring-amber-400 dark:ring-amber-500/50"
                                        : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
                                    }`}
                                  >
                                    <span>#{srcIdx + 1}</span>
                                    {source.page_number && <span className="text-amber-600 dark:text-amber-400">· p.{source.page_number}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="flex gap-3 max-w-[85%] self-start animate-fade-up">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-300 shrink-0 mt-0.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-zinc-400 rounded-tl-sm shadow-sm flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-xs pl-1">OmniDocs is synthesizing context…</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Form Footer */}
              <form onSubmit={handleSendMessage} className="border-t border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800 shrink-0">
                <div className="max-w-3xl mx-auto flex items-center gap-2 p-1.5 rounded-full bg-zinc-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus-within:border-amber-400 dark:focus-within:border-amber-500 transition-colors">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Ask about the document content..."
                    className="flex-1 min-w-0 h-10 px-4 bg-transparent focus:outline-hidden text-sm text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500"
                    disabled={isSending}
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || isSending}
                    className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-600 flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shrink-0"
                  >
                    <svg className="w-4.5 h-4.5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9-7-9-7v14z" />
                    </svg>
                  </button>
                </div>
              </form>
            </main>

            {/* Inspector — desktop side panel */}
            <aside className="hidden md:flex md:flex-col w-96 shrink-0 bg-white dark:bg-slate-800 overflow-hidden">
              <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Inspector</h2>
                <p className="text-xs text-slate-400 dark:text-zinc-400">Selected citation</p>
              </div>
              <div className="flex-1 overflow-y-auto p-5">{renderInspectorBody()}</div>
            </aside>

            {/* Inspector — mobile toggle + bottom sheet */}
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setMobileInspectorOpen(true)}
                className="fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-lg flex items-center justify-center cursor-pointer"
                title="Open inspector"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {selectedCitation && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />
                )}
              </button>

              {mobileInspectorOpen && (
                <div className="fixed inset-0 z-40 flex flex-col justify-end">
                  <div
                    className="absolute inset-0 bg-slate-900/30"
                    onClick={() => setMobileInspectorOpen(false)}
                  />
                  <div className="relative bg-white dark:bg-slate-800 rounded-t-2xl border-t border-slate-200 dark:border-slate-700 max-h-[70vh] flex flex-col shadow-xl">
                    <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
                      <div>
                        <h2 className="font-display text-base font-medium text-slate-900 dark:text-zinc-100">Inspector</h2>
                        <p className="text-xs text-slate-400 dark:text-zinc-400">Selected citation</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileInspectorOpen(false)}
                        className="p-2 rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">{renderInspectorBody()}</div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
