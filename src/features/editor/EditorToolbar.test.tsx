import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import { partialMock } from "@/test/castHelpers";

// Call-recording fake in a hoisted holder (never a hand-rolled vi.mock chain). The
// toolbar invokes `admin-list-users` for its impersonation dropdown.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("./EditorContext", () => ({ useEditor: vi.fn() }));
// The side panel is a separate surface with its own router/context needs; the toolbar
// renders it unconditionally at open={false}, so stub it out.
vi.mock("./EditorSidePanel", () => ({ EditorSidePanel: () => null }));

import { useAuth } from "@/features/auth/AuthContext";
import { useEditor } from "./EditorContext";
import { EditorToolbar } from "./EditorToolbar";

const ACME = { id: "o1", name: "Acme", slug: "acme", status: "active" };
const BETA = { id: "o2", name: "Beta Productions", slug: "beta", status: "active" };
const GONE = { id: "o3", name: "Dormant Co", slug: "dormant", status: "suspended" };

function setAuth(over: Partial<ReturnType<typeof useAuth>> = {}) {
  const switchOrg = vi.fn();
  const setViewAsUser = vi.fn();
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({
      roles: ["admin"],
      isSuperAdmin: false,
      orgs: [ACME, BETA],
      currentOrg: ACME,
      switchOrg,
      viewAsRole: null,
      setViewAsRole: vi.fn(),
      viewAsUser: null,
      setViewAsUser,
      ...over,
    }),
  );
  return { switchOrg, setViewAsUser };
}

function orgSelect() {
  return screen.getByLabelText("Editor organization");
}

beforeEach(() => {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase({ "fn:admin-list-users": { data: { users: [] }, error: null } }));
  vi.mocked(useEditor).mockReturnValue(
    partialMock<ReturnType<typeof useEditor>>({
      isEditorMode: true,
      enableEditorMode: vi.fn(),
      disableEditorMode: vi.fn(),
      isSidePanelOpen: false,
      setSidePanelOpen: vi.fn(),
    }),
  );
});

describe("EditorToolbar org selector", () => {
  it("is absent for a single-org admin", () => {
    setAuth({ orgs: [ACME] });
    renderWithProviders(<EditorToolbar />);
    expect(screen.queryByLabelText("Editor organization")).toBeNull();
  });

  it("lists every available org, flagging suspended ones", async () => {
    setAuth({ orgs: [ACME, BETA, GONE] });
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());

    expect(await screen.findByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Beta Productions" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Dormant Co (suspended)" })).toBeInTheDocument();
  });

  it("switches the app to the chosen org and drops the impersonated user", async () => {
    const { switchOrg, setViewAsUser } = setAuth({
      viewAsUser: { id: "u1", email: "someone@acme.test", roles: ["producer"] },
    });
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Beta Productions" }));

    expect(switchOrg).toHaveBeenCalledWith(BETA.id);
    // The impersonated user belongs to the previous org and would not even appear in
    // the new org's dropdown, so it must not survive the switch.
    expect(setViewAsUser).toHaveBeenCalledWith(null);
  });

  it("does nothing when the already-active org is re-selected", async () => {
    const { switchOrg, setViewAsUser } = setAuth();
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));

    expect(switchOrg).not.toHaveBeenCalled();
    expect(setViewAsUser).not.toHaveBeenCalled();
  });
});

describe("EditorToolbar access", () => {
  it("renders for a super-admin holding no role in the active org", () => {
    setAuth({ roles: [], isSuperAdmin: true });
    renderWithProviders(<EditorToolbar />);
    expect(screen.getByText("Editor Mode")).toBeInTheDocument();
  });

  it("renders nothing for a producer", () => {
    setAuth({ roles: ["producer"] });
    const { container } = renderWithProviders(<EditorToolbar />);
    expect(container.firstChild).toBeNull();
  });
});
