import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
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

function renderEditor(roles: AppRole[], isSuperAdmin: boolean) {
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({ roles, isSuperAdmin, currentOrg: ORG }),
  );
  const queryClient = createTestQueryClient();
  return renderHook(() => useEditor(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <EditorProvider>{children}</EditorProvider>
      </QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase({}));
  // Editor mode was left switched on in a previous session.
  localStorage.setItem("showflow_editor_mode", "true");
});

afterEach(() => localStorage.clear());

describe("EditorProvider access gate", () => {
  it("keeps editor mode for a super-admin holding no role in the active org", () => {
    const { result } = renderEditor([], true);
    expect(result.current.isEditorMode).toBe(true);
  });

  it("keeps editor mode for an admin of the active org", () => {
    const { result } = renderEditor(["admin"], false);
    expect(result.current.isEditorMode).toBe(true);
  });

  it("drops editor mode for a producer", () => {
    const { result } = renderEditor(["producer"], false);
    expect(result.current.isEditorMode).toBe(false);
  });
});
