"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { apiFetch, apiStream } from "../../../../lib/api";
import { useWorkspace, useWorkspaceChatHistory, useInvalidators } from "../../../../lib/queries";
import { useTheme } from "../../../../lib/theme";
import { useSpeech } from "../../../../lib/speech";
import PdfViewer from "../../../../components/PdfViewer";
import { markdownComponents } from "../../../../components/markdown";
import Icon from "../../../../components/Icon";

interface Citation {
  content: string;
  page_number?: number;
  filename?: string;
  document_id?: string;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Citation[];
  created_at?: string;
  streaming?: boolean;
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
      document_id?: string;
      filename?: string;
      page_number?: number;
      excerpt: string;
    };

type InspectorTab = "source" | "page";

const SUGGESTIONS = [
  "Where do these documents disagree?",
  "Summarize each document in one line",
  "What does one cover that the others don't?",
];

export default function WorkspaceChatPage() {
  const params = useParams();
  const { isLoaded, userId, getToken } = useAuth();
  const workspaceId = params?.id as string;
  const isAuthReady = isLoaded && Boolean(userId) && Boolean(workspaceId);

  const { theme, toggleTheme } = useTheme();
  const { speak, speakingId, isSupported: isSpeechSupported } = useSpeech();

  // ── React Query data fetching ──────────────────────────────────────────
  const {
    data: workspaceData,
    isLoading: isLoadingWorkspace,
    refetch: refetchWorkspace,
  } = useWorkspace(workspaceId, getToken, isAuthReady);

  const {
    data: workspaceChatHistory,
  } = useWorkspaceChatHistory(workspaceId, getToken, isAuthReady);

  const { invalidateWorkspace, invalidateWorkspaceChatHistory } = useInvalidators();

  // Typed alias
  const workspace = workspaceData as Workspace | undefined;

  // ── Local UI state ─────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync React Query chat history into local messages state
  useEffect(() => {
    if (workspaceChatHistory) {
      setMessages(workspaceChatHistory as Message[]);
    }
  }, [workspaceChatHistory]);

  const [showDocPicker, setShowDocPicker] = useState(false);
  const [allDocs, setAllDocs] = useState<WorkspaceDoc[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);

  const [canvasTab, setCanvasTab] = useState<"compare" | "ask">("compare");
  const [mobileSection, setMobileSection] = useState<"sidebar" | "canvas" | "inspector">("canvas");

  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [isLoadingCompare, setIsLoadingCompare] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [hasLoadedCompare, setHasLoadedCompare] = useState(false);
  const [customFields, setCustomFields] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);

  const [inspectorSelection, setInspectorSelection] = useState<InspectorSelection | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("source");
  const [highlightTick, setHighlightTick] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Resizable sidebar states & logic
  const [sidebarWidth, setSidebarWidth] = useState(384); // Default 384px (w-96)
  const isResizingRef = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 240 && newWidth < 800) {
      setSidebarWidth(newWidth);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchAllDocs = async () => {
    try {
      const token = await getToken();
      const docs: WorkspaceDoc[] = await apiFetch("/api/documents", {}, token);
      setAllDocs(docs.filter((d) => d.status === "completed"));
    } catch (err) {
      console.error("Could not load documents:", err);
    }
  };

  const openDocPicker = async () => {
    if (workspace) setPickerSelected(new Set(workspace.documents.map((d) => d.id)));
    await fetchAllDocs();
    setShowDocPicker(true);
  };

  const handleUpdateDocuments = async () => {
    if (pickerSelected.size === 0) return;
    try {
      setIsUpdating(true);
      setError(null);
      const token = await getToken();
      await apiFetch(
        `/api/workspaces/${workspaceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_ids: Array.from(pickerSelected) }),
        },
        token
      );
      invalidateWorkspace(workspaceId);
      setShowDocPicker(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the document set.");
    } finally {
      setIsUpdating(false);
    }
  };

  const documentKey = workspace ? workspace.documents.map((d) => d.id).join(",") : "";

  // Any change to the document set invalidates the cached comparison.
  useEffect(() => {
    setCompareResult(null);
    setHasLoadedCompare(false);
  }, [documentKey]);

  const fetchCompare = useCallback(
    async (fields: string[] | null) => {
      try {
        setIsLoadingCompare(true);
        setCompareError(null);
        const token = await getToken();
        const result: CompareResult = await apiFetch(
          `/api/workspaces/${workspaceId}/compare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
          },
          token
        );
        setCompareResult(result);
      } catch (err) {
        setCompareError(err instanceof Error ? err.message : "Could not compare these documents.");
      } finally {
        setIsLoadingCompare(false);
        setHasLoadedCompare(true);
      }
    },
    [workspaceId, getToken]
  );

  const completedDocs = useMemo(
    () => workspace?.documents.filter((d) => d.status === "completed") ?? [],
    [workspace]
  );
  const completedCount = completedDocs.length;

  useEffect(() => {
    if (canvasTab === "compare" && !hasLoadedCompare && !isLoadingCompare && completedCount >= 2) {
      fetchCompare(null);
    }
  }, [canvasTab, hasLoadedCompare, isLoadingCompare, completedCount, fetchCompare]);

  /**
   * Columns for the comparison table.
   *
   * Derived from the union of every row's values rather than from `rows[0]`:
   * the model can omit a document from a row when it has nothing to say about
   * that field, and reading only the first row would silently drop that
   * document's column from the whole table. The workspace's own document list
   * seeds the order so columns stay stable between runs.
   */
  const compareColumns = useMemo(() => {
    const byId = new Map<string, { document_id: string; filename: string }>();

    for (const doc of completedDocs) {
      byId.set(doc.id, { document_id: doc.id, filename: doc.filename });
    }
    for (const row of compareResult?.rows ?? []) {
      for (const value of row.values) {
        if (!byId.has(value.document_id)) {
          byId.set(value.document_id, {
            document_id: value.document_id,
            filename: value.filename,
          });
        }
      }
    }
    return Array.from(byId.values());
  }, [completedDocs, compareResult]);

  /** Looks up a row's value for a column, synthesising a "missing" cell. */
  const valueFor = useCallback((row: CompareRow, documentId: string, filename: string): CompareValue => {
    const found = row.values.find((v) => v.document_id === documentId);
    if (found) return found;
    return { document_id: documentId, filename, value: null, status: "missing" };
  }, []);

  const visibleRows = useMemo(() => {
    const rows = compareResult?.rows ?? [];
    if (!conflictsOnly) return rows;
    return rows.filter((row) => row.values.some((v) => v.status === "conflict"));
  }, [compareResult, conflictsOnly]);

  const conflictCount = useMemo(
    () =>
      (compareResult?.rows ?? []).filter((row) => row.values.some((v) => v.status === "conflict"))
        .length,
    [compareResult]
  );

  const handleDownloadChat = () => {
    if (messages.length === 0) return;
    const content = messages.map(m => `**${m.role === "user" ? "User" : "Assistant"}**: ${m.content}`).join("\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "workspace_chat.md";
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (!compareResult || !compareResult.rows) return;
    const cols = compareColumns;
    const header = ["Field", ...cols.map(c => c.filename)].map(s => `"${s.replace(/"/g, '""')}"`).join(",");
    const rows = compareResult.rows.map(row => {
      const field = `"${row.field.replace(/"/g, '""')}"`;
      const vals = cols.map(c => {
        const val = valueFor(row, c.document_id, c.filename);
        const text = val.value || "";
        return `"${text.replace(/"/g, '""')}"`;
      });
      return [field, ...vals].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "comparison.csv";
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSend = async () => {
    const content = inputMessage.trim();
    if (!content || isSending) return;

    setInputMessage("");
    setIsSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content },
      { role: "assistant", content: "", streaming: true },
    ]);

    const updateAnswer = (patch: Partial<Message>) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        if (last >= 0 && next[last].role === "assistant") {
          next[last] = { ...next[last], ...patch };
        }
        return next;
      });
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = await getToken();
      let answer = "";

      await apiStream(
        `/api/workspaces/${workspaceId}/chat/stream`,
        { message: content },
        token,
        {
          onSources: (sources) => updateAnswer({ sources: sources as Citation[] }),
          onDelta: (text) => {
            answer += text;
            updateAnswer({ content: answer });
          },
          onDone: (final) => updateAnswer({ content: final || answer, streaming: false }),
        },
        controller.signal
      );
      // Keep persisted history in sync when user navigates away and back
      invalidateWorkspaceChatHistory(workspaceId);
    } catch (err) {
      // Drop the placeholder and the question together, and put the text back
      // in the composer so the send can be retried.
      setMessages((prev) => prev.slice(0, -2));
      setInputMessage(content);
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Could not send that message.");
      }
    } finally {
      abortRef.current = null;
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
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`;
  };

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
      document_id: src.document_id,
      filename: src.filename,
      page_number: src.page_number,
      excerpt: src.content,
    });
    setHighlightTick((t) => t + 1);
    setMobileSection("inspector");
  };

  // Status drives colour throughout the table: agreement in signal, a
  // disagreement in alert. Everything else stays neutral so the two verdicts
  // are the only things that read as coloured.
  const cellClasses = (status: CompareStatus) => {
    switch (status) {
      case "match":
        return "text-signal-800 dark:text-signal-200 bg-signal-50 dark:bg-signal-900/30";
      case "conflict":
        return "text-alert-800 dark:text-alert-200 bg-alert-50 dark:bg-alert-900/30";
      case "missing":
        return "text-ink-400 bg-transparent";
      default:
        return "text-ink-700 dark:text-ink-200 bg-transparent";
    }
  };

  const docStatusMeta = (status: string) => {
    if (status === "completed") return { label: "Ready", dot: "bg-signal-500" };
    if (status === "failed") return { label: "Failed", dot: "bg-alert-500" };
    return { label: "Indexing", dot: "bg-ember-500 animate-pulse" };
  };

  if (!isLoaded || isLoadingWorkspace) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
          <p className="font-mono text-eyebrow uppercase text-ink-400">Loading workspace</p>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-6">
        <div className="text-center space-y-3 max-w-sm">
          <h1 className="font-display text-title text-ink-900 dark:text-ink-50">
            Workspace not found
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            It may have been deleted, or it belongs to another account.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-ink-900 dark:bg-ink-50 text-ink-50 dark:text-ink-900 text-sm font-medium hover:bg-ink-700 dark:hover:bg-ink-200 transition-colors"
          >
            Back to documents
          </Link>
        </div>
      </div>
    );
  }

  const docCount = workspace.documents.length;

  return (
    <div className="h-screen overflow-hidden bg-surface text-ink-900 dark:text-ink-50 flex flex-col">
      <header className="shrink-0 border-b border-hairline bg-surface-raised">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-1.5 -ml-1.5 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors shrink-0"
              title="Back to documents"
            >
              <Icon name="arrowLeft" className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <p className="font-display font-semibold text-ink-900 dark:text-ink-50 truncate">
                {workspace.name}
              </p>
              <p className="font-mono text-eyebrow uppercase text-ink-400">
                {docCount} document{docCount !== 1 ? "s" : ""}
                {conflictCount > 0 && (
                  <>
                    <span className="text-ink-300 dark:text-ink-600"> / </span>
                    <span className="text-alert-600 dark:text-alert-400">
                      {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {messages.length > 0 && canvasTab === "ask" && (
              <button
                type="button"
                onClick={handleDownloadChat}
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
              >
                <Icon name="document" className="w-3.5 h-3.5" />
                Download Chat
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="hidden md:inline-flex p-2 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
              title="Toggle document panel"
            >
              <Icon name="layers" className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex md:hidden border-t border-hairline">
          {(["sidebar", "canvas", "inspector"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setMobileSection(s)}
              className={`relative flex-1 h-9 font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
                mobileSection === s ? "text-ink-900 dark:text-ink-50" : "text-ink-400"
              }`}
            >
              {s === "sidebar" ? "Files" : s === "canvas" ? "Workspace" : "Source"}
              {mobileSection === s && (
                <span className="absolute inset-x-4 -bottom-px h-0.5 bg-ember-500" />
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {sidebarOpen && (
          <aside
            className={`${
              mobileSection === "sidebar" ? "flex" : "hidden"
            } md:flex flex-col shrink-0 border-r border-hairline overflow-y-auto w-full md:w-64`}
          >
            <div className="px-4 h-11 shrink-0 flex items-center justify-between gap-2 border-b border-hairline">
              <p className="font-mono text-eyebrow uppercase text-ink-400">Documents</p>
              <button
                onClick={openDocPicker}
                className="inline-flex items-center gap-1 font-mono text-eyebrow uppercase text-ink-500 dark:text-ink-300 hover:text-ember-600 dark:hover:text-ember-400 transition-colors cursor-pointer"
                title="Add or remove documents"
              >
                <Icon name="plus" weight={2} className="w-3 h-3" />
                Manage
              </button>
            </div>
            <ul className="p-2 space-y-0.5 flex-1">
              {workspace.documents.map((doc, i) => {
                const meta = docStatusMeta(doc.status);
                return (
                  <li
                    key={doc.id}
                    className="flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                    title={doc.filename}
                  >
                    <span className="font-mono text-eyebrow text-ink-300 dark:text-ink-600 pt-0.5 shrink-0 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-ink-800 dark:text-ink-100 truncate">
                        {doc.filename}
                      </p>
                      <p className="flex items-center gap-1.5 font-mono text-eyebrow uppercase text-ink-400 mt-0.5">
                        <span className={`w-1 h-1 rounded-full ${meta.dot}`} />
                        {meta.label}
                        <span className="text-ink-300 dark:text-ink-600">/</span>
                        {formatFileSize(doc.file_size)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}

        <div
          className={`${
            mobileSection === "canvas" ? "flex" : "hidden"
          } md:flex flex-1 flex-col overflow-hidden min-w-0`}
        >
          <div className="flex items-center gap-1 px-4 border-b border-hairline shrink-0">
            {(["compare", "ask"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCanvasTab(tab)}
                className={`relative px-3 h-11 font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
                  canvasTab === tab
                    ? "text-ink-900 dark:text-ink-50"
                    : "text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
                }`}
              >
                {tab === "compare" ? "Compare" : "Ask"}
                {canvasTab === tab && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 bg-ember-500" />
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="mx-4 mt-4 shrink-0 flex items-start justify-between gap-4 p-3 rounded-lg border border-alert-200 dark:border-alert-800 bg-alert-50 dark:bg-alert-900/30 text-sm text-alert-700 dark:text-alert-200">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-alert-500 hover:text-alert-700 dark:hover:text-alert-200 cursor-pointer"
                title="Dismiss"
              >
                <Icon name="close" className="w-4 h-4" />
              </button>
            </div>
          )}

          {canvasTab === "compare" ? (
            <div className="flex-1 overflow-auto">
              <div className="px-4 sm:px-6 py-5 flex flex-wrap items-end gap-3 border-b border-hairline">
                <div className="mr-auto">
                  <h2 className="font-display text-title text-ink-900 dark:text-ink-50">
                    The ledger
                  </h2>
                  <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">
                    One row per field, one column per document. Disagreements are marked.
                  </p>
                </div>

                {conflictCount > 0 && (
                  <button
                    onClick={() => setConflictsOnly((v) => !v)}
                    className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
                      conflictsOnly
                        ? "border-alert-400 text-alert-700 dark:text-alert-300 bg-alert-50 dark:bg-alert-900/30"
                        : "border-hairline text-ink-500 dark:text-ink-300 hover:border-alert-400"
                    }`}
                  >
                    Conflicts only
                    <span className="tabular-nums">{conflictCount}</span>
                  </button>
                )}
                <input
                  type="text"
                  value={customFields}
                  onChange={(e) => setCustomFields(e.target.value)}
                  placeholder="Fields to extract, comma-separated"
                  aria-label="Fields to extract"
                  className="w-full sm:w-64 h-9 px-3 rounded-md border border-hairline bg-surface-raised text-sm outline-hidden focus:border-ember-500 transition-colors placeholder:text-ink-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      fetchCompare(
                        customFields.trim()
                          ? customFields.split(",").map((f) => f.trim()).filter(Boolean)
                          : null
                      )
                    }
                    disabled={isLoadingCompare || completedCount < 2}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-ember-500 hover:bg-ember-600 disabled:opacity-30 disabled:pointer-events-none text-white font-mono text-eyebrow uppercase transition-colors cursor-pointer"
                  >
                    <Icon name="refresh" className="w-3.5 h-3.5" />
                    {compareResult ? "Rerun" : "Compare"}
                  </button>
                  {compareResult && compareResult.rows && compareResult.rows.length > 0 && (
                    <button
                      onClick={handleExportCSV}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-hairline bg-surface-raised text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50 font-mono text-eyebrow uppercase transition-colors cursor-pointer"
                    >
                      <Icon name="document" className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  )}
                </div>
              </div>

              {completedCount < 2 ? (
                <div className="p-6 sm:p-10 text-center space-y-3">
                  <h3 className="font-display text-heading">
                    Two indexed documents are needed to compare
                  </h3>
                  <p className="text-sm text-ink-500 dark:text-ink-400 max-w-sm mx-auto">
                    This workspace has {completedCount} ready. Add another and the ledger fills in.
                  </p>
                  <button
                    onClick={openDocPicker}
                    className="h-9 px-4 rounded-md bg-ink-900 dark:bg-ink-50 text-ink-50 dark:text-ink-900 text-sm font-medium hover:bg-ink-700 dark:hover:bg-ink-200 transition-colors cursor-pointer"
                  >
                    Manage documents
                  </button>
                </div>
              ) : isLoadingCompare ? (
                <div className="p-4 sm:p-6 space-y-px">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 rounded shimmer-bg" />
                  ))}
                </div>
              ) : compareError ? (
                <div className="m-4 sm:m-6 p-4 rounded-lg border border-alert-200 dark:border-alert-800 bg-alert-50 dark:bg-alert-900/30 text-sm text-alert-700 dark:text-alert-200">
                  {compareError}
                </div>
              ) : visibleRows.length > 0 ? (
                <table className="w-full border-collapse text-sm" data-tabular>
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="sticky left-0 z-10 bg-surface text-left font-mono text-eyebrow uppercase text-ink-400 px-4 sm:px-6 py-3 min-w-[9rem] w-[9rem]">
                        Field
                      </th>
                      {compareColumns.map((col, i) => (
                        <th
                          key={col.document_id}
                          className="text-left px-4 py-3 min-w-[13rem] border-l border-hairline"
                          title={col.filename}
                        >
                          <span className="font-mono text-eyebrow text-ink-300 dark:text-ink-600 tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="block font-mono text-xs text-ink-600 dark:text-ink-300 truncate font-normal">
                            {col.filename}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {visibleRows.map((row) => {
                      const hasConflict = row.values.some((v) => v.status === "conflict");
                      return (
                        <Fragment key={row.field}>
                          <tr className="border-b border-hairline align-top group">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 bg-surface text-left px-4 sm:px-6 py-3 font-medium text-ink-800 dark:text-ink-100"
                            >
                              <span className="flex items-start gap-2">
                                {hasConflict && (
                                  <span
                                    className="mt-1.5 w-1 h-1 rounded-full bg-alert-500 shrink-0"
                                    title="Documents disagree on this field"
                                  />
                                )}
                                <span className="text-xs leading-snug">{row.field}</span>
                              </span>
                            </th>
                            {compareColumns.map((col) => {
                              const val = valueFor(row, col.document_id, col.filename);
                              const isSel =
                                inspectorSelection?.type === "cell" &&
                                inspectorSelection.field === row.field &&
                                inspectorSelection.document_id === col.document_id;
                              return (
                                <td
                                  key={col.document_id}
                                  className="p-0 border-l border-hairline"
                                >
                                  <button
                                    onClick={() => selectCell(row, val)}
                                    className={`w-full h-full text-left px-4 py-3 transition-colors cursor-pointer ${cellClasses(
                                      val.status
                                    )} ${
                                      isSel
                                        ? "outline-2 -outline-offset-2 outline-ember-500"
                                        : "hover:bg-ink-100 dark:hover:bg-ink-800"
                                    }`}
                                  >
                                    <span className="block text-xs leading-relaxed">
                                      {val.value ?? (
                                        <span className="text-ink-400">Not addressed</span>
                                      )}
                                    </span>
                                    {val.page_number != null && (
                                      <span className="block mt-1 font-mono text-eyebrow text-ink-400">
                                        p.{val.page_number}
                                      </span>
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>

              ) : (
                <div className="p-6 sm:p-10 text-center">
                  <p className="text-sm text-ink-500 dark:text-ink-400">
                    {conflictsOnly
                      ? "No conflicts in this comparison — every field agrees."
                      : "Nothing extracted yet. Run a comparison to fill the ledger."}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                  {messages.length === 0 && !isSending && (
                    <div className="pt-12 text-center space-y-4">
                      <h2 className="font-display text-title">
                        Ask across {docCount} document{docCount !== 1 ? "s" : ""}
                      </h2>
                      <p className="text-sm text-ink-500 dark:text-ink-400 max-w-md mx-auto leading-relaxed">
                        Answers cite the file and page each claim came from, so you can check them.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2 pt-1">
                        {SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => {
                              setInputMessage(suggestion);
                              inputRef.current?.focus();
                            }}
                            className="px-3 py-1.5 rounded-md border border-hairline font-mono text-eyebrow uppercase text-ink-500 dark:text-ink-300 hover:border-ember-400 hover:text-ember-600 dark:hover:text-ember-400 transition-colors cursor-pointer"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg, index) =>
                    msg.role === "user" ? (
                      <div key={index} className="animate-fade-up pt-2">
                        <p className="font-mono text-eyebrow uppercase text-ink-400 mb-2">You</p>
                        <p className="font-display text-heading text-ink-900 dark:text-ink-50 border-l-2 border-ember-500 pl-3.5">
                          {msg.content}
                        </p>
                      </div>
                    ) : (
                      <div key={index} className="animate-fade-up">
                        <p className="font-mono text-eyebrow uppercase text-ink-400 mb-2">
                          Across {docCount} document{docCount !== 1 ? "s" : ""}
                        </p>
                        <div className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                          {msg.content ? (
                            <ReactMarkdown components={markdownComponents}>
                              {msg.content}
                            </ReactMarkdown>
                          ) : (
                            <span className="font-mono text-xs text-ink-400">
                              Reading the documents…
                            </span>
                          )}
                          {msg.streaming && msg.content && <span className="stream-caret" />}
                        </div>

                        {!msg.streaming && msg.content && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            {msg.sources && msg.sources.length > 0 && (
                              <button
                                onClick={() => toggleSources(index)}
                                className="inline-flex items-center gap-1.5 font-mono text-eyebrow uppercase text-ink-400 hover:text-ember-600 dark:hover:text-ember-400 transition-colors cursor-pointer"
                              >
                                <Icon
                                  name="chevronRight"
                                  weight={2}
                                  className={`w-3 h-3 transition-transform ${
                                    expandedSources[index] ? "rotate-90" : ""
                                  }`}
                                />
                                {msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}
                              </button>
                            )}
                            {isSpeechSupported && (
                              <button
                                onClick={() => speak(String(index), msg.content)}
                                className={`inline-flex items-center gap-1.5 font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
                                  speakingId === String(index)
                                    ? "text-ember-600 dark:text-ember-400"
                                    : "text-ink-400 hover:text-ember-600 dark:hover:text-ember-400"
                                }`}
                              >
                                <Icon
                                  name={speakingId === String(index) ? "stop" : "speaker"}
                                  className="w-3 h-3"
                                />
                                {speakingId === String(index) ? "Stop" : "Listen"}
                              </button>
                            )}
                          </div>
                        )}

                        {expandedSources[index] && msg.sources && (
                          <div className="mt-3 rounded-lg border border-hairline overflow-hidden divide-y divide-hairline">
                            {msg.sources.map((src, si) => {
                              const isSel =
                                inspectorSelection?.type === "citation" &&
                                inspectorSelection.excerpt === src.content &&
                                inspectorSelection.page_number === src.page_number;
                              return (
                                <button
                                  key={si}
                                  onClick={() => selectCitation(src)}
                                  className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer ${
                                    isSel
                                      ? "bg-ember-50 dark:bg-ember-900/25"
                                      : "hover:bg-ink-50 dark:hover:bg-ink-800"
                                  }`}
                                >
                                  <div className="flex items-baseline justify-between gap-3">
                                    <span className="font-mono text-eyebrow text-ink-500 dark:text-ink-400 truncate">
                                      {src.filename || "Unknown file"}
                                    </span>
                                    {src.page_number != null && (
                                      <span className="font-mono text-eyebrow text-ink-400 shrink-0">
                                        p.{src.page_number}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-ink-500 dark:text-ink-400 line-clamp-1 mt-1">
                                    {src.content}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="shrink-0 border-t border-hairline bg-surface-raised px-4 sm:px-6 py-3">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-end gap-2 p-1.5 pl-3 rounded-lg border border-hairline bg-surface focus-within:border-ember-500 transition-colors">
                    <textarea
                      ref={inputRef}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Ask across ${docCount} document${docCount !== 1 ? "s" : ""}…`}
                      aria-label="Your question"
                      rows={1}
                      className="flex-1 min-w-0 bg-transparent text-sm resize-none outline-hidden py-2 max-h-32 leading-relaxed placeholder:text-ink-400"
                      disabled={isSending}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!inputMessage.trim() || isSending}
                      aria-label="Send question"
                      className="w-8 h-8 rounded-md bg-ember-500 hover:bg-ember-600 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center text-white transition-colors shrink-0 cursor-pointer active:scale-95"
                    >
                      <Icon name="arrowRight" weight={2} className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-center font-mono text-eyebrow uppercase text-ink-400 mt-2">
                    Enter to send · Shift+Enter for a new line
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          className="hidden md:block w-1 hover:w-1.5 active:w-1.5 bg-hairline hover:bg-ember-500 active:bg-ember-500 cursor-col-resize transition-all shrink-0 select-none"
        />

        <aside
          style={{ width: `${sidebarWidth}px` }}
          className={`${
            mobileSection === "inspector" ? "flex" : "hidden"
          } md:flex flex-col shrink-0 border-l border-hairline bg-surface-raised overflow-hidden`}
        >
          <div className="flex shrink-0 border-b border-hairline">
            {(["source", "page"] as InspectorTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setInspectorTab(tab)}
                className={`relative px-4 h-11 font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
                  inspectorTab === tab
                    ? "text-ink-900 dark:text-ink-50"
                    : "text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
                }`}
              >
                {tab === "source" ? "Source" : "Page"}
                {inspectorTab === tab && (
                  <span className="absolute inset-x-3 -bottom-px h-0.5 bg-ember-500" />
                )}
              </button>
            ))}
            {inspectorSelection?.page_number != null && (
              <span className="ml-auto self-center pr-4 font-mono text-xs text-ink-400">
                p. {inspectorSelection.page_number}
              </span>
            )}
          </div>

          {inspectorTab === "page" ? (
            <PdfViewer
              documentId={
                inspectorSelection?.type === "citation"
                  ? inspectorSelection.document_id ?? ""
                  : inspectorSelection?.type === "cell"
                    ? inspectorSelection.document_id
                    : ""
              }
              filename={
                inspectorSelection?.type === "citation"
                  ? inspectorSelection.filename
                  : inspectorSelection?.type === "cell"
                    ? inspectorSelection.filename
                    : undefined
              }
              page={inspectorSelection?.page_number ?? null}
              className="flex-1 min-h-0"
            />
          ) : (
            <div key={highlightTick} className={`flex-1 min-h-0 overflow-y-auto p-4 ${inspectorSelection ? "highlight-flash" : ""}`}>
              {inspectorSelection ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name="document" className="w-4 h-4 text-ink-400 shrink-0" />
                    <p className="text-sm text-ink-900 dark:text-ink-50 truncate" title={inspectorSelection.filename}>
                      {inspectorSelection.filename || "Unknown document"}
                    </p>
                  </div>

                  {inspectorSelection.type === "cell" ? (
                    <div className="space-y-2">
                      <p className="font-mono text-eyebrow uppercase text-ink-400">
                        {inspectorSelection.field}
                      </p>
                      <span className={`inline-flex items-center gap-1.5 font-mono text-eyebrow uppercase ${
                        inspectorSelection.status === "conflict"
                          ? "text-alert-700 dark:text-alert-300"
                          : inspectorSelection.status === "match"
                            ? "text-signal-700 dark:text-signal-300"
                            : "text-ink-400"
                      }`}>
                        {inspectorSelection.status}
                      </span>
                      <p className="text-sm text-ink-700 dark:text-ink-200 leading-relaxed whitespace-pre-wrap">
                        {inspectorSelection.value ?? "Not addressed in this document"}
                      </p>
                    </div>
                  ) : (
                    <blockquote className="text-sm italic text-ink-600 dark:text-ink-300 border-l-2 border-ember-400 pl-3 leading-relaxed">
                      &ldquo;{inspectorSelection.excerpt}&rdquo;
                    </blockquote>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center gap-3 py-12 px-4">
                  <Icon name="documentLines" className="w-6 h-6 text-ink-300 dark:text-ink-600" />
                  <p className="text-sm text-ink-400 max-w-[24ch]">
                    Click a citation or a ledger cell to inspect the source.
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {showDocPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/50">
          <div className="w-full max-w-md rounded-xl border border-hairline bg-surface-raised shadow-xl flex flex-col max-h-[80vh] animate-fade-up">
            <div className="p-5 border-b border-hairline shrink-0">
              <h3 className="font-display text-heading text-ink-900 dark:text-ink-50">
                Documents in this workspace
              </h3>
              <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">
                Only indexed documents can be compared.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {allDocs.length === 0 ? (
                <p className="text-center text-sm text-ink-500 dark:text-ink-400 py-10 px-4">
                  Nothing indexed yet. Upload a PDF from the dashboard first.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {allDocs.map((doc) => {
                    const isSelected = pickerSelected.has(doc.id);
                    return (
                      <li key={doc.id}>
                        <button
                          onClick={() =>
                            setPickerSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(doc.id)) next.delete(doc.id);
                              else next.add(doc.id);
                              return next;
                            })
                          }
                          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md text-left hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
                        >
                          <span
                            className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                              isSelected
                                ? "bg-ember-500 border-ember-500 text-white"
                                : "border-ink-300 dark:border-ink-600"
                            }`}
                          >
                            {isSelected && <Icon name="check" weight={3} className="w-2.5 h-2.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-ink-900 dark:text-ink-50 truncate" title={doc.filename}>
                              {doc.filename}
                            </span>
                            <span className="block font-mono text-eyebrow uppercase text-ink-400">
                              {formatFileSize(doc.file_size)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="p-4 border-t border-hairline flex gap-3 shrink-0">
              <button
                onClick={() => setShowDocPicker(false)}
                className="flex-1 h-10 rounded-md border border-hairline text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateDocuments}
                disabled={isUpdating || pickerSelected.size === 0}
                className="flex-1 h-10 rounded-md bg-ember-500 hover:bg-ember-600 disabled:opacity-30 disabled:pointer-events-none text-white text-sm font-medium transition-colors cursor-pointer"
              >
                {isUpdating ? "Saving…" : `Save ${pickerSelected.size} of ${allDocs.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
