"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import "../homepage.css";

interface Document {
  id: string;
  filename: string;
  file_size: number;
  status: "processing" | "completed" | "failed";
  uploaded_at: string;
}

interface WorkspaceDoc {
  id: string;
  filename: string;
  file_size: number;
}

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  documents: WorkspaceDoc[];
}

export default function DashboardPage() {
  const { isLoaded, userId, getToken } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Workspace creation modal state
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<"documents" | "workspaces">("documents");

  const fetchDocuments = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      setError(null);
      const token = await getToken();
      const docs = await apiFetch("/api/documents", {}, token);
      setDocuments(docs);
    } catch (err: any) {
      console.error(err);
      if (!silent) setError(err.message || "Failed to load documents.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const fetchWorkspaces = async () => {
    try {
      const token = await getToken();
      const ws = await apiFetch("/api/workspaces", {}, token);
      setWorkspaces(ws);
    } catch (err: any) {
      console.error(err);
    }
  };

  // Initial load
  useEffect(() => {
    if (isLoaded && userId) {
      fetchDocuments();
      fetchWorkspaces();
    }
  }, [isLoaded, userId]);

  // Auto-poll every 3s while any document is still processing
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(() => fetchDocuments(true), 3000);
    return () => clearInterval(interval);
  }, [documents]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setIsUploading(true);
      setError(null);
      const token = await getToken();
      await apiFetch("/api/documents", { method: "POST", body: formData }, token);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchDocuments();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to upload document.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      setError(null);
      const token = await getToken();
      await apiFetch(`/api/documents/${id}`, { method: "DELETE" }, token);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete document.");
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm("Delete this workspace? This will not delete the source documents.")) return;
    try {
      setError(null);
      const token = await getToken();
      await apiFetch(`/api/workspaces/${id}`, { method: "DELETE" }, token);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== id));
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete workspace.");
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateWorkspace = async () => {
    const name = workspaceName.trim();
    if (!name) { setError("Please enter a workspace name."); return; }
    if (selectedIds.size < 1) { setError("Please select at least one document."); return; }
    try {
      setIsCreatingWorkspace(true);
      setError(null);
      const token = await getToken();
      const ws = await apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, document_ids: Array.from(selectedIds) }),
      }, token);
      setShowWorkspaceModal(false);
      setWorkspaceName("");
      setSelectedIds(new Set());
      await fetchWorkspaces();
      router.push(`/dashboard/workspaces/${ws.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to create workspace.");
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return dateStr; }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-slate-800 dark:text-zinc-100 flex items-center justify-center font-sans">
        <div className="w-10 h-10 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin" />
      </div>
    );
  }

  const completedDocs = documents.filter(d => d.status === "completed");
  const selectedCount = selectedIds.size;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-slate-800 dark:text-zinc-100 font-sans antialiased selection:bg-amber-200 selection:text-slate-900">
      {/* Dashboard Header */}
      <header className="border-b border-zinc-200 dark:border-slate-700 bg-zinc-50/90 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition-colors">
              <span className="font-display font-semibold text-lg text-zinc-50">Ω</span>
            </Link>
            <span className="font-display font-semibold text-xl tracking-tight text-slate-900 dark:text-zinc-100">
              OmniDocs Dashboard
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="px-4 h-9 flex items-center justify-center rounded-lg text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-slate-800 transition-colors">
              Home
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2 rounded-lg border border-zinc-200 dark:border-slate-700 hover:bg-zinc-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 cursor-pointer"
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
            <div className="pl-2 border-l border-zinc-200 dark:border-slate-700 flex items-center">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Area */}
      <main className="max-w-7xl mx-auto px-6 py-12 space-y-10">

        <div>
          <h1 className="font-display text-[32px] font-medium text-slate-900 dark:text-zinc-100 tracking-tight">Document Library</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Upload sources, track processing, and group documents into workspaces for cross-document comparison.</p>
        </div>

        {/* Error notification */}
        {error && (
          <div className="p-4 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm flex items-center justify-between animate-fade-up">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200 font-bold ml-4 cursor-pointer">✕</button>
          </div>
        )}

        {/* Upload Zone */}
        <section className="relative p-10 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-slate-700 bg-zinc-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:border-amber-400 dark:hover:border-amber-500/30 transition-colors group">
          <div className="max-w-xl mx-auto text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-xl bg-zinc-50 dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 flex items-center justify-center text-amber-600 dark:text-amber-300 group-hover:border-amber-300 dark:group-hover:border-amber-500/30 group-hover:bg-amber-50 dark:group-hover:bg-amber-500/10 transition-colors">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Upload PDF Document</h2>
              <p className="text-sm text-slate-600 dark:text-zinc-400">Drag &amp; drop or select a PDF file to index and add to your document library. Only PDF files up to 20MB are supported.</p>
            </div>
            <div className="flex items-center justify-center">
              <input type="file" accept=".pdf" onChange={handleUpload} ref={fileInputRef} className="hidden" id="pdf-file-input" disabled={isUploading} />
              <label
                htmlFor="pdf-file-input"
                className={`px-8 h-11 flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 font-medium text-white transition-colors cursor-pointer ${isUploading ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
              >
                {isUploading && <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {isUploading ? "Processing & Uploading..." : "Choose PDF File"}
              </label>
            </div>
          </div>
        </section>

        {/* Multi-select action bar (floating, appears when items selected) */}
        {selectedCount > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-6 py-3 rounded-xl bg-zinc-50 dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 shadow-lg animate-fade-up">
            <span className="text-sm text-slate-700 dark:text-zinc-400">
              <span className="text-slate-900 dark:text-zinc-100 font-semibold">{selectedCount}</span> doc{selectedCount !== 1 ? "s" : ""} selected
            </span>
            <button
              onClick={() => setShowWorkspaceModal(true)}
              className="flex items-center gap-2 px-4 h-9 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Create Comparison Workspace
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 w-fit">
          {(["documents", "workspaces"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 h-9 rounded-md text-sm font-medium capitalize transition-colors cursor-pointer ${
                activeTab === tab
                  ? tab === "documents"
                    ? "bg-zinc-50 dark:bg-slate-900 text-slate-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-slate-700"
                    : "bg-zinc-50 dark:bg-slate-900 text-slate-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-slate-700"
                  : "text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100"
              }`}
            >
              {tab === "documents" ? `Documents (${documents.length})` : `Workspaces (${workspaces.length})`}
            </button>
          ))}
        </div>

        {/* --- DOCUMENTS TAB --- */}
        {activeTab === "documents" && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Your PDF Documents</h2>
                {selectedCount > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    {selectedCount} selected — use the action bar below to compare
                  </p>
                )}
              </div>
              <button
                onClick={() => fetchDocuments()}
                className="p-2 rounded-lg border border-zinc-200 dark:border-slate-700 hover:bg-zinc-100 dark:hover:bg-slate-800 hover:border-zinc-300 dark:hover:border-slate-600 transition-colors cursor-pointer text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100"
                title="Refresh document list"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[68px] rounded-xl border border-zinc-200 dark:border-slate-700 shimmer-bg" />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4 border border-dashed border-zinc-300 dark:border-slate-700 rounded-xl bg-zinc-100 dark:bg-slate-800 text-center">
                <div className="w-14 h-14 rounded-xl bg-zinc-50 dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 flex items-center justify-center text-amber-600 dark:text-amber-300 mb-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="font-display text-lg font-medium text-slate-800 dark:text-zinc-100">No documents yet</p>
                <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-sm">Upload a PDF to get started.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-800 overflow-hidden">
                {/* List header */}
                <div className="flex items-center gap-4 px-5 py-3 border-b border-zinc-200 dark:border-slate-700 bg-zinc-100 dark:bg-slate-900 text-xs uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-medium">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-amber-500 cursor-pointer shrink-0"
                    checked={selectedIds.size === completedDocs.length && completedDocs.length > 0}
                    onChange={() => {
                      if (selectedIds.size === completedDocs.length) setSelectedIds(new Set());
                      else setSelectedIds(new Set(completedDocs.map(d => d.id)));
                    }}
                  />
                  <span className="flex-1">Document</span>
                  <span className="w-20 hidden sm:block text-right">Size</span>
                  <span className="w-24 text-right sm:text-left">Status</span>
                  <span className="w-36 hidden md:block">Uploaded</span>
                  <span className="w-[104px] text-right">Actions</span>
                </div>

                <div className="divide-y divide-zinc-200 dark:divide-slate-700">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-4 px-5 py-4 transition-colors ${selectedIds.has(doc.id) ? "bg-amber-50 dark:bg-amber-500/10" : "hover:bg-zinc-100 dark:hover:bg-slate-700"}`}
                    >
                      <div className="w-4 shrink-0">
                        {doc.status === "completed" && (
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-amber-500 cursor-pointer"
                            checked={selectedIds.has(doc.id)}
                            onChange={() => handleToggleSelect(doc.id)}
                          />
                        )}
                      </div>

                      <div className="flex-1 flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-zinc-400 shrink-0">
                          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-zinc-100 truncate" title={doc.filename}>{doc.filename}</p>
                          <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 sm:hidden">{formatFileSize(doc.file_size)}</p>
                        </div>
                      </div>

                      <span className="w-20 hidden sm:block text-xs font-mono text-slate-500 dark:text-zinc-400 text-right">{formatFileSize(doc.file_size)}</span>

                      <div className="w-24 flex sm:justify-start justify-end">
                        {doc.status === "completed" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                            Ready
                          </span>
                        ) : doc.status === "processing" ? (
                          <span className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30 overflow-hidden">
                            <span className="absolute inset-0 shimmer-bg opacity-30" />
                            <span className="relative w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            <span className="relative">Processing</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Failed
                          </span>
                        )}
                      </div>

                      <span className="w-36 hidden md:block text-xs font-mono text-slate-500 dark:text-zinc-400">{formatDate(doc.uploaded_at)}</span>

                      <div className="w-[104px] flex items-center justify-end gap-2">
                        <Link
                          href={`/dashboard/chat/${doc.id}`}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                            doc.status === "completed"
                              ? "bg-slate-800 border-slate-800 hover:bg-slate-700 text-zinc-50 cursor-pointer"
                              : "bg-zinc-100 dark:bg-slate-800 border-zinc-200 dark:border-slate-700 text-slate-400 dark:text-zinc-500 cursor-not-allowed pointer-events-none"
                          } transition-colors`}
                        >
                          Chat
                        </Link>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="p-1.5 rounded-lg border border-zinc-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-500/30 text-slate-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Delete document"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span className="sr-only">Delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- WORKSPACES TAB --- */}
        {activeTab === "workspaces" && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Comparison Workspaces</h2>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Group multiple documents to compare and cross-reference insights.</p>
              </div>
              <button
                onClick={() => { setActiveTab("documents"); }}
                className="flex items-center gap-2 px-4 h-9 rounded-lg bg-teal-50 dark:bg-teal-500/10 hover:bg-teal-100 dark:hover:bg-teal-500/20 border border-teal-200 dark:border-teal-500/30 text-sm font-medium text-teal-700 dark:text-teal-300 hover:text-teal-800 dark:hover:text-teal-200 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Workspace
              </button>
            </div>

            {workspaces.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center gap-4 border border-dashed border-zinc-300 dark:border-slate-700 rounded-xl bg-zinc-100 dark:bg-slate-800 text-center">
                <div className="w-14 h-14 rounded-xl bg-zinc-50 dark:bg-slate-900 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 mb-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <p className="font-display text-lg font-medium text-slate-800 dark:text-zinc-100">No workspaces yet</p>
                <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-sm">Select multiple documents from the Documents tab and click "Create Comparison Workspace".</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="group relative p-6 rounded-xl border border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-800 hover:border-teal-300 dark:hover:border-teal-500/30 transition-colors"
                  >
                    {/* Workspace header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-10 h-10 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 shrink-0">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <button
                        onClick={() => handleDeleteWorkspace(ws.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="Delete workspace"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    <h3 className="font-display font-medium text-slate-900 dark:text-zinc-100 text-lg mb-1 truncate">{ws.name}</h3>
                    <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 mb-4">{formatDate(ws.created_at)}</p>

                    {/* Document chips */}
                    <div className="flex flex-wrap gap-1.5 mb-5">
                      {ws.documents.map((doc) => (
                        <span key={doc.id} className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-zinc-400 truncate max-w-[120px]" title={doc.filename}>
                          {doc.filename}
                        </span>
                      ))}
                    </div>

                    <Link
                      href={`/dashboard/workspaces/${ws.id}`}
                      className="flex items-center justify-center gap-2 w-full h-9 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Open Workspace Chat
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Workspace Creation Modal */}
      {showWorkspaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-800 shadow-xl p-8 space-y-6 animate-fade-up">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100 mb-1">Create Comparison Workspace</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400">
                  Name this workspace. It will group <span className="text-slate-800 dark:text-zinc-200 font-medium">{selectedCount} document{selectedCount !== 1 ? "s" : ""}</span> for multi-document comparison.
                </p>
              </div>
            </div>

            {/* Preview selected documents */}
            <div className="flex flex-wrap gap-1.5">
              {documents.filter(d => selectedIds.has(d.id)).map(doc => (
                <span key={doc.id} className="px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 text-teal-700 dark:text-teal-300 text-xs font-mono truncate max-w-[150px]" title={doc.filename}>
                  {doc.filename}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300">Workspace Name</label>
              <input
                autoFocus
                type="text"
                placeholder="e.g. Q3 Research Reports"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateWorkspace(); }}
                className="w-full h-11 px-4 rounded-lg bg-zinc-50 dark:bg-slate-900 border border-zinc-300 dark:border-slate-700 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-teal-500 transition-colors text-sm"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowWorkspaceModal(false); setWorkspaceName(""); }}
                className="flex-1 h-11 rounded-lg border border-zinc-300 dark:border-slate-700 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkspace}
                disabled={isCreatingWorkspace || !workspaceName.trim()}
                className="flex-1 h-11 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingWorkspace ? "Creating..." : "Create & Open"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
