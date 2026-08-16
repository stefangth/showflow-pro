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
import { EditorToolbar, EditorPageBadge, EditorModeToggle } from "./EditorToolbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MemoryRouter } from "react-router-dom";
import { ROUTES } from "@/config/app.config";

const ACME = { id: "o1", name: "Acme", slug: "acme", status: "active", is_demo: false };
const BETA = { id: "o2", name: "Beta Productions", slug: "beta", status: "active", is_demo: false };
const GONE = { id: "o3", name: "Dormant Co", slug: "dormant", status: "suspended", is_demo: false };

function setAuth(over: Partial<ReturnType<typeof useAuth>> = {}) {
  const switchOrg = vi.fn();
  const setViewAsUser = vi.fn();
  const setViewAsRole = vi.fn();
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({
      roles: ["admin"],
      isSuperAdmin: false,
      orgs: [ACME, BETA],
      currentOrg: ACME,
      switchOrg,
      viewAsRole: null,
      setViewAsRole,
      viewAsUser: null,
      setViewAsUser,
      ...over,
    }),
  );
  return { switchOrg, setViewAsUser, setViewAsRole };
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
      isToolbarHidden: false,
      hideToolbar: vi.fn(),
      showToolbar: vi.fn(),
      isSidePanelOpen: false,
      setSidePanelOpen: vi.fn(),
    }),
  );
});

/** Override the editor-context mock for a single test, keeping the beforeEach defaults. */
function setEditor(over: Partial<ReturnType<typeof useEditor>> = {}) {
  vi.mocked(useEditor).mockReturnValue(
    partialMock<ReturnType<typeof useEditor>>({
      isEditorMode: true,
      enableEditorMode: vi.fn(),
      disableEditorMode: vi.fn(),
      isToolbarHidden: false,
      hideToolbar: vi.fn(),
      showToolbar: vi.fn(),
      isSidePanelOpen: false,
      setSidePanelOpen: vi.fn(),
      ...over,
    }),
  );
}

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

  it("names the empty state rather than showing a blank trigger when there is no active org", () => {
    // Not reachable today (currentOrg falls back to orgs[0]), but the value prop has to
    // stay a string to keep the Select controlled, so the empty case should still read.
    setAuth({ currentOrg: null });
    renderWithProviders(<EditorToolbar />);

    expect(orgSelect()).toHaveTextContent("Select organization");
  });

  it("will not let an ordinary admin switch into a suspended org", async () => {
    // ProtectedRoute swaps the whole layout for SuspendedOrgScreen, taking this very
    // toolbar with it, so entering one is a one-way trip for a non-super-admin.
    const { switchOrg } = setAuth({ orgs: [ACME, GONE] });
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Dormant Co (suspended)" }));

    expect(switchOrg).not.toHaveBeenCalled();
  });

  it("lets a super-admin into a suspended org, since they bypass the suspended screen", async () => {
    const { switchOrg } = setAuth({ orgs: [ACME, GONE], roles: [], isSuperAdmin: true });
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Dormant Co (suspended)" }));

    expect(switchOrg).toHaveBeenCalledWith(GONE.id);
  });

  it("switches the app to the chosen org", async () => {
    // Dropping the impersonated user is switchOrg's job, not the toolbar's — see
    // AuthContext.switchOrg.test.tsx.
    const { switchOrg } = setAuth({
      viewAsUser: { id: "u1", email: "someone@acme.test", roles: ["producer"] },
    });
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Beta Productions" }));

    expect(switchOrg).toHaveBeenCalledWith(BETA.id);
  });

  it("does nothing when the already-active org is re-selected", async () => {
    const { switchOrg } = setAuth();
    renderWithProviders(<EditorToolbar />);

    fireEvent.click(orgSelect());
    fireEvent.click(await screen.findByRole("option", { name: "Acme" }));

    expect(switchOrg).not.toHaveBeenCalled();
  });
});

