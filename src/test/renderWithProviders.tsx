import React from "react";
import { render, renderHook, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "./queryClient";

interface Options {
  queryClient?: QueryClient;
}

function Wrapper({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Render a component with a QueryClientProvider. Returns the testing-library result + the queryClient. */
export function renderWithProviders(ui: React.ReactElement, opts: Options & Omit<RenderOptions, "wrapper"> = {}) {
  const { queryClient = createTestQueryClient(), ...rtl } = opts;
  const result = render(ui, {
    wrapper: ({ children }) => <Wrapper queryClient={queryClient}>{children}</Wrapper>,
    ...rtl,
  });
  return { ...result, queryClient };
}

/** renderHook variant wrapped in a QueryClientProvider. */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  opts: Options = {},
) {
  const { queryClient = createTestQueryClient() } = opts;
  const result = renderHook(hook, {
    wrapper: ({ children }) => <Wrapper queryClient={queryClient}>{children}</Wrapper>,
  });
  return { ...result, queryClient };
}
