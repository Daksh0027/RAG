"use client";

import { Fragment, useEffect, useState, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { apiFetch } from "../../../../lib/api";
import { useTheme } from "../../../../lib/theme";

interface Citation {
  content: string;
  page_number?: number;
  filename?: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Citation[];
  created_at?: string;
}

interface WorkspaceDoc {
  id: string;
  filename: string;
  file_size: number;
  status: string;
}

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  documents: WorkspaceDoc[];
}

// --- New types for the Compare feature & Inspector selection ---

type CompareStatus = "match" | "conflict" | "unique" | "missing";

interface CompareValue {
  document_id: string;
  filename: string;
  value: string | null;
  page_number?: number | null;
  status: CompareStatus;
}

interface CompareRow {
  field: string;
  values: CompareValue[];
}

interface CompareResult {
  fields: string[];
  rows: CompareRow[];
}

type InspectorSelection =
  | {
      type: "cell";
      field: string;
      document_id: string;
      filename: string;
      page_number?: number | null;
      value: string | null;
      status: CompareStatus;
    }
  | {
      type: "citation";
      filename?: string;
      page_number?: number;
      excerpt: string;
    };

export default function WorkspaceChatPage() {
  const params = useParams();
  const { isLoaded, userId, getToken } = useAuth();

  const workspaceId = params?.id as string;

  const { theme, toggleTheme } = useTheme();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add documents state
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [allDocs, setAllDocs] = useState<WorkspaceDoc[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);

  // --- New state: three-column canvas ---
  const [canvasTab, setCanvasTab] = useState<"compare" | "ask">("compare");
  const [mobileSection, setMobileSection] = useState<"sidebar" | "canvas" | "inspector">("canvas");
  const [showConnections, setShowConnections] = useState(false);

  // --- New state: Extract & Compare ---
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [isLoadingCompare, setIsLoadingCompare] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [hasLoadedCompare, setHasLoadedCompare] = useState(false);
  const [customFields, setCustomFields] = useState("");

  // --- New state: Inspector selection ---
  const [inspectorSelection, setInspectorSelection] = useState<InspectorSelection | null>(null);
  const [highlightTick, setHighlightTick] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  const fetchWorkspace = async () => {
    try {
      setIsLoadingWorkspace(true);
      setError(null);
      const token = await getToken();
      const ws: Workspace = await apiFetch(`/api/workspaces/${workspaceId}`, {}, token);
      setWorkspace(ws);
      // Load chat history
      const history: Message[] = await apiFetch(`/api/workspaces/${workspaceId}/chat`, {}, token);
      setMessages(history);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load workspace.");
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const fetchAllDocs = async () => {
    try {
      const token = await getToken();
      const docs = await apiFetch("/api/documents", {}, token);
      setAllDocs(docs.filter((d: any) => d.status === "completed"));
    } catch (err: any) {
      console.error(err);
    }
  };

  const openDocPicker = async () => {
    if (workspace) {
      setPickerSelected(new Set(workspace.documents.map((d) => d.id)));
    }
    await fetchAllDocs();
    setShowDocPicker(true);
  };

  const handleUpdateDocuments = async () => {
    if (pickerSelected.size === 0) return;
    try {
      setIsUpdating(true);
      setError(null);
      const token = await getToken();
      const updated = await apiFetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_ids: Array.from(pickerSelected) }),
      }, token);
      setWorkspace(updated);
      setShowDocPicker(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to update workspace documents.");
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    if (isLoaded && userId && workspaceId) {
      fetchWorkspace();
    }
  }, [isLoaded, userId, workspaceId]);

  // Reset the cached compare result whenever the workspace's document set changes.
  useEffect(() => {
    setCompareResult(null);
    setHasLoadedCompare(false);
  }, [workspace ? workspace.documents.map((d) => d.id).join(",") : ""]);

  const handleSend = async () => {
    const content = inputMessage.trim();
    if (!content || isSending) return;

    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setIsSending(true);
    setError(null);

    try {
      const token = await getToken();
      const response = await apiFetch(`/api/workspaces/${workspaceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      }, token);

      const aiMsg: Message = {
        role: "assistant",
        content: response.content,
        sources: response.sources,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to send message.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleSources = (index: number) => {
    setExpandedSources((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // --- New: Extract & Compare ---
  const fetchCompare = async (fields: string[] | null) => {
    try {
      setIsLoadingCompare(true);
      setCompareError(null);
      const token = await getToken();
      const result: CompareResult = await apiFetch(`/api/workspaces/${workspaceId}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      }, token);
      setCompareResult(result);
    } catch (err: any) {
      console.error(err);
      setCompareError(err.message || "Failed to compare documents.");
    } finally {
      setIsLoadingCompare(false);
      setHasLoadedCompare(true);
    }
  };

  const completedCount = workspace ? workspace.documents.filter((d) => d.status === "completed").length : 0;

  // Auto-run the comparison the first time the Compare tab is opened.
  useEffect(() => {
    if (canvasTab === "compare" && !hasLoadedCompare && !isLoadingCompare && workspace && completedCount >= 2) {
      fetchCompare(null);
    }
  }, [canvasTab, workspace, hasLoadedCompare, isLoadingCompare, completedCount]);

  // --- New: Inspector selection helpers ---
  const selectCell = (row: CompareRow, val: CompareValue) => {
    setInspectorSelection({
      type: "cell",
      field: row.field,
      document_id: val.document_id,
      filename: val.filename,
      page_number: val.page_number,
      value: val.value,
      status: val.status,
    });
    setHighlightTick((t) => t + 1);
    setMobileSection("inspector");
  };

  const selectCitation = (src: Citation) => {
    setInspectorSelection({
      type: "citation",
      filename: src.filename,
      page_number: src.page_number,
      excerpt: src.content,
    });
    setHighlightTick((t) => t + 1);
    setMobileSection("inspector");
  };

  const cellClasses = (status: CompareStatus) => {
    switch (status) {
      case "match":
        return "bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/30 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-500/20";
      case "conflict":
        return "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20";
      case "missing":
        return "bg-zinc-50 dark:bg-slate-800/60 border-zinc-200 dark:border-slate-700 text-slate-400 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-slate-800";
      default:
        return "bg-zinc-50 dark:bg-slate-800/60 border-zinc-200 dark:border-slate-700 text-slate-700 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-slate-800";
    }
  };

  const statusBadgeClasses = (status: CompareStatus) => {
    switch (status) {
      case "match":
        return "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30";
      case "conflict":
        return "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30";
      case "missing":
        return "bg-zinc-100 dark:bg-slate-800/60 text-slate-500 dark:text-zinc-400 border-zinc-200 dark:border-slate-700";
      default:
        return "bg-zinc-100 dark:bg-slate-800/60 text-slate-600 dark:text-zinc-400 border-zinc-200 dark:border-slate-700";
    }
  };

  const docStatusMeta = (status: string) => {
    if (status === "completed") return { label: "Ready", dot: "bg-teal-500", badge: "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30" };
    if (status === "failed") return { label: "Failed", dot: "bg-red-500", badge: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" };
    return { label: "Processing", dot: "bg-amber-500 animate-pulse", badge: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30" };
  };

  // Builds a straight connector path (in a 0-100-per-column viewBox) between matched columns.
  const buildConnectorPath = (indices: number[]) =>
    indices.map((i, idx) => `${idx === 0 ? "M" : "L"} ${(i + 0.5) * 100} 10`).join(" ");

  const compareColumns = compareResult?.rows[0]?.values.map((v) => ({ document_id: v.document_id, filename: v.filename })) ?? [];

  if (!isLoaded || isLoadingWorkspace) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-slate-800 dark:text-zinc-100 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-teal-500/20 border-t-teal-600 animate-spin" />
          <p className="text-sm text-slate-500 dark:text-zinc-400">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-slate-900 text-slate-800 dark:text-zinc-100 flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <p className="font-display text-lg font-medium text-red-600 dark:text-red-400">Workspace not found</p>
          <p className="text-sm text-slate-500 dark:text-zinc-400">This workspace may have been deleted or you don't have access.</p>
          <Link href="/dashboard" className="inline-flex items-center gap-2 px-4 h-9 rounded-lg bg-zinc-100 dark:bg-slate-800 hover:bg-zinc-200 dark:hover:bg-slate-700 border border-zinc-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const docCount = workspace.documents.length;

  return (
    <div className="h-screen overflow-hidden bg-zinc-50 dark:bg-slate-900 text-slate-800 dark:text-zinc-100 font-sans antialiased selection:bg-amber-200 selection:text-slate-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-slate-700 bg-zinc-50/95 dark:bg-slate-900/95 backdrop-blur-md sticky top-0 z-30 shrink-0">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-slate-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>

            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>

            <div className="min-w-0">
              <p className="font-display font-medium text-slate-900 dark:text-zinc-100 truncate">{workspace.name}</p>
              <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 truncate">{docCount} document{docCount !== 1 ? "s" : ""} · Comparative analysis</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleTheme}
              className="inline-flex p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-slate-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
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
            <button
              onClick={() => setShowConnections((s) => !s)}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                showConnections ? "bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/30 text-teal-700 dark:text-teal-300" : "border-zinc-200 dark:border-slate-700 text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-slate-800"
              }`}
              title="Toggle connection lines between matching values"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 004 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5" />
              </svg>
              Connections
            </button>
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="hidden md:inline-flex p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-slate-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors"
              title="Toggle document panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile section tabs */}
        <div className="flex md:hidden border-t border-zinc-200 dark:border-slate-700 divide-x divide-zinc-200 dark:divide-slate-700">
          {(["sidebar", "canvas", "inspector"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setMobileSection(s)}
              className={`flex-1 h-9 text-xs font-medium transition-colors cursor-pointer ${
                mobileSection === s ? "bg-zinc-100 dark:bg-slate-800 text-slate-900 dark:text-zinc-100" : "text-slate-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-slate-800/60"
              }`}
            >
              {s === "sidebar" ? "Documents" : s === "canvas" ? "Workspace" : "Source"}
            </button>
          ))}
        </div>
      </header>

      {/* Body: Sidebar + Canvas + Inspector */}
      <div className="flex flex-1 overflow-hidden">

        {/* Documents Sidebar */}
        {sidebarOpen && (
          <aside className={`${mobileSection === "sidebar" ? "flex" : "hidden"} md:flex flex-col shrink-0 border-r border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-900 overflow-y-auto w-full md:w-16 lg:w-72`}>
            <div className="p-4 border-b border-zinc-200 dark:border-slate-700 flex items-center justify-between gap-2">
              <p className="hidden lg:block text-xs font-display font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Documents</p>
              <button
                onClick={openDocPicker}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-500/10 hover:bg-teal-100 dark:hover:bg-teal-500/20 border border-teal-200 dark:border-teal-500/30 text-teal-700 dark:text-teal-300 hover:text-teal-800 dark:hover:text-teal-200 text-xs font-semibold transition-colors cursor-pointer mx-auto lg:mx-0"
                title="Add or remove documents"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden lg:inline">Manage</span>
              </button>
            </div>
            <div className="p-3 space-y-2 flex-1">
              {workspace.documents.map((doc) => {
                const meta = docStatusMeta(doc.status);
                return (
                  <div
                    key={doc.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-zinc-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-teal-300 dark:hover:border-teal-500/50 transition-colors"
                    title={doc.filename}
                  >
                    <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-slate-700 border border-zinc-200 dark:border-slate-600 flex items-center justify-center text-slate-500 dark:text-zinc-400 shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="hidden lg:block min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-zinc-100 truncate">{doc.filename}</p>
                      <p className="text-xs font-mono text-slate-500 dark:text-zinc-400 mt-0.5">{formatFileSize(doc.file_size)}</p>
                      <span className={`inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${meta.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tip */}
            <div className="hidden lg:block p-4 border-t border-zinc-200 dark:border-slate-700">
              <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30">
                <p className="text-xs text-teal-800 dark:text-teal-300 leading-relaxed">
                  <span className="font-semibold">Tip:</span> Use Compare to extract fields side-by-side, or Ask to query across every document.
                </p>
              </div>
            </div>
          </aside>
        )}

        {/* Main Canvas */}
        <div className={`${mobileSection === "canvas" ? "flex" : "hidden"} md:flex flex-1 flex-col overflow-hidden min-w-0`}>

          {/* Canvas tabs */}
          <div className="flex items-center gap-1 px-4 pt-3 border-b border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-900 shrink-0">
            {(["compare", "ask"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCanvasTab(tab)}
                className={`relative px-4 h-9 text-sm font-medium transition-colors cursor-pointer ${
                  canvasTab === tab ? "text-slate-900 dark:text-zinc-100" : "text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200"
                }`}
              >
                {tab === "compare" ? "Compare" : "Ask"}
                {canvasTab === tab && <span className="absolute left-1 right-1 -bottom-px h-0.5 bg-amber-500 rounded-full" />}
              </button>
            ))}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="m-4 p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm flex items-center justify-between shrink-0">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold ml-4 cursor-pointer">✕</button>
            </div>
          )}

          {canvasTab === "compare" ? (
            /* --- Compare tab: Extract & Compare table --- */
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div>
                  <h2 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Extract &amp; Compare</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Fields as rows, one column per document.</p>
                </div>
                <div className="flex-1" />
                <input
                  type="text"
                  value={customFields}
                  onChange={(e) => setCustomFields(e.target.value)}
                  placeholder="Custom fields, comma-separated (optional)"
                  className="min-w-[200px] h-9 px-3 rounded-lg border border-zinc-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                />
                <button
                  onClick={() => fetchCompare(customFields.trim() ? customFields.split(",").map((f) => f.trim()).filter(Boolean) : null)}
                  disabled={isLoadingCompare || completedCount < 2}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {compareResult ? "Refresh" : "Compare"}
                </button>
              </div>

              {completedCount < 2 ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 border border-dashed border-zinc-300 dark:border-slate-700 rounded-xl bg-zinc-100 dark:bg-slate-800/60 text-center">
                  <p className="font-display text-base font-medium text-slate-800 dark:text-zinc-100">Add at least 2 processed documents</p>
                  <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-sm px-4">The comparison table needs two or more completed documents in this workspace.</p>
                  <button onClick={openDocPicker} className="mt-1 px-4 h-9 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors cursor-pointer">
                    Manage documents
                  </button>
                </div>
              ) : isLoadingCompare ? (
                <div className="rounded-xl border border-zinc-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-14 border-b border-zinc-200 dark:border-slate-700 last:border-0 shimmer-bg" />
                  ))}
                </div>
              ) : compareError ? (
                <div className="p-5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">{compareError}</div>
              ) : compareResult && compareResult.rows.length > 0 ? (
                <div className="rounded-xl border border-zinc-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-slate-700 bg-zinc-100 dark:bg-slate-800/80">
                        <th className="text-left font-display font-medium text-slate-600 dark:text-zinc-400 text-xs uppercase tracking-wide px-4 py-3 sticky left-0 bg-zinc-100 dark:bg-slate-800/80 min-w-[140px]">
                          Field
                        </th>
                        {compareColumns.map((col) => (
                          <th key={col.document_id} className="text-left font-mono text-xs text-slate-600 dark:text-zinc-400 px-4 py-3 min-w-[180px] truncate" title={col.filename}>
                            {col.filename}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compareResult.rows.map((row) => {
                        const matchIdx = row.values
                          .map((v, i) => (v.status === "match" ? i : -1))
                          .filter((i) => i >= 0);
                        return (
                          <Fragment key={row.field}>
                            <tr className="border-b border-zinc-100 dark:border-slate-700/60 last:border-0 align-top">
                              <th scope="row" className="text-left text-sm font-medium text-slate-800 dark:text-zinc-100 px-4 py-3 sticky left-0 bg-white dark:bg-slate-800">
                                {row.field}
                              </th>
                              {row.values.map((val) => {
                                const isSel =
                                  inspectorSelection?.type === "cell" &&
                                  inspectorSelection.field === row.field &&
                                  inspectorSelection.document_id === val.document_id;
                                return (
                                  <td key={val.document_id} className="p-2">
                                    <button
                                      onClick={() => selectCell(row, val)}
                                      className={`w-full text-left rounded-lg border px-3 py-2 font-mono text-xs transition-colors cursor-pointer ${cellClasses(val.status)} ${
                                        isSel ? "ring-2 ring-amber-400" : ""
                                      }`}
                                    >
                                      {val.value ?? <span className="italic">Not addressed</span>}
                                      {val.page_number != null && <span className="block mt-1 text-[10px] opacity-70">p. {val.page_number}</span>}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                            {showConnections && matchIdx.length >= 2 && (
                              <tr aria-hidden="true">
                                <td className="p-0" />
                                <td colSpan={row.values.length} className="p-0 h-4 relative">
                                  <svg
                                    className="absolute inset-0 w-full h-4 pointer-events-none"
                                    viewBox={`0 0 ${row.values.length * 100} 20`}
                                    preserveAspectRatio="none"
                                  >
                                    <path
                                      pathLength={1}
                                      className="thread-line"
                                      d={buildConnectorPath(matchIdx)}
                                      stroke="#0891b2"
                                      strokeOpacity="0.25"
                                      strokeWidth="2"
                                      fill="none"
                                    />
                                    {matchIdx.map((i) => (
                                      <circle key={i} cx={(i + 0.5) * 100} cy="10" r="4" fill="#0891b2" opacity="0.25" />
                                    ))}
                                  </svg>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-16 flex flex-col items-center justify-center gap-3 border border-dashed border-zinc-300 dark:border-slate-700 rounded-xl bg-zinc-100 dark:bg-slate-800/60 text-center">
                  <p className="text-sm text-slate-500 dark:text-zinc-400 px-4">No comparison yet. Click Compare to extract and align fields across documents.</p>
                </div>
              )}
            </div>
          ) : (
            /* --- Ask tab: AI chat --- */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-5">
                {messages.length === 0 && !isSending && (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
                    <div className="w-16 h-16 rounded-2xl bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Ask across your documents</p>
                      <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-sm mt-1">
                        Ask anything across <strong className="text-slate-700 dark:text-zinc-300">{docCount} document{docCount !== 1 ? "s" : ""}</strong>. Answers are grounded with citations you can inspect.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 mt-2">
                      {[
                        "Summarize all documents",
                        "What topics appear in multiple files?",
                        "Compare the conclusions across documents",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => { setInputMessage(suggestion); inputRef.current?.focus(); }}
                          className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 text-xs text-slate-600 dark:text-zinc-400 hover:border-teal-300 dark:hover:border-teal-500/50 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, index) => (
                  <div key={index} className={`flex gap-3 animate-fade-up ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 shrink-0 mt-5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h10M4 18h10" />
                        </svg>
                      </div>
                    )}

                    <div className={`max-w-2xl w-full min-w-0 ${msg.role === "user" ? "max-w-xl" : ""}`}>

                      {/* Role Label */}
                      <p className={`text-xs font-semibold mb-1.5 px-1 ${msg.role === "user" ? "text-right text-slate-400 dark:text-zinc-500" : "text-left text-teal-700 dark:text-teal-300"}`}>
                        {msg.role === "user" ? "You" : "Workspace Analysis"}
                      </p>

                      {/* Bubble */}
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-slate-800 dark:bg-slate-700 text-zinc-50 rounded-br-sm whitespace-pre-wrap"
                          : "bg-white dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 text-slate-700 dark:text-zinc-300 rounded-bl-sm"
                      }`}>
                        {msg.role === "assistant" ? (
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-zinc-100">{children}</strong>,
                              em: ({ children }) => <em className="italic text-slate-600 dark:text-zinc-400">{children}</em>,
                              ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 pl-2">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 pl-2">{children}</ol>,
                              li: ({ children }) => <li className="text-slate-700 dark:text-zinc-300">{children}</li>,
                              code: ({ children }) => <code className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-slate-700 text-teal-700 dark:text-teal-300 font-mono text-xs">{children}</code>,
                              pre: ({ children }) => <pre className="my-2 p-3 rounded-xl bg-zinc-100 dark:bg-slate-900 border border-zinc-200 dark:border-slate-700 overflow-x-auto text-xs font-mono">{children}</pre>,
                              h1: ({ children }) => <h1 className="font-display text-base font-semibold text-slate-900 dark:text-zinc-100 mt-3 mb-1">{children}</h1>,
                              h2: ({ children }) => <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-zinc-100 mt-3 mb-1">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mt-2 mb-1">{children}</h3>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-teal-300 dark:border-teal-500/40 pl-3 italic text-slate-500 dark:text-zinc-400 my-2">{children}</blockquote>,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        ) : (
                          msg.content
                        )}
                      </div>

                      {/* Source Citations Drawer */}
                      {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleSources(index)}
                            className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer ml-1"
                          >
                            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedSources[index] ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            View sources ({msg.sources.length})
                          </button>

                          {expandedSources[index] && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {msg.sources.map((src, si) => {
                                const isSel =
                                  inspectorSelection?.type === "citation" &&
                                  inspectorSelection.filename === src.filename &&
                                  inspectorSelection.page_number === src.page_number &&
                                  inspectorSelection.excerpt === src.content;
                                return (
                                  <button
                                    key={si}
                                    onClick={() => selectCitation(src)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                                      isSel ? "bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300" : "bg-zinc-50 dark:bg-slate-800 border-zinc-200 dark:border-slate-700 text-slate-600 dark:text-zinc-400 hover:border-teal-300 dark:hover:border-teal-500/50 hover:text-teal-700 dark:hover:text-teal-300"
                                    }`}
                                  >
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                    </svg>
                                    <span className="font-mono">{src.filename || "Unknown"}</span>
                                    {src.page_number != null && <span className="font-mono opacity-70">p.{src.page_number}</span>}
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

                {/* Streaming indicator */}
                {isSending && (
                  <div className="flex gap-3 justify-start animate-fade-up">
                    <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 flex items-center justify-center text-teal-600 dark:text-teal-300 shrink-0 mt-5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h10M4 18h10" />
                      </svg>
                    </div>
                    <div className="max-w-2xl w-full">
                      <p className="text-xs font-semibold mb-1.5 px-1 text-teal-700 dark:text-teal-300">Workspace Analysis</p>
                      <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Bar */}
              <div className="border-t border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-900 p-4 shrink-0">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-end gap-3 p-2 rounded-2xl bg-white dark:bg-slate-800 border border-zinc-300 dark:border-slate-700 focus-within:border-teal-400 dark:focus-within:border-teal-500/60 transition-colors">
                    <textarea
                      ref={inputRef}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Compare across ${docCount} document${docCount !== 1 ? "s" : ""}… (Enter to send, Shift+Enter for newline)`}
                      rows={1}
                      className="flex-1 bg-transparent text-sm text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 resize-none focus:outline-none px-2 py-2 max-h-32 overflow-y-auto leading-relaxed"
                      style={{ scrollbarWidth: "thin" }}
                      disabled={isSending}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!inputMessage.trim() || isSending}
                      className="w-9 h-9 rounded-full bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors shrink-0 cursor-pointer active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-center text-[11px] text-slate-400 dark:text-zinc-500 mt-2">
                    Answers are grounded in your workspace documents. Always verify critical information.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inspector Panel */}
        <aside className={`${mobileSection === "inspector" ? "flex" : "hidden"} md:flex flex-col shrink-0 border-l border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-900 overflow-y-auto w-full md:w-72 lg:w-80`}>
          <div className="p-4 border-b border-zinc-200 dark:border-slate-700">
            <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Inspector</p>
          </div>
          <div key={highlightTick} className={`flex-1 p-4 space-y-4 ${inspectorSelection ? "highlight-flash" : ""}`}>
            {inspectorSelection ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-white dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-zinc-400 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-slate-900 dark:text-zinc-100 truncate" title={inspectorSelection.filename}>
                    {inspectorSelection.filename || "Unknown document"}
                  </p>
                </div>
                {inspectorSelection.page_number != null && (
                  <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">Page {inspectorSelection.page_number}</p>
                )}

                {inspectorSelection.type === "cell" ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-zinc-500">{inspectorSelection.field}</p>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusBadgeClasses(inspectorSelection.status)}`}>
                      {inspectorSelection.status}
                    </span>
                    <p className="text-sm font-mono text-slate-800 dark:text-zinc-200 bg-white dark:bg-slate-800 border border-zinc-200 dark:border-slate-700 rounded-lg p-3 leading-relaxed">
                      {inspectorSelection.value ?? "Not addressed in this document"}
                    </p>
                  </div>
                ) : (
                  <blockquote className="text-sm italic text-slate-600 dark:text-zinc-400 border-l-2 border-teal-300 dark:border-teal-500/40 pl-3 leading-relaxed">
                    "{inspectorSelection.excerpt}"
                  </blockquote>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 dark:text-zinc-400">Click a citation or table cell to see its source.</p>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-zinc-500 mb-2">Sources</p>
                  <ul className="space-y-2">
                    {workspace.documents.map((doc) => {
                      const meta = docStatusMeta(doc.status);
                      return (
                        <li key={doc.id} className="flex items-center gap-2 text-sm min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                          <span className="font-mono text-xs text-slate-600 dark:text-zinc-400 truncate" title={doc.filename}>{doc.filename}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Document Picker Modal */}
      {showDocPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-zinc-200 dark:border-slate-700 bg-zinc-50 dark:bg-slate-800 shadow-xl flex flex-col max-h-[80vh] animate-fade-up">
            {/* Modal Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-slate-700 shrink-0">
              <h3 className="font-display text-lg font-medium text-slate-900 dark:text-zinc-100">Manage Documents</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Select which ready documents to include in this workspace.</p>
            </div>

            {/* Document List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {allDocs.length === 0 ? (
                <p className="text-center text-sm text-slate-500 dark:text-zinc-400 py-8">No ready documents found. Upload PDFs from the dashboard first.</p>
              ) : (
                allDocs.map((doc) => {
                  const isSelected = pickerSelected.has(doc.id);
                  return (
                    <button
                      key={doc.id}
                      onClick={() => {
                        setPickerSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        });
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-500/40"
                          : "bg-white dark:bg-slate-800 border-zinc-200 dark:border-slate-700 hover:border-teal-200 dark:hover:border-teal-500/30"
                      }`}
                    >
                      {/* Checkbox indicator */}
                      <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                        isSelected ? "bg-teal-600 border-teal-600" : "border-zinc-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                      }`}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-zinc-100 truncate" title={doc.filename}>{doc.filename}</p>
                        <p className="text-xs font-mono text-slate-500 dark:text-zinc-400">{formatFileSize(doc.file_size)}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-zinc-200 dark:border-slate-700 flex gap-3 shrink-0">
              <button
                onClick={() => setShowDocPicker(false)}
                className="flex-1 h-10 rounded-xl border border-zinc-300 dark:border-slate-700 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateDocuments}
                disabled={isUpdating || pickerSelected.size === 0}
                className="flex-1 h-10 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUpdating ? "Saving..." : `Save (${pickerSelected.size} doc${pickerSelected.size !== 1 ? "s" : ""})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
