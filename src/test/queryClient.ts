import { QueryClient } from "@tanstack/react-query";

/** A QueryClient configured for tests: no retries, no refetch noise. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
