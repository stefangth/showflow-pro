import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { partialMock } from "@/test/castHelpers";
import type { User } from "@supabase/supabase-js";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";
import type { FeatureKey } from "@/lib/entitlements";

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
  useEntitlements: vi.fn(() => ({ features: new Set<FeatureKey>(), isLoading: false })),
  useFeature: vi.fn(() => false),
}));
import { useEntitlements, useFeature } from "@/hooks/useEntitlements";

/** Seed the language_packages gate (and keep the base useEntitlements() shape stable
 *  for the rest of the shell, e.g. nav-item gating) for a single test. */
function mockEntitlements(languagePacksEnabled: boolean) {
  vi.mocked(useEntitlements).mockReturnValue({ features: new Set<FeatureKey>(), isLoading: false });
  vi.mocked(useFeature).mockReturnValue(languagePacksEnabled);
}

// File-scope default so a test inserted between/after the describe blocks below can't
// silently inherit whatever mockReturnValue the previous describe block's beforeEach (or
// a stray test) last set on these shared vi.fn() mocks — every test starts from the same
// "gate off" baseline unless it opts in via mockEntitlements(true).
beforeEach(() => {
  vi.mocked(useFeature).mockReturnValue(false);
  vi.mocked(useEntitlements).mockReturnValue({ features: new Set<FeatureKey>(), isLoading: false });
});

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
  beforeEach(() => mockEntitlements(true));

  it("switches the app language when Deutsch is picked", async () => {
    mockAuth();
    await i18n.changeLanguage("en");
    renderWithProviders(<AppLayout>page content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByText("Deutsch"));

    expect(i18n.language).toBe("de");
    await i18n.changeLanguage("en");
  });
});

describe("AppLayout language picker gating (language_packages entitlement)", () => {
  it("hides the language picker when language_packages is off", () => {
    mockAuth();
    mockEntitlements(false);
    renderWithProviders(<AppLayout>page content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.queryByText("Deutsch")).not.toBeInTheDocument();
  });

  it("shows the language picker when language_packages is on", async () => {
    mockAuth();
    mockEntitlements(true);
    renderWithProviders(<AppLayout>page content</AppLayout>);

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(await screen.findByText("Deutsch")).toBeInTheDocument();
  });
});

describe("AppLayout force-English gate (language_packages entitlement)", () => {
  // These tests drive the gate via a RErender (flipping the mocked useFeature() return
  // value and calling `rerender`) rather than mounting fresh with the target state already
  // in place. That's deliberate, not incidental: renderWithProviders also mounts a real
  // LanguageProvider, which runs its OWN mount effect syncing i18n to whatever language is
  // already in localStorage. In production that provider mounts (and settles) long before
  // ProtectedRoute ever reaches AppLayout, so there's no contest by the time this effect's
  // guard matters. But mounting both fresh in the same test commit races the two effects
  // against each other (their order is a React implementation detail, not a contract this
  // test should pin), which isn't the behavior under test here — the behavior under test
  // is "when languagePacksEnabled changes, this effect does X", independent of whichever
  // provider mounted first. A rerender only re-fires effects whose dependencies changed, so
  // toggling languagePacksEnabled exercises exactly this effect without also retriggering
  // LanguageProvider's mount-only effect.
  afterEach(async () => {
    // Don't leak the language state this describe block deliberately mutates into
    // sibling tests in this file (or other files sharing the singleton i18n instance).
    localStorage.removeItem(STORAGE_KEY);
    await i18n.changeLanguage("en");
  });

  it("forces the runtime to English when language_packages flips OFF, without clearing the stored preference", async () => {
    mockAuth();
    mockEntitlements(true);
    const { rerender } = renderWithProviders(<AppLayout>page content</AppLayout>);
    await waitFor(() => expect(i18n.language).toBe("en"));

    // Simulate an already-active German session (as if the user picked it earlier,
    // while the module was still entitled).
    localStorage.setItem(STORAGE_KEY, "de");
    await i18n.changeLanguage("de");

    // The org's language_packages entitlement is revoked mid-session.
    mockEntitlements(false);
    rerender(<AppLayout>page content</AppLayout>);

    // Display-only: the runtime language flips back to English...
    await waitFor(() => expect(i18n.language).toBe("en"));
    // ...but the user's stored preference is untouched, so a later re-enable restores
    // it rather than defaulting back to English.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("de");
  });

  it("restores the stored language when language_packages flips back ON", async () => {
    mockAuth();
    mockEntitlements(false);
    const { rerender } = renderWithProviders(<AppLayout>page content</AppLayout>);
    await waitFor(() => expect(i18n.language).toBe("en"));

    // A German preference is already stored (e.g. from a previous entitled session),
    // and the org's language_packages entitlement is granted mid-session.
    localStorage.setItem(STORAGE_KEY, "de");
    mockEntitlements(true);
    rerender(<AppLayout>page content</AppLayout>);

    await waitFor(() => expect(i18n.language).toBe("de"));
  });
});
