import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase } from "@/test/supabaseFake";
import { partialMock } from "@/test/castHelpers";
import type { AppRole } from "@/config/app.config";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { EditorProvider, useEditor } from "./EditorContext";

const ORG = { id: "o1", name: "Acme", slug: "acme", status: "active" };
const KEY = "showflow_editor_mode";

/** Mutable so a test can resolve identity AFTER mount, as AuthProvider really does. */
let auth = { roles: [] as AppRole[], isSuperAdmin: false };

function setAuth(roles: AppRole[], isSuperAdmin: boolean) {
  auth = { roles, isSuperAdmin };
}

function renderEditor() {
  return renderHook(() => useEditor(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={createTestQueryClient()}>
        <EditorProvider>{children}</EditorProvider>
      </QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase({}));
  setAuth([], false);
  vi.mocked(useAuth).mockImplementation(() =>
    partialMock<ReturnType<typeof useAuth>>({ ...auth, currentOrg: ORG }),
  );
});

describe("EditorProvider access gate", () => {
  it("allows an admin of the active org", () => {
    setAuth(["admin"], false);
    localStorage.setItem(KEY, "true");
    expect(renderEditor().result.current.isEditorMode).toBe(true);
  });

  it("allows a super-admin holding no role in the active org", () => {
    setAuth([], true);
    localStorage.setItem(KEY, "true");
    expect(renderEditor().result.current.isEditorMode).toBe(true);
  });

  it("keeps a producer out even with the flag set", () => {
    setAuth(["producer"], false);
    localStorage.setItem(KEY, "true");
    expect(renderEditor().result.current.isEditorMode).toBe(false);
  });

  it("exits editor mode when access is lost mid-session", () => {
    setAuth(["admin"], false);
    localStorage.setItem(KEY, "true");
    const { result, rerender } = renderEditor();
    expect(result.current.isEditorMode).toBe(true);

    setAuth(["producer"], false);
    rerender();

    expect(result.current.isEditorMode).toBe(false);
  });
});

describe("EditorProvider persistence", () => {
  // The regression: EditorProvider mounts inside AuthProvider above the routes, so the
  // first render always has empty roles and isSuperAdmin false. Restoring in the
  // useState initializer silently never fired, and the old write-through effect then
  // deleted the flag on that same pre-auth render.
  it("restores editor mode when identity resolves after mount", () => {
    localStorage.setItem(KEY, "true");
    const { result, rerender } = renderEditor();
    expect(result.current.isEditorMode).toBe(false);

    setAuth(["admin"], false);
    rerender();

    expect(result.current.isEditorMode).toBe(true);
  });

  it("leaves the stored flag alone while identity is still unresolved", () => {
    localStorage.setItem(KEY, "true");
    renderEditor();
    expect(localStorage.getItem(KEY)).toBe("true");
  });

  it("stores the flag when editor mode is entered", () => {
    setAuth(["admin"], false);
    const { result } = renderEditor();

    act(() => result.current.enableEditorMode());

    expect(result.current.isEditorMode).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("true");
  });

  it("clears the stored flag when editor mode is exited", () => {
    setAuth(["admin"], false);
    localStorage.setItem(KEY, "true");
    const { result } = renderEditor();

    act(() => result.current.disableEditorMode());

    expect(result.current.isEditorMode).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("EditorProvider toolbar visibility", () => {
  it("hides and shows the toolbar without leaving editor mode", () => {
    setAuth(["admin"], false);
    const { result } = renderEditor();
    act(() => result.current.enableEditorMode());
    expect(result.current.isToolbarHidden).toBe(false);

    act(() => result.current.hideToolbar());
    expect(result.current.isToolbarHidden).toBe(true);
    expect(result.current.isEditorMode).toBe(true); // still in editor mode

    act(() => result.current.showToolbar());
    expect(result.current.isToolbarHidden).toBe(false);
  });

  it("re-shows the bar when editor mode is re-entered after a hidden exit", () => {
    setAuth(["admin"], false);
    const { result } = renderEditor();
    act(() => result.current.enableEditorMode());
    act(() => result.current.hideToolbar());
    expect(result.current.isToolbarHidden).toBe(true);

    act(() => result.current.disableEditorMode());
    act(() => result.current.enableEditorMode());
    expect(result.current.isToolbarHidden).toBe(false);
  });
});
