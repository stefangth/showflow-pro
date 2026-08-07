import React from "react";
import { render, renderHook, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createTestQueryClient } from "./queryClient";

interface Options {
  queryClient?: QueryClient;
}

// Mirror the app's global providers (see src/App.tsx): the whole tree is wrapped in a
// TooltipProvider, so any component using a Tooltip — directly or via IconTooltip — can
// render in tests without each test having to mount its own provider.
function Wrapper({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
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
