import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { partialMock } from "@/test/castHelpers";
import type { User } from "@supabase/supabase-js";
import i18n from "@/i18n";

// AppLayout composes a large shell (nav, org switcher, editor toolbar, theme toggle,
// profile menu) around the one behavior this test exists to pin: the notifications
// bell Popover must close when NotificationsList reports a navigation, or a stale
// popover is left open over the destination page. Every subsystem that behavior
// doesn't touch is stubbed, following the same "AppLayout is heavy" precedent
// ProtectedRoute.test.tsx already established (it stubs AppLayout wholesale rather
// than mount it for an unrelated assertion) — here AppLayout itself is under test,
// so its OWN heavy siblings are what get stubbed instead.

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/features/auth/AuthContext";

vi.mock("@/features/editor/EditorContext", () => ({
  useEditorConfig: () => ({ isEditorMode: false, pageAccess: {} }),
}));

vi.mock("@/hooks/useSettingsWarnings", () => ({
  useSettingsWarnings: () => ({ hasAnyWarning: false }),
}));
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ data: [] }),
}));
vi.mock("@/hooks/useNavCounts", () => ({
  useNavCounts: () => ({ pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 }),
}));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ features: new Set<string>(), isLoading: false }),
}));

// Heavy sibling subtrees this behavior doesn't touch, each already covered by its own
// test suite (OrgSwitcher.test.tsx, EditorToolbar.test.tsx): stubbed to no-ops so this
// test exercises only the notification-bell wiring, not their internals.
vi.mock("@/components/layout/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/features/editor/EditorToolbar", () => ({
  EditorToolbar: () => null,
  EditorModeToggle: () => null,
  EditorPageBadge: () => null,
}));
vi.mock("@/components/layout/ThemeToggle", () => ({ ThemeToggle: () => null }));

// The prop under test. A trivial stub in place of the real NotificationsList (its own
// deep-link/read/onNavigate contract is covered by NotificationsList.test.tsx) exposes
// exactly the callback AppLayout wires to it.
vi.mock("@/components/layout/NotificationsList", () => ({
  NotificationsList: ({ onNavigate }: { onNavigate?: () => void }) => (
    <button onClick={() => onNavigate?.()}>notification stub</button>
  ),
}));

interface NavLinkStubProps {
  to: string;
  className?: string | ((opts: { isActive: boolean }) => string);
  onClick?: () => void;
  children: ReactNode;
}
interface LinkStubProps {
  to: string;
  className?: string;
  children: ReactNode;
}
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/dashboard" }),
  NavLink: ({ to, className, children }: NavLinkStubProps) => (
    <a href={to} className={typeof className === "function" ? className({ isActive: false }) : className}>
      {children}
    </a>
  ),
  Link: ({ to, className, children }: LinkStubProps) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

import AppLayout from "./AppLayout";

function mockAuth() {
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "u1", email: "admin@example.com" }),
      roles: ["admin"],
      hasRole: () => true,
      viewAsRole: null,
      viewAsUser: null,
      isSuperAdmin: false,
      currentOrg: { id: "o1", name: "Acme Shows", slug: "acme", status: "active" },
      orgs: [],
      switchOrg: vi.fn(),
      signOut: vi.fn(),
    }),
  );
}

describe("AppLayout notification bell", () => {
  it("closes the notifications popover when NotificationsList reports a navigation", () => {
    mockAuth();
    renderWithProviders(<AppLayout>page content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("notification stub")).toBeInTheDocument();

    fireEvent.click(screen.getByText("notification stub"));

    expect(screen.queryByText("notification stub")).not.toBeInTheDocument();
  });
});

describe("AppLayout account menu language", () => {
  it("switches the app language when Deutsch is picked", async () => {
    mockAuth();
    await i18n.changeLanguage("en");
    renderWithProviders(<AppLayout>page content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByText("German"));

    expect(i18n.language).toBe("de");
    await i18n.changeLanguage("en");
  });
});
