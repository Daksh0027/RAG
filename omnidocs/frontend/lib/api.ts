const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  token?: string | null
) {
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }

  // Handle empty or JSON responses
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

/**
 * Fetches a binary resource and returns it as an object URL.
 * Used for the PDF viewer, which needs the Authorization header — something
 * an <iframe src> can't send on its own.
 *
 * Callers own the returned URL and must revoke it when finished.
 */
export async function apiFetchBlobUrl(
  path: string,
  token?: string | null
): Promise<string> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }

  return URL.createObjectURL(await response.blob());
}

export interface StreamHandlers {
  /** Retrieved citations, delivered once before any answer text. */
  onSources?: (sources: unknown[]) => void;
  /** An incremental chunk of the answer. */
  onDelta?: (text: string) => void;
  /** Terminal success, carrying the complete answer. */
  onDone?: (content: string) => void;
}

/**
 * POSTs a message and consumes the Server-Sent Events response.
 *
 * Resolves once the stream completes. Rejects if the request fails outright,
 * or if the server emits an `error` frame mid-stream (which it must, because
 * the HTTP status has already been sent by the time generation can fail).
 */
export async function apiStream(
  path: string,
  body: unknown,
  token: string | null | undefined,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error("This browser cannot read streaming responses.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;

  const handleFrame = (frame: string) => {
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }

    if (dataLines.length === 0) return;

    let payload: any;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return; // Ignore malformed frames rather than aborting the stream.
    }

    if (eventName === "sources") handlers.onSources?.(payload.sources ?? []);
    else if (eventName === "delta") handlers.onDelta?.(payload.text ?? "");
    else if (eventName === "done") handlers.onDone?.(payload.content ?? "");
    else if (eventName === "error") streamError = payload.detail || "The response failed.";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) handleFrame(buffer);
  if (streamError) throw new Error(streamError);
}
