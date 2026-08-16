import React, { useState } from "react";
import { render as rtlRender, renderHook, screen, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/features/i18n/LanguageContext";
import { AuthContext, type AuthContextType } from "@/features/auth/AuthContext";
import { DemoProvider } from "@/features/demo/DemoContext";
import { createTestQueryClient } from "./queryClient";

export { screen };

interface Options {
  queryClient?: QueryClient;
  /**
   * Seeds a test-only `AuthContext.Provider` (real `AuthContext`, not a mock module) with
   * these fields merged onto permissive defaults, mounted directly under the
   * `QueryClientProvider`/`LanguageProvider` and wrapping a real `DemoProvider` — so any
   * component under test that calls `useAuth()` and/or `useDemo()` (directly, or via
   * something it renders) sees a working, controllable org/role instead of throwing
   * "must be used within *Provider". Omit this option entirely for components that don't
   * touch auth/demo context — the render tree is then unchanged from before this option
   * existed (no `AuthContext.Provider`/`DemoProvider` mounted), so existing callers are
   * unaffected.
   */
  authOverrides?: Partial<AuthContextType>;
}

/** Sane, permissive defaults for the test-only auth context — a signed-in admin with no
 *  active org. Individual fields are overridden per test via `authOverrides`. */
function defaultAuthValue(): AuthContextType {
  return {
    user: null,
    session: null,
    roles: ["admin"],
    memberships: [],
    orgs: [],
    currentOrg: null,
    isSuperAdmin: false,
    switchOrg: () => {},
    refreshOrgs: async () => {},
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
    hasRole: () => true,
    viewAsRole: null,
    setViewAsRole: () => {},
    viewAsUser: null,
    setViewAsUser: () => {},
  };
}

/** Test-only `AuthContext.Provider` (see `Options.authOverrides`). `viewAsRole` is kept as
 *  real React state (seeded from the override, falling back to the override's own setter
 *  when one is supplied) so components that call `setViewAsRole` — e.g. `DemoBar`'s role
 *  toggle — see the change reflected on the next render, not just a fired spy. */
function AuthTestProvider({ overrides, children }: { overrides: Partial<AuthContextType>; children: React.ReactNode }) {
  const [viewAsRole, setViewAsRoleState] = useState<AuthContextType["viewAsRole"]>(overrides.viewAsRole ?? null);
  const value: AuthContextType = {
    ...defaultAuthValue(),
    ...overrides,
    viewAsRole,
    setViewAsRole: overrides.setViewAsRole ?? setViewAsRoleState,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Mirror the app's global providers (see src/App.tsx): the whole tree is wrapped in a
// TooltipProvider, so any component using a Tooltip — directly or via IconTooltip — can
// render in tests without each test having to mount its own provider. `authOverrides` opts
// a test into the auth + demo layer (see Options.authOverrides) — most callers don't need it.
function Wrapper({
  queryClient,
  authOverrides,
  children,
}: {
  queryClient: QueryClient;
  authOverrides?: Partial<AuthContextType>;
  children: React.ReactNode;
}) {
  const body = <TooltipProvider>{children}</TooltipProvider>;
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        {authOverrides ? (
          <AuthTestProvider overrides={authOverrides}>
            <DemoProvider>{body}</DemoProvider>
          </AuthTestProvider>
        ) : (
          body
        )}
      </LanguageProvider>
    </QueryClientProvider>
  );
}

/** Render a component with a QueryClientProvider (and, when `authOverrides` is passed, a
 *  test-only AuthContext + DemoProvider). Returns the testing-library result + the queryClient. */
export function renderWithProviders(ui: React.ReactElement, opts: Options & Omit<RenderOptions, "wrapper"> = {}) {
  const { queryClient = createTestQueryClient(), authOverrides, ...rtl } = opts;
  const result = rtlRender(ui, {
    wrapper: ({ children }) => (
      <Wrapper queryClient={queryClient} authOverrides={authOverrides}>
        {children}
      </Wrapper>
    ),
    ...rtl,
  });
  return { ...result, queryClient };
}

/** Alias of `renderWithProviders` for call sites that prefer the plain `render` name
 *  (e.g. `import { render, screen } from '@/test/renderWithProviders'`). */
export const render = renderWithProviders;

/** renderHook variant wrapped in a QueryClientProvider. */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  opts: Options = {},
) {
  const { queryClient = createTestQueryClient(), authOverrides } = opts;
  const result = renderHook(hook, {
    wrapper: ({ children }) => (
      <Wrapper queryClient={queryClient} authOverrides={authOverrides}>
        {children}
      </Wrapper>
    ),
  });
  return { ...result, queryClient };
}
