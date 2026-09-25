"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef } from "react";

/**
 * Creates a stable QueryClient per component tree and wraps children with
 * QueryClientProvider.  Import this in layout.tsx to enable React Query
 * throughout the app.
 *
 * Cache policy:
 *  - staleTime: 30 s  — data is considered fresh for 30 seconds after fetch,
 *    so navigating between pages doesn't trigger redundant refetches.
 *  - gcTime: 5 min    — unused cache entries are garbage-collected after
 *    5 minutes (React Query v5 renamed cacheTime → gcTime).
 *  - retry: 1         — retry failed requests once before surfacing the error.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<QueryClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,      // 30 s
          gcTime: 5 * 60_000,     // 5 min
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    });
  }

  return (
    <QueryClientProvider client={clientRef.current}>
      {children}
    </QueryClientProvider>
  );
}