describe("EditorPageBadge", () => {
  function renderBadge(path: string) {
    return renderWithProviders(
      <MemoryRouter initialEntries={[path]}>
        <EditorPageBadge />
      </MemoryRouter>,
    );
  }

  it("names the source file for the current route", () => {
    setAuth();
    renderBadge(ROUTES.BOOKINGS);
    expect(screen.getByText("ShowsBookingsPage.tsx")).toBeInTheDocument();
  });

  it("falls back for a route with no mapping", () => {
    setAuth();
    renderBadge("/nowhere");
    expect(screen.getByText("Unknown page")).toBeInTheDocument();
  });

  it("renders nothing outside editor mode", () => {
    setAuth();
    vi.mocked(useEditor).mockReturnValue(
      partialMock<ReturnType<typeof useEditor>>({ isEditorMode: false }),
    );
    const { container } = renderBadge(ROUTES.BOOKINGS);
    expect(container.querySelector("[class*='font-mono']")).toBeNull();
  });

  it("renders nothing for a producer, without AppLayout having to gate it", () => {
    setAuth({ roles: ["producer"] });
    const { container } = renderBadge(ROUTES.BOOKINGS);
    expect(container.querySelector("[class*='font-mono']")).toBeNull();
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

  // Plan B Task 4: the topbar EditorModeToggle is the single entry point into
  // editor mode. The toolbar used to also render its own off-state Pencil
  // button (a second, redundant way to call enableEditorMode); it must now
  // render nothing at all until editor mode is actually on, even for a user
  // who is otherwise allowed to use the editor.
  it("renders nothing when editor mode is off, even for an admin who can use the editor", () => {
    setAuth({ roles: ["admin"] });
    vi.mocked(useEditor).mockReturnValue(
      partialMock<ReturnType<typeof useEditor>>({
        isEditorMode: false,
        enableEditorMode: vi.fn(),
        disableEditorMode: vi.fn(),
        isSidePanelOpen: false,
        setSidePanelOpen: vi.fn(),
      }),
    );
    const { container } = renderWithProviders(<EditorToolbar />);
    expect(container.firstChild).toBeNull();
  });

  it("still renders the full toolbar when editor mode is on", () => {
    setAuth({ roles: ["admin"] });
    renderWithProviders(<EditorToolbar />);
    expect(screen.getByText("Editor Mode")).toBeInTheDocument();
  });
});

describe("EditorToolbar exit vs. hide", () => {
  it("hides the bar (staying in editor mode) via the Hide button, without resetting view-as", () => {
    const { setViewAsUser, setViewAsRole } = setAuth({ viewAsRole: "producer" });
    const hideToolbar = vi.fn();
    const disableEditorMode = vi.fn();
    setEditor({ hideToolbar, disableEditorMode });

    renderWithProviders(<EditorToolbar />);
    fireEvent.click(screen.getByLabelText("Hide editor bar"));

    expect(hideToolbar).toHaveBeenCalledTimes(1);
    expect(disableEditorMode).not.toHaveBeenCalled();
    expect(setViewAsRole).not.toHaveBeenCalled();
    expect(setViewAsUser).not.toHaveBeenCalled();
  });

  it("Exit resets view-as to your real role AND exits editor mode", () => {
    const { setViewAsUser, setViewAsRole } = setAuth({
      viewAsRole: null,
      viewAsUser: { id: "u1", email: "someone@acme.test", roles: ["producer"] },
    });
    const disableEditorMode = vi.fn();
    const hideToolbar = vi.fn();
    setEditor({ disableEditorMode, hideToolbar });

    renderWithProviders(<EditorToolbar />);
    fireEvent.click(screen.getByLabelText("Exit editor mode"));

    expect(setViewAsRole).toHaveBeenCalledWith(null);
    expect(setViewAsUser).toHaveBeenCalledWith(null);
    expect(disableEditorMode).toHaveBeenCalledTimes(1);
    expect(hideToolbar).not.toHaveBeenCalled();
  });

  it("renders nothing when the bar is hidden but editor mode is still on", () => {
    setAuth();
    setEditor({ isEditorMode: true, isToolbarHidden: true });
    const { container } = renderWithProviders(<EditorToolbar />);
    expect(container.firstChild).toBeNull();
  });
});

describe("EditorModeToggle preview indicator", () => {
  function renderToggle() {
    return renderWithProviders(
      <TooltipProvider>
        <EditorModeToggle />
      </TooltipProvider>,
    );
  }

  it("shades the pencil red when previewing a role other than the login role", () => {
    setAuth({ roles: ["admin"], viewAsRole: "producer" });
    const { container } = renderToggle();
    expect(container.querySelector("svg")).toHaveClass("text-destructive");
  });

  it("shades the pencil red when previewing as a specific user", () => {
    setAuth({
      roles: ["admin"],
      viewAsRole: null,
      viewAsUser: { id: "u1", email: "someone@acme.test", roles: ["producer"] },
    });
    const { container } = renderToggle();
    expect(container.querySelector("svg")).toHaveClass("text-destructive");
  });

  it("leaves the pencil unshaded when viewing as your own role (My Role)", () => {
    setAuth({ roles: ["admin"], viewAsRole: null });
    const { container } = renderToggle();
    expect(container.querySelector("svg")).not.toHaveClass("text-destructive");
  });

  it("leaves the pencil unshaded when the chosen role equals the login role", () => {
    setAuth({ roles: ["admin"], viewAsRole: "admin" });
    const { container } = renderToggle();
    expect(container.querySelector("svg")).not.toHaveClass("text-destructive");
  });
});

describe("EditorModeToggle actions", () => {
  function renderToggle() {
    return renderWithProviders(
      <TooltipProvider>
        <EditorModeToggle />
      </TooltipProvider>,
    );
  }

  it("enters editor mode when it is off", () => {
    setAuth();
    const enableEditorMode = vi.fn();
    const hideToolbar = vi.fn();
    const showToolbar = vi.fn();
    setEditor({ isEditorMode: false, enableEditorMode, hideToolbar, showToolbar });

    renderToggle();
    fireEvent.click(screen.getByRole("button"));

    expect(enableEditorMode).toHaveBeenCalledTimes(1);
    expect(hideToolbar).not.toHaveBeenCalled();
    expect(showToolbar).not.toHaveBeenCalled();
  });

  it("hides the bar when editor mode is on and the bar is showing", () => {
    setAuth();
    const hideToolbar = vi.fn();
    const showToolbar = vi.fn();
    setEditor({ isEditorMode: true, isToolbarHidden: false, hideToolbar, showToolbar });

    renderToggle();
    fireEvent.click(screen.getByRole("button"));

    expect(hideToolbar).toHaveBeenCalledTimes(1);
    expect(showToolbar).not.toHaveBeenCalled();
  });

  it("shows the bar again when it is hidden (never exiting)", () => {
    setAuth();
    const showToolbar = vi.fn();
    const disableEditorMode = vi.fn();
    setEditor({ isEditorMode: true, isToolbarHidden: true, showToolbar, disableEditorMode });

    renderToggle();
    fireEvent.click(screen.getByRole("button"));

    expect(showToolbar).toHaveBeenCalledTimes(1);
    expect(disableEditorMode).not.toHaveBeenCalled();
  });
});
