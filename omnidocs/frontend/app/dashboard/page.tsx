"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import Icon from "../../components/Icon";

interface DocumentMeta {
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

const STATUS_META: Record<
  DocumentMeta["status"],
  { label: string; dot: string; text: string }
> = {
  completed: { label: "Ready", dot: "bg-signal-500", text: "text-signal-600 dark:text-signal-400" },
  processing: { label: "Indexing", dot: "bg-ember-500 animate-pulse", text: "text-ember-600 dark:text-ember-400" },
  failed: { label: "Failed", dot: "bg-alert-500", text: "text-alert-600 dark:text-alert-400" },
};

export default function DashboardPage() {
  const { isLoaded, userId, getToken } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  const [activeTab, setActiveTab] = useState<"documents" | "workspaces">("documents");

  const fetchDocuments = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setIsLoading(true);
        setError(null);
        const token = await getToken();
        const docs = await apiFetch("/api/documents", {}, token);
        setDocuments(docs);
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "Could not load documents.");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [getToken]
  );

  const fetchWorkspaces = useCallback(async () => {
    try {
      const token = await getToken();
      const ws = await apiFetch("/api/workspaces", {}, token);
      setWorkspaces(ws);
    } catch (err) {
      console.error("Could not load workspaces:", err);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && userId) {
      fetchDocuments();
      fetchWorkspaces();
    }
  }, [isLoaded, userId, fetchDocuments, fetchWorkspaces]);

  // Poll while anything is still indexing.
  useEffect(() => {
    if (!documents.some((d) => d.status === "processing")) return;
    const interval = setInterval(() => fetchDocuments(true), 3000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".pdf") && !ext.endsWith(".txt") && !ext.endsWith(".md") && !ext.endsWith(".docx")) {
      setError("Only .pdf, .txt, .md, and .docx files are supported.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that document.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleReprocess = async (id: string) => {
    try {
      setError(null);
      const token = await getToken();
      await apiFetch(`/api/documents/${id}/reprocess`, { method: "POST" }, token);
      await fetchDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reprocess that document.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      setError(null);
      const token = await getToken();
      await apiFetch(`/api/documents/${id}`, { method: "DELETE" }, token);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that document.");
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm("Delete this workspace? The source documents are kept.")) return;
    try {
      setError(null);
      const token = await getToken();
      await apiFetch(`/api/workspaces/${id}`, { method: "DELETE" }, token);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that workspace.");
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
    if (!name) {
      setError("Give the workspace a name.");
      return;
    }
    if (selectedIds.size < 1) {
      setError("Select at least one document.");
      return;
    }
    try {
      setIsCreatingWorkspace(true);
      setError(null);
      const token = await getToken();
      const ws = await apiFetch(
        "/api/workspaces",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, document_ids: Array.from(selectedIds) }),
        },
        token
      );
      setShowWorkspaceModal(false);
      setWorkspaceName("");
      setSelectedIds(new Set());
      await fetchWorkspaces();
      router.push(`/dashboard/workspaces/${ws.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that workspace.");
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "0 KB";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
      </div>
    );
  }

  const completedDocs = documents.filter((d) => d.status === "completed");
  const selectedCount = selectedIds.size;
  const allCompletedSelected =
    completedDocs.length > 0 && completedDocs.every((d) => selectedIds.has(d.id));

  return (
    <div className="min-h-screen bg-surface text-ink-900 dark:text-ink-50 font-sans antialiased">
      <header className="sticky top-0 z-40 border-b border-hairline bg-surface-raised">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              href="/"
              className="w-8 h-8 rounded-lg bg-ember-500 hover:bg-ember-600 flex items-center justify-center text-white transition-colors shrink-0"
              title="Home"
            >
              <Icon name="omega" weight={2} className="w-4 h-4" />
            </Link>
            <span className="font-display font-semibold tracking-tight truncate">OmniDocs</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} className="w-4 h-4" />
            </button>
            <div className="ml-2 pl-3 border-l border-hairline flex items-center">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-eyebrow uppercase text-ember-600 dark:text-ember-400 mb-2">
              Library
            </p>
            <h1 className="font-display text-title font-semibold tracking-tight">
              Documents &amp; workspaces
            </h1>
            <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
              Upload documents, then group them into workspaces to ask questions across all of them.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
              Loading…
            </div>
          ) : (
            <p className="font-mono text-eyebrow uppercase text-ink-400 tabular-nums">
              {documents.length} document{documents.length === 1 ? "" : "s"} ·{" "}
              {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-lg border border-alert-300 dark:border-alert-700 bg-alert-50 dark:bg-alert-950 px-4 py-3"
          >
            <Icon name="warning" className="w-4 h-4 text-alert-600 dark:text-alert-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-alert-700 dark:text-alert-300 leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-alert-500 hover:text-alert-700 dark:hover:text-alert-300 p-1 rounded transition-colors cursor-pointer"
              title="Dismiss"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <label
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors cursor-pointer"
            role="button"
            aria-disabled={isUploading}
          >
            {isUploading ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Icon name="upload" className="w-4 h-4" />
                Upload Document
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx"
              onChange={handleUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
          <p className="text-xs text-ink-400">
            Documents · up to 20 MB · indexed in the background
          </p>
        </div>

        {selectedCount > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-ember-300 dark:border-ember-700 bg-ember-50 dark:bg-ember-950 px-4 py-3 animate-fade-up">
            <p className="text-sm font-medium text-ember-900 dark:text-ember-100 tabular-nums">
              {selectedCount} selected
            </p>
            <button
              type="button"
              onClick={() => setShowWorkspaceModal(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <Icon name="layers" className="w-3.5 h-3.5" />
              New workspace
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-50 transition-colors cursor-pointer"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="mt-10 flex items-center gap-1 border-b border-hairline">
          <button
            type="button"
            onClick={() => setActiveTab("documents")}
            className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "documents"
                ? "border-ember-500 text-ink-900 dark:text-ink-50"
                : "border-transparent text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
            }`}
          >
            Documents
            <span className="font-mono text-eyebrow text-ink-400 tabular-nums">
              {documents.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("workspaces")}
            className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "workspaces"
                ? "border-ember-500 text-ink-900 dark:text-ink-50"
                : "border-transparent text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
            }`}
          >
            Workspaces
            <span className="font-mono text-eyebrow text-ink-400 tabular-nums">
              {workspaces.length}
            </span>
          </button>
        </div>

        {activeTab === "documents" && (
          <section className="mt-6">
            {isLoading ? (
              <div className="py-20 flex flex-col items-center gap-3 text-ink-400">
                <div className="w-6 h-6 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
                <p className="text-sm">Loading your documents…</p>
              </div>
            ) : documents.length === 0 ? (
              <div className="py-16 flex flex-col items-center text-center rounded-xl border border-hairline bg-surface-raised px-6">
                <div className="w-11 h-11 rounded-lg border border-hairline flex items-center justify-center text-ember-600 dark:text-ember-400">
                  <Icon name="document" className="w-5 h-5" />
                </div>
                <h2 className="mt-4 font-display text-heading font-semibold">
                  No documents yet
                </h2>
                <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400 max-w-sm leading-relaxed">
                  Upload your first document and OmniDocs will index it in the background — then you can
                  group documents into a workspace to compare them side by side.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-hairline bg-surface-raised overflow-hidden">
                {documents.length > 0 && (
                  <div className="px-5 py-3 border-b border-hairline flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIds(
                          allCompletedSelected
                            ? new Set()
                            : new Set(completedDocs.map((d) => d.id))
                        );
                      }}
                      className="text-xs font-medium text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-50 transition-colors cursor-pointer"
                    >
                      {allCompletedSelected ? "Clear all" : "Select all ready"}
                    </button>
                    <span className="text-xs text-ink-400">
                      Only completed documents can be grouped.
                    </span>
                  </div>
                )}
                <ul className="divide-y divide-hairline">
                  {documents.map((doc) => {
                    const meta = STATUS_META[doc.status];
                    const checked = selectedIds.has(doc.id);
                    return (
                      <li
                        key={doc.id}
                        className={`flex items-center gap-4 px-5 py-4 transition-colors ${
                          checked ? "bg-ember-50/60 dark:bg-ember-950/40" : "hover:bg-ink-50 dark:hover:bg-ink-900/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={doc.status !== "completed"}
                          onChange={() => handleToggleSelect(doc.id)}
                          aria-label={`Select ${doc.filename}`}
                          className="w-4 h-4 rounded accent-ember-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                        <div className="w-8 h-8 rounded-md border border-hairline bg-surface flex items-center justify-center text-ink-400 shrink-0">
                          <Icon name="documentLines" className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate text-ink-900 dark:text-ink-50">
                            {doc.filename}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-400 tabular-nums">
                            {formatFileSize(doc.file_size)} · {formatDate(doc.uploaded_at)}
                          </p>
                        </div>
                        <span
                          className="inline-flex items-center gap-1.5 shrink-0"
                          title={doc.status}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          <span className={`font-mono text-eyebrow uppercase ${meta.text}`}>
                            {meta.label}
                          </span>
                        </span>
                        {doc.status === "completed" ? (
                          <Link
                            href={`/dashboard/chat/${doc.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-hairline text-xs font-medium text-ink-600 dark:text-ink-300 hover:border-ember-400 hover:text-ember-600 dark:hover:text-ember-400 transition-colors shrink-0"
                            title={`Chat with ${doc.filename}`}
                          >
                            <Icon name="chat" className="w-3.5 h-3.5" />
                            Chat
                          </Link>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-hairline text-xs font-medium text-ink-300 dark:text-ink-600 shrink-0 opacity-60"
                            title={doc.status === "processing" ? "Still indexing" : "Indexing failed"}
                          >
                            <Icon name="chat" className="w-3.5 h-3.5" />
                            Chat
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleReprocess(doc.id)}
                          className="p-1.5 rounded-md text-ink-300 dark:text-ink-600 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer shrink-0"
                          title={`Reprocess ${doc.filename}`}
                        >
                          <Icon name="refresh" className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(doc.id)}
                          className="p-1.5 rounded-md text-ink-300 dark:text-ink-600 hover:text-alert-600 dark:hover:text-alert-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer shrink-0"
                          title={`Delete ${doc.filename}`}
                        >
                          <Icon name="trash" className="w-4 h-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        )}

        {activeTab === "workspaces" && (
          <section className="mt-6">
            {workspaces.length === 0 ? (
              <div className="py-16 flex flex-col items-center text-center rounded-xl border border-hairline bg-surface-raised px-6">
                <div className="w-11 h-11 rounded-lg border border-hairline flex items-center justify-center text-ember-600 dark:text-ember-400">
                  <Icon name="layers" className="w-5 h-5" />
                </div>
                <h2 className="mt-4 font-display text-heading font-semibold">No workspaces yet</h2>
                <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400 max-w-sm leading-relaxed">
                  Select two or more ready documents on the Documents tab to build a workspace —
                  then compare fields across them and see where they disagree.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("documents")}
                  className="mt-5 h-9 px-4 rounded-md border border-hairline text-sm font-medium text-ink-600 dark:text-ink-300 hover:border-ember-400 hover:text-ink-900 dark:hover:text-ink-50 transition-colors cursor-pointer"
                >
                  Go to documents
                </button>
              </div>
            ) : (
              <div className="grid gap-px bg-hairline rounded-xl overflow-hidden border border-hairline sm:grid-cols-2 lg:grid-cols-3">
                {workspaces.map((ws) => (
                  <div key={ws.id} className="group relative bg-surface-raised p-5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteWorkspace(ws.id);
                      }}
                      className="absolute top-4 right-4 p-1.5 rounded-md text-ink-300 dark:text-ink-600 hover:text-alert-600 dark:hover:text-alert-400 hover:bg-ink-100 dark:hover:bg-ink-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer z-20"
                      title={`Delete ${ws.name}`}
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>

                    <Link href={`/dashboard/workspaces/${ws.id}`} className="block">
                      <span className="absolute inset-0" aria-hidden="true" />
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md border border-hairline flex items-center justify-center text-ember-600 dark:text-ember-400 shrink-0">
                          <Icon name="layers" className="w-4 h-4" />
                        </div>
                        <p className="font-mono text-eyebrow uppercase text-ink-400 tabular-nums">
                          {ws.documents.length} doc{ws.documents.length === 1 ? "" : "s"}
                        </p>
                      </div>

                      <h3 className="mt-3.5 font-display text-heading font-semibold truncate text-ink-900 dark:text-ink-50 group-hover:text-ember-600 dark:group-hover:text-ember-400 transition-colors pr-8">
                        {ws.name}
                      </h3>
                      <p className="mt-1 text-xs text-ink-400">Created {formatDate(ws.created_at)}</p>

                      <ul className="mt-4 space-y-1.5">
                        {ws.documents.slice(0, 3).map((doc) => (
                          <li key={doc.id} className="flex items-center gap-2 min-w-0">
                            <span className="w-1 h-1 rounded-full bg-ink-300 dark:bg-ink-600 shrink-0" />
                            <span className="font-mono text-xs text-ink-500 dark:text-ink-400 truncate">
                              {doc.filename}
                            </span>
                          </li>
                        ))}
                        {ws.documents.length > 3 && (
                          <li className="font-mono text-eyebrow uppercase text-ink-400 pl-3 tabular-nums">
                            +{ws.documents.length - 3} more
                          </li>
                        )}
                      </ul>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {showWorkspaceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-ink-950/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-modal-title"
          onClick={() => !isCreatingWorkspace && setShowWorkspaceModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-hairline bg-surface-raised shadow-[0_24px_70px_-30px_rgba(11,15,20,0.6)] animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <h2
                id="workspace-modal-title"
                className="font-display text-heading font-semibold"
              >
                New workspace
              </h2>
              <button
                type="button"
                onClick={() => setShowWorkspaceModal(false)}
                disabled={isCreatingWorkspace}
                className="p-1.5 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer disabled:opacity-40"
                title="Close"
              >
                <Icon name="close" className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-5">
              <label
                htmlFor="workspace-name"
                className="block font-mono text-eyebrow uppercase text-ink-400 mb-2"
              >
                Name
              </label>
              <input
                id="workspace-name"
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isCreatingWorkspace) handleCreateWorkspace();
                }}
                placeholder="Q3 vendor contracts"
                autoFocus
                className="w-full h-10 px-3 rounded-md border border-hairline bg-surface text-sm text-ink-900 dark:text-ink-50 placeholder:text-ink-400 focus:border-ember-500 outline-none transition-colors"
              />

              <p className="mt-5 font-mono text-eyebrow uppercase text-ink-400 tabular-nums">
                {selectedCount} document{selectedCount === 1 ? "" : "s"} included
              </p>
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-hairline divide-y divide-hairline">
                {documents
                  .filter((doc) => selectedIds.has(doc.id))
                  .map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 px-3 py-2 min-w-0">
                      <Icon name="documentLines" className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                      <span className="font-mono text-xs text-ink-600 dark:text-ink-300 truncate">
                        {doc.filename}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-hairline">
              <button
                type="button"
                onClick={() => setShowWorkspaceModal(false)}
                disabled={isCreatingWorkspace}
                className="h-9 px-4 rounded-md text-sm font-medium text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-50 transition-colors cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateWorkspace}
                disabled={isCreatingWorkspace || !workspaceName.trim()}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCreatingWorkspace && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                )}
                {isCreatingWorkspace ? "Creating…" : "Create workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
