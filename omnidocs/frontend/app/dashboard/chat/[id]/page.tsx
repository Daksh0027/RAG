"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { apiFetch, apiStream } from "../../../../lib/api";
import { useTheme } from "../../../../lib/theme";
import { useSpeech } from "../../../../lib/speech";
import PdfViewer from "../../../../components/PdfViewer";
import { markdownComponents } from "../../../../components/markdown";
import Icon from "../../../../components/Icon";

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
  /** True while tokens are still arriving for this message. */
  streaming?: boolean;
}

interface DocumentMeta {
  id: string;
  filename: string;
  file_size: number;
  status: "processing" | "completed" | "failed";
  uploaded_at: string;
}

interface SelectedCitation {
  citation: Citation;
  messageIndex: number;
  sourceIndex: number;
}

type InspectorTab = "passage" | "page";

export default function ChatPage() {
  const params = useParams();
  const { isLoaded, userId, getToken } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { speak, speakingId, isSupported: isSpeechSupported } = useSpeech();

  const documentId = params?.id as string;

  const [document, setDocument] = useState<DocumentMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<number, boolean>>({});

  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);
  const [flashToken, setFlashToken] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("passage");
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  // Resizable sidebar states & logic
  const [sidebarWidth, setSidebarWidth] = useState(416);
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
    window.document.removeEventListener("mousemove", handleMouseMove);
    window.document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    window.document.addEventListener("mousemove", handleMouseMove);
    window.document.addEventListener("mouseup", handleMouseUp);
  };

  useEffect(() => {
    return () => {
      window.document.removeEventListener("mousemove", handleMouseMove);
      window.document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleSources = (index: number) => {
    setExpandedSources((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  // Selecting a citation flashes the passage and, if the page view is open,
  // moves the PDF to the cited page.
  const selectCitation = (messageIndex: number, sourceIndex: number, citation: Citation) => {
    setSelectedCitation({ citation, messageIndex, sourceIndex });
    setFlashToken((t) => t + 1);
    setMobileInspectorOpen(true);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // Abort any in-flight stream when the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchChatHistory = useCallback(async () => {
    try {
      setIsLoadingChat(true);
      const token = await getToken();
      const history = await apiFetch(`/api/documents/${documentId}/chat`, {}, token);
      setMessages(history);
    } catch (err) {
      console.error("Could not load chat history:", err);
    } finally {
      setIsLoadingChat(false);
    }
  }, [documentId, getToken]);

  const fetchDocumentDetails = useCallback(async () => {
    try {
      setIsLoadingDocument(true);
      setError(null);
      const token = await getToken();
      const doc: DocumentMeta = await apiFetch(`/api/documents/${documentId}`, {}, token);
      setDocument(doc);
      if (doc.status === "completed") await fetchChatHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this document.");
    } finally {
      setIsLoadingDocument(false);
    }
  }, [documentId, getToken, fetchChatHistory]);

  useEffect(() => {
    if (isLoaded && userId && documentId) fetchDocumentDetails();
  }, [isLoaded, userId, documentId, fetchDocumentDetails]);

  // Poll while indexing is in progress.
  useEffect(() => {
    if (!document || document.status !== "processing") return;

    const interval = setInterval(async () => {
      try {
        const token = await getToken();
        const doc: DocumentMeta = await apiFetch(`/api/documents/${documentId}`, {}, token);
        if (doc.status !== "processing") {
          setDocument(doc);
          if (doc.status === "completed") fetchChatHistory();
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Error polling document status:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [document, documentId, getToken, fetchChatHistory]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputMessage.trim();
    if (!query || isSending) return;

    setInputMessage("");
    setIsSending(true);
    setError(null);

    // Optimistically show the question and an empty answer to stream into.
    setMessages((prev) => [
      ...prev,
      { role: "user", content: query },
      { role: "assistant", content: "", streaming: true },
    ]);

    // Mutates the trailing assistant message, which is always the last entry
    // for the duration of this send.
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
        `/api/documents/${documentId}/chat/stream`,
        { message: query },
        token,
        {
          onSources: (sources) => updateAnswer({ sources: sources as Citation[] }),
          onDelta: (text) => {
            answer += text;
            updateAnswer({ content: answer });
          },
          onDone: (content) => updateAnswer({ content: content || answer, streaming: false }),
        },
        controller.signal
      );
    } catch (err) {
      // Roll back both the placeholder and the question so a failed send
      // doesn't leave an orphaned bubble the user can't retry from.
      setMessages((prev) => prev.slice(0, -2));
      setInputMessage(query);
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Could not send that message.");
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  };

  const handleDownloadChat = () => {
    if (messages.length === 0) return;
    const content = messages.map(m => `**${m.role === "user" ? "User" : "Assistant"}**: ${m.content}`).join("\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "chat.md";
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "0 KB";
    const units = ["B", "KB", "MB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`;
  };

  // The most recent answer that carries citations, so the inspector has
  // something to show before anything is clicked.
  let latestSourcesEntry: { message: Message; index: number } | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.sources && m.sources.length > 0) {
      latestSourcesEntry = { message: m, index: i };
      break;
    }
  }

  const activePage = selectedCitation?.citation.page_number ?? null;

  const statusStyles: Record<DocumentMeta["status"], { text: string; dot: string; label: string }> = {
    processing: { text: "text-ember-600 dark:text-ember-400", dot: "bg-ember-500", label: "Indexing" },
    failed: { text: "text-alert-600 dark:text-alert-400", dot: "bg-alert-500", label: "Failed" },
    completed: { text: "text-signal-600 dark:text-signal-400", dot: "bg-signal-500", label: "Indexed" },
  };
  const status = document ? statusStyles[document.status] : null;

  const renderPassage = () => {
    if (selectedCitation) {
      const { citation, sourceIndex } = selectedCitation;
      return (
        <div key={`selected-${flashToken}`} className="highlight-flash rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-eyebrow uppercase text-ember-700 dark:text-ember-400">
              Source {sourceIndex + 1}
            </span>
            {citation.page_number && (
              <span className="font-mono text-xs text-ink-400">p. {citation.page_number}</span>
            )}
          </div>
          <p className="font-mono text-xs text-ink-400 truncate" title={document?.filename}>
            {document?.filename}
          </p>
          <p className="text-sm text-ink-700 dark:text-ink-200 leading-relaxed whitespace-pre-wrap">
            {citation.content}
          </p>
        </div>
      );
    }

    if (latestSourcesEntry) {
      return (
        <div className="space-y-3">
          <p className="font-mono text-eyebrow uppercase text-ink-400">Cited in the last answer</p>
          <div className="space-y-2">
            {latestSourcesEntry.message.sources!.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectCitation(latestSourcesEntry!.index, i, s)}
                className="w-full text-left p-3 rounded-lg border border-hairline bg-surface-raised hover:border-ember-400 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-mono text-eyebrow uppercase text-ember-700 dark:text-ember-400">
                    Source {i + 1}
                  </span>
                  {s.page_number && (
                    <span className="font-mono text-xs text-ink-400">p. {s.page_number}</span>
                  )}
                </div>
                <p className="text-xs text-ink-500 dark:text-ink-400 leading-relaxed line-clamp-2">
                  {s.content}
                </p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-12 px-4">
        <Icon name="documentLines" className="w-6 h-6 text-ink-300 dark:text-ink-600" />
        <p className="text-sm text-ink-400 max-w-[22ch]">
          Click a citation to read the passage it came from.
        </p>
      </div>
    );
  };

  const renderInspector = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex shrink-0 border-b border-hairline">
        {(["passage", "page"] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setInspectorTab(tab)}
            className={`relative px-4 py-3 font-mono text-eyebrow uppercase transition-colors cursor-pointer ${
              inspectorTab === tab
                ? "text-ink-900 dark:text-ink-50"
                : "text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
            }`}
          >
            {tab === "passage" ? "Passage" : "Page"}
            {inspectorTab === tab && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 bg-ember-500" />
            )}
          </button>
        ))}
        {activePage && (
          <span className="ml-auto self-center pr-4 font-mono text-xs text-ink-400">
            p. {activePage}
          </span>
        )}
      </div>

      {inspectorTab === "passage" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">{renderPassage()}</div>
      ) : (
        <PdfViewer
          documentId={documentId}
          filename={document?.filename}
          page={activePage}
          className="flex-1 min-h-0"
        />
      )}
    </div>
  );

  if (!isLoaded || isLoadingDocument) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
          <p className="font-mono text-eyebrow uppercase text-ink-400">Loading document</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-surface text-ink-900 dark:text-ink-50">
      <header className="shrink-0 h-14 border-b border-hairline bg-surface-raised">
        <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-1.5 -ml-1.5 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors shrink-0"
              title="Back to documents"
            >
              <Icon name="arrowLeft" className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <h1
                className="font-mono text-sm text-ink-900 dark:text-ink-50 truncate"
                title={document?.filename}
              >
                {document?.filename}
              </h1>
              {document && status && (
                <p className="flex items-center gap-2 font-mono text-eyebrow uppercase text-ink-400">
                  <span className={`inline-flex items-center gap-1.5 ${status.text}`}>
                    <span
                      className={`w-1 h-1 rounded-full ${status.dot} ${
                        document.status === "processing" ? "animate-pulse" : ""
                      }`}
                    />
                    {status.label}
                  </span>
                  <span className="text-ink-300 dark:text-ink-600">/</span>
                  <span>{formatFileSize(document.file_size)}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadChat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer"
              >
                <Icon name="document" className="w-3.5 h-3.5" />
                Download Chat
              </button>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-2 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer shrink-0"
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-4 sm:px-6 pt-3">
          <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-alert-200 dark:border-alert-800 bg-alert-50 dark:bg-alert-900/30 text-sm text-alert-700 dark:text-alert-200">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 text-alert-500 hover:text-alert-700 dark:hover:text-alert-200 cursor-pointer"
              title="Dismiss"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {document && document.status === "processing" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 p-6">
            <div className="w-10 h-10 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
            <div className="space-y-1.5 max-w-sm">
              <h2 className="font-display text-title">Indexing this document</h2>
              <p className="text-sm text-ink-500 dark:text-ink-400">
                Extracting text, splitting it into passages, and building embeddings. This usually
                takes a few seconds.
              </p>
            </div>
            <button
              onClick={fetchDocumentDetails}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-hairline bg-surface-raised font-mono text-eyebrow uppercase text-ink-600 dark:text-ink-300 hover:border-ember-400 transition-colors cursor-pointer"
            >
              <Icon name="refresh" className="w-3.5 h-3.5" />
              Check now
            </button>
          </div>
        ) : document && document.status === "failed" ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 p-6">
            <Icon name="warning" className="w-8 h-8 text-alert-500" />
            <div className="space-y-1.5 max-w-sm">
              <h2 className="font-display text-title">Indexing failed</h2>
              <p className="text-sm text-ink-500 dark:text-ink-400">
                Text extraction or embedding didn&apos;t complete. Scanned PDFs with no text layer
                and corrupt files can&apos;t be indexed.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center h-9 px-4 rounded-md bg-ink-900 dark:bg-ink-50 text-ink-50 dark:text-ink-900 font-medium text-sm hover:bg-ink-700 dark:hover:bg-ink-200 transition-colors"
            >
              Back to documents
            </Link>
          </div>
        ) : (
          <>
            <main className="flex-1 min-h-0 flex flex-col overflow-hidden border-r border-hairline">
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
                  {messages.length === 0 && !isLoadingChat && (
                    <div className="pt-16 text-center space-y-3">
                      <h2 className="font-display text-title">Ask this document a question</h2>
                      <p className="text-sm text-ink-500 dark:text-ink-400 max-w-md mx-auto leading-relaxed">
                        Every answer comes back with the passages it was drawn from, and the page
                        each one sits on.
                      </p>
                    </div>
                  )}

                  {isLoadingChat && (
                    <div className="space-y-4 pt-4">
                      <div className="h-14 w-2/3 rounded-lg shimmer-bg" />
                      <div className="h-14 w-1/2 rounded-lg shimmer-bg ml-auto" />
                      <div className="h-14 w-3/5 rounded-lg shimmer-bg" />
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
                          OmniDocs
                        </p>
                        <div className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                          {msg.content ? (
                            <ReactMarkdown components={markdownComponents}>
                              {msg.content}
                            </ReactMarkdown>
                          ) : (
                            <span className="font-mono text-xs text-ink-400">
                              Reading the document…
                            </span>
                          )}
                          {msg.streaming && msg.content && <span className="stream-caret" />}
                        </div>

                        {!msg.streaming && msg.content && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                            {msg.sources && msg.sources.length > 0 && (
                              <button
                                type="button"
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
                                type="button"
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
                          <div className="mt-3 grid gap-px bg-hairline rounded-lg overflow-hidden border border-hairline">
                            {msg.sources.map((source, srcIdx) => {
                              const isSelected =
                                selectedCitation?.messageIndex === index &&
                                selectedCitation?.sourceIndex === srcIdx;
                              return (
                                <button
                                  key={srcIdx}
                                  type="button"
                                  onClick={() => selectCitation(index, srcIdx, source)}
                                  className={`text-left px-3 py-2.5 transition-colors cursor-pointer ${
                                    isSelected
                                      ? "bg-ember-50 dark:bg-ember-900/25"
                                      : "bg-surface-raised hover:bg-ink-50 dark:hover:bg-ink-800"
                                  }`}
                                >
                                  <div className="flex items-baseline gap-3">
                                    <span
                                      className={`font-mono text-eyebrow uppercase shrink-0 ${
                                        isSelected
                                          ? "text-ember-700 dark:text-ember-400"
                                          : "text-ink-400"
                                      }`}
                                    >
                                      {srcIdx + 1}
                                      {source.page_number ? ` · p.${source.page_number}` : ""}
                                    </span>
                                    <span className="text-xs text-ink-500 dark:text-ink-400 line-clamp-1">
                                      {source.content}
                                    </span>
                                  </div>
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

              <form
                onSubmit={handleSendMessage}
                className="shrink-0 border-t border-hairline bg-surface-raised px-4 sm:px-6 py-3"
              >
                <div className="max-w-3xl mx-auto flex items-center gap-2 rounded-lg border border-hairline bg-surface focus-within:border-ember-500 transition-colors px-3 py-1.5">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Ask about this document…"
                    aria-label="Your question"
                    className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-400 h-8 leading-8"
                    disabled={isSending}
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || isSending}
                    aria-label="Send question"
                    className="w-8 h-8 rounded-md bg-ember-500 hover:bg-ember-600 flex items-center justify-center text-white transition-colors active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer shrink-0"
                  >
                    <Icon name="arrowRight" weight={2} className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </main>

            {/* Resize Handle */}
            <div
              onMouseDown={handleMouseDown}
              className="hidden md:block w-1 hover:w-1.5 active:w-1.5 bg-hairline hover:bg-ember-500 active:bg-ember-500 cursor-col-resize transition-all shrink-0 select-none"
            />

            <aside
              style={{ width: `${sidebarWidth}px` }}
              className="hidden md:flex md:flex-col shrink-0 bg-surface-raised overflow-hidden"
            >
              {renderInspector()}
            </aside>

            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setMobileInspectorOpen(true)}
                className="fixed bottom-20 right-4 z-30 w-11 h-11 rounded-full bg-ink-900 dark:bg-ink-50 text-ink-50 dark:text-ink-900 shadow-lg flex items-center justify-center cursor-pointer"
                title="Open sources"
              >
                <Icon name="documentLines" className="w-4.5 h-4.5" />
                {selectedCitation && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-ember-500 ring-2 ring-surface-raised" />
                )}
              </button>

              {mobileInspectorOpen && (
                <div className="fixed inset-0 z-40 flex flex-col justify-end">
                  <div
                    className="absolute inset-0 bg-ink-950/40"
                    onClick={() => setMobileInspectorOpen(false)}
                  />
                  <div className="relative bg-surface-raised rounded-t-xl border-t border-hairline h-[75vh] flex flex-col shadow-xl">
                    <div className="flex items-center justify-end px-2 pt-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setMobileInspectorOpen(false)}
                        className="p-2 rounded-md text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 cursor-pointer"
                        aria-label="Close sources"
                      >
                        <Icon name="close" className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0">{renderInspector()}</div>
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
