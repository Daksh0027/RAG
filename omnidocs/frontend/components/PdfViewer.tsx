"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetchBlobUrl } from "../lib/api";

interface PdfViewerProps {
  documentId: string;
  filename?: string;
  /** Page to land on. Changing this re-navigates the embedded viewer. */
  page?: number | null;
  className?: string;
}

/**
 * Renders a stored PDF using the browser's built-in viewer.
 *
 * Two constraints shape this component:
 *
 * 1. The file endpoint requires an Authorization header, which an
 *    `<iframe src>` cannot send. So the bytes are fetched once with the
 *    Clerk token and handed to the iframe as an object URL.
 * 2. Changing only the `#page=` fragment on an already-loaded iframe does
 *    not reliably re-navigate in Chrome or Safari. Remounting the iframe
 *    does. The `key` below forces that remount; the blob is already in
 *    memory, so it costs a repaint rather than a re-download.
 */
export default function PdfViewer({
  documentId,
  filename,
  page,
  className = "",
}: PdfViewerProps) {
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Held in a ref so the cleanup function revokes the URL that was actually
  // created, not whatever the last render happened to close over.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const url = await apiFetchBlobUrl(`/api/documents/${documentId}/file`, token);

        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        objectUrlRef.current = url;
        setBlobUrl(url);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open this PDF.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [documentId, getToken]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-ink-200 dark:border-ink-700 border-t-ember-500 animate-spin" />
          <p className="text-xs font-mono text-ink-400">Opening {filename ?? "document"}…</p>
        </div>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className={`flex items-center justify-center p-6 ${className}`}>
        <div className="text-center space-y-2 max-w-xs">
          <p className="text-sm text-ink-600 dark:text-ink-300">{error ?? "Could not open this PDF."}</p>
          <p className="text-xs text-ink-400">
            The file may still be uploading, or it was removed from storage.
          </p>
        </div>
      </div>
    );
  }

  const target = page && page > 0 ? `${blobUrl}#page=${page}&view=FitH` : `${blobUrl}#view=FitH`;

  return (
    <iframe
      key={target}
      src={target}
      title={filename ? `${filename}, page ${page ?? 1}` : "Document preview"}
      className={`w-full border-0 bg-ink-100 dark:bg-ink-900 ${className}`}
    />
  );
}
