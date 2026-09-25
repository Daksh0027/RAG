/**
 * Centralised React Query hooks for all API data-fetching.
 *
 * Each hook accepts a `getToken` function from Clerk's `useAuth()` and
 * returns the standard React Query result object.  Components can read
 * `data`, `isLoading`, `error`, and call `refetch()` directly from the
 * result.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------------
// Query key factory — keeps keys consistent across hooks and manual
// invalidations so the cache never goes stale from a key mismatch.
// ---------------------------------------------------------------------------
export const queryKeys = {
  documents: () => ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
  chatHistory: (documentId: string) => ["chat", documentId] as const,
  workspaces: () => ["workspaces"] as const,
  workspace: (id: string) => ["workspaces", id] as const,
  workspaceChatHistory: (workspaceId: string) => ["workspaceChat", workspaceId] as const,
};

type GetToken = () => Promise<string | null>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** All documents for the current user. */
export function useDocuments(getToken: GetToken, enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents(),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch("/api/documents", {}, token);
    },
    enabled,
  });
}

/** A single document by ID. */
export function useDocument(id: string, getToken: GetToken, enabled = true) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch(`/api/documents/${id}`, {}, token);
    },
    enabled: enabled && Boolean(id),
  });
}

/** Chat history for a single document. */
export function useDocumentChatHistory(
  documentId: string,
  getToken: GetToken,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.chatHistory(documentId),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch(`/api/documents/${documentId}/chat`, {}, token);
    },
    enabled: enabled && Boolean(documentId),
    // Chat history is always up-to-date server-side; treat it as immediately
    // stale so it refetches on focus after the user sends a message and
    // navigates away then back.
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/** All workspaces for the current user. */
export function useWorkspaces(getToken: GetToken, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch("/api/workspaces", {}, token);
    },
    enabled,
  });
}

/** A single workspace with its documents. */
export function useWorkspace(id: string, getToken: GetToken, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspace(id),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch(`/api/workspaces/${id}`, {}, token);
    },
    enabled: enabled && Boolean(id),
  });
}

/** Chat history for a workspace. */
export function useWorkspaceChatHistory(
  workspaceId: string,
  getToken: GetToken,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.workspaceChatHistory(workspaceId),
    queryFn: async () => {
      const token = await getToken();
      return apiFetch(`/api/workspaces/${workspaceId}/chat`, {}, token);
    },
    enabled: enabled && Boolean(workspaceId),
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

/**
 * Returns helpers for manually invalidating query cache entries.
 * Use these after mutations (upload, delete, update) to trigger a refetch.
 *
 * Example:
 *   const { invalidateDocuments } = useInvalidators();
 *   await apiFetch("/api/documents", { method: "POST", body: formData }, token);
 *   invalidateDocuments();
 */
export function useInvalidators() {
  const queryClient = useQueryClient();

  return {
    invalidateDocuments: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.documents() }),

    invalidateDocument: (id: string) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.document(id) }),

    invalidateWorkspaces: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() }),

    invalidateWorkspace: (id: string) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(id) }),

    invalidateChatHistory: (documentId: string) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.chatHistory(documentId) }),

    invalidateWorkspaceChatHistory: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceChatHistory(workspaceId),
      }),
  };
}
