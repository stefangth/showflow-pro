import { afterAll, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import AcceptInvitePage, {
  NEXT_STEP_LINES,
  ADMIN_SETUP_COMPLETE_LINE,
  PRODUCER_OFFERS_CONFIRM_LINE,
  ARTIST_NOT_LINKED_NEXT_STEP_LINE,
  resolveBookingRunState,
  resolveNextStepLine,
} from "./AcceptInvitePage";
import { ROUTES, roleLabel, roleDescription } from "@/config/app.config";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";
import type { Membership, Organization } from "@/data/orgs";
import { createTestQueryClient } from "@/test/queryClient";
import { InvitationExchangeError } from "@/data/invitations";

const navigateSpy = vi.fn();
const locationAssignSpy = vi.fn();
const originalLocation = window.location;
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

const acceptInvitationMock = vi.fn();
const exchangeInvitationMock = vi.fn();
vi.mock("@/data/invitations", () => ({
  acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
  exchangeInvitation: (...args: unknown[]) => exchangeInvitationMock(...args),
  InvitationExchangeError: class InvitationExchangeError extends Error {
    constructor(public kind: "unavailable" | "throttled" | "unknown", public retryAfterSeconds?: number) { super(kind); }
  },
}));

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}));

const switchOrgSpy = vi.fn((orgId: string) => {
  // Mirrors AuthContext's real switchOrg-flips-currentOrgId-which-currentOrg-derives-from
  // behavior (see AuthContext.tsx), so a test that un-mocks useFeature/useEntitlements can
  // observe currentOrg update the moment switchOrg runs, exactly as it would for a real
  // consumer. Inert for every other test: nothing else here reads authState.currentOrg.
  authState.currentOrg = authState.orgs.find((o) => o.id === orgId) ?? null;
});
const refreshOrgsSpy = vi.fn().mockResolvedValue(undefined);
const signOutSpy = vi.fn().mockResolvedValue(undefined);
// AcceptInvitePage reads user/loading/orgs/memberships/switchOrg/refreshOrgs/signOut off
// useAuth(). orgs and memberships mirror AuthContext's real shapes (Organization has no
// `roles`; role membership lives on Membership rows, resolved via orgRoles.rolesForOrg).
let authState: {
  user: { id: string; email?: string } | null;
  loading: boolean;
  orgs: Organization[];
  memberships: Membership[];
  currentOrg: Organization | null;
  switchOrg: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
  signOut: () => Promise<void>;
};
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => authState,
}));

// The next-step line is booking-flow-aware (resolveBookingRunState): whether this org's
// booking module is on, paused, or running offers vs direct booking. Mirrors the mocking
// pattern in ArtistDashboard.flowCopy.test.tsx so the page's own useQuery plumbing (behind
// useBookingFlow / useFeature) never has to run in this file.
//
// flowLoadingHolder backs the regression for "the next-step line must not render a false
// claim on first paint": every existing test in this file defaults it to false (the query
// has already resolved), so none of the ~40 pre-existing cases change behavior; only the
// new loading-gate tests below flip it to true.
const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow | undefined };
const flowLoadingHolder = { loading: false };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow, isLoading: flowLoadingHolder.loading }),
}));

// hooksMode.real toggles ONE test (see "useFeature really reads useAuth().currentOrg"
// below) over to the REAL useFeature/useEntitlements implementation, backed by a mocked
// fetchEntitlements data-access call -- everywhere else it stays the simple featureHolder
// stub every other test in this file already relies on, so this toggle changes nothing for
// the other ~40 cases.
const hooksMode = { real: false };
const featureHolder = { bookingFlowOn: true };
// entitlementsLoadingHolder backs the regression for "the next-step line must not render
// off useFeature's fail-open default before the underlying entitlements query has actually
// settled" -- every existing test defaults it to false (already resolved), so none of the
// pre-existing cases change behavior; only the new loading-gate test below flips it.
const entitlementsLoadingHolder = { loading: false };
vi.mock("@/hooks/useEntitlements", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useEntitlements")>();
  return {
    ...real,
    useFeature: (f: "booking_flow" | "hire_orders") =>
      hooksMode.real ? real.useFeature(f) : f === "booking_flow" ? featureHolder.bookingFlowOn : true,
    useEntitlements: () =>
      hooksMode.real
        ? real.useEntitlements()
        : {
            features: new Set(featureHolder.bookingFlowOn ? ["booking_flow" as const] : []),
            isLoading: entitlementsLoadingHolder.loading,
          },
  };
});

// canConfirmHolder backs the producer confirm_bookings capability gate (see
// PRODUCER_OFFERS_CONFIRM_LINE): admins and artists never consume it, so every test that
// does not set it explicitly (default true) exercises the confirm-capable producer branch,
// matching useCan's own loading-fallback default for that capability.
const canConfirmHolder = { value: true };
vi.mock("@/hooks/useCapabilities", () => ({
  useCan: (action: string) => (action === "confirm_bookings" ? canConfirmHolder.value : true),
}));

const fetchEntitlementsMock = vi.fn();
vi.mock("@/data/entitlements", () => ({
  fetchEntitlements: (...args: unknown[]) => fetchEntitlementsMock(...args),
}));

// The next-step line's admin-only fourth state (resolveNextStepLine) reads whether the
// joined org's booking SETUP is already complete, separately from whether its booking
// flow is on/off/offers/direct. Its own holder + mock so the ~40 existing cases (which
// never set it) keep exercising the "setup still outstanding" branch unchanged.
//
// bookingSetupStatusMock is a spy, not a bare stub: the page must gate this hook's org-id
// argument on `bookingModuleOn && role === 'admin'`, since resolveNextStepLine never reads
// bookingSetupComplete for a producer/artist or for an admin at a module-off org. Recording
// the call args lets tests prove the five-query setup-status read is never fired for those
// cases, rather than only asserting on what got rendered. isLoading mirrors the real hook's
// own `!!orgId && ...` shape (false whenever the page passes null), so a test that sets
// bookingSetupLoadingHolder.loading = true only sees it reflected when the page actually
// asks for a real org id.
const bookingSetupHolder = { complete: false };
const bookingSetupLoadingHolder = { loading: false };
const bookingSetupStatusMock = vi.fn((orgId: string | null) => ({
  status: { complete: bookingSetupHolder.complete, steps: [], doneCount: 0, totalCount: 0, canOffer: false },
  coverage: undefined,
  artistCount: null,
  isLoading: !!orgId && bookingSetupLoadingHolder.loading,
  isError: false,
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: (orgId: string | null) => bookingSetupStatusMock(orgId),
}));

const passwordStatusHolder: { data: boolean | undefined; isLoading: boolean; isError: boolean } = {
  data: true,
  isLoading: false,
  isError: false,
};
const passwordStatusMock = vi.fn(() => passwordStatusHolder);
vi.mock("@/hooks/usePasswordStatus", () => ({
  usePasswordStatus: () => passwordStatusMock(),
}));

vi.mock("@/components/auth/PasswordSetupForm", () => ({
  PasswordSetupForm: ({ onSuccess, onCancel }: { onSuccess: () => void; onCancel?: () => void }) => (
    <section aria-labelledby="password-setup-heading">
      <h3 id="password-setup-heading" tabIndex={-1}>Set a password</h3>
      <p role="alert">Password requirements</p>
      <button onClick={onSuccess}>Complete password setup</button>
      <button onClick={onCancel}>Cancel</button>
    </section>
  ),
}));

const org1: Organization = { id: "org-1", name: "Riverside Opera", slug: "riverside", status: "active" };
const oldOrg: Organization = { id: "org-0", name: "Old Org", slug: "old-org", status: "active" };

function membershipFor(role: Membership["role"]): Membership {
  return { org_id: org1.id, role, organizations: org1 };
}

// A plain element factory (not just a render call) so the loading-gate test below can
// call RTL's `rerender` with the identical tree after mutating a holder, forcing the page's
// mocked hooks to be re-invoked with their new values without remounting (and re-running)
// the accept-invitation effect.
const acceptInviteTree = (url: string) => (
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path={ROUTES.ACCEPT_INVITE} element={<AcceptInvitePage />} /></Routes>
  </MemoryRouter>
);

const renderAt = (url: string) => render(acceptInviteTree(url));

// Only the "useFeature really reads useAuth().currentOrg" test needs a real QueryClient
// (hooksMode.real routes useFeature through the real useEntitlements(), which calls
// useQuery). Every other test keeps the fully-mocked hooks and never touches react-query.
const renderAtWithQueryClient = (url: string) =>
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path={ROUTES.ACCEPT_INVITE} element={<AcceptInvitePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: locationAssignSpy },
  });
  locationAssignSpy.mockClear();
  navigateSpy.mockClear();
  acceptInvitationMock.mockReset();
  exchangeInvitationMock.mockReset();
  sessionStorage.clear();
  toastSuccess.mockClear();
  toastWarning.mockClear();
  switchOrgSpy.mockClear();
  refreshOrgsSpy.mockClear();
  signOutSpy.mockClear();
  fetchEntitlementsMock.mockReset();
  flowHolder.flow = BOOKING_FLOW_DEFAULTS;
  flowLoadingHolder.loading = false;
  featureHolder.bookingFlowOn = true;
  entitlementsLoadingHolder.loading = false;
  canConfirmHolder.value = true;
  bookingSetupHolder.complete = false;
  bookingSetupLoadingHolder.loading = false;
  bookingSetupStatusMock.mockClear();
  passwordStatusHolder.data = true;
  passwordStatusHolder.isLoading = false;
  passwordStatusHolder.isError = false;
  passwordStatusMock.mockClear();
  hooksMode.real = false;
  authState = {
    user: { id: "u1", email: "singer@example.com" },
    loading: false,
    orgs: [org1],
    memberships: [membershipFor("admin")],
    currentOrg: org1,
    switchOrg: switchOrgSpy,
    refreshOrgs: refreshOrgsSpy,
    signOut: signOutSpy,
  };
});

afterAll(() => Object.defineProperty(window, "location", { configurable: true, value: originalLocation }));

describe("AcceptInvitePage error paths (unchanged)", () => {
  it("shows an error when the link is missing its token", async () => {
    renderAt(`${ROUTES.ACCEPT_INVITE}`);
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it("shows invitation context without exchanging until Continue is clicked", async () => {
    authState.user = null;
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(screen.getByRole("heading", { name: /you've been invited/i })).toBeInTheDocument();
    expect(exchangeInvitationMock).not.toHaveBeenCalled();
  });

  it("exchanges exactly once on Continue and assigns the returned Auth URL", async () => {
    authState.user = null;
    let resolveExchange!: (value: { actionUrl: string }) => void;
    exchangeInvitationMock.mockReturnValue(new Promise((resolve) => { resolveExchange = resolve; }));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    const button = screen.getByRole("button", { name: /continue/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(exchangeInvitationMock).toHaveBeenCalledTimes(1);
    expect(exchangeInvitationMock).toHaveBeenCalledWith(expect.anything(), { token: "abc123", appOrigin: window.location.origin });
    resolveExchange({ actionUrl: "https://auth.example/verify" });
    await waitFor(() => expect(locationAssignSpy).toHaveBeenCalledWith("https://auth.example/verify"));
  });

  it("keeps retry available after throttling", async () => {
    authState.user = null;
    exchangeInvitationMock.mockRejectedValueOnce(new InvitationExchangeError("throttled", 30));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/wait.*try again/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
    expect(sessionStorage.getItem("showflow.pendingInvitationToken")).toBe("abc123");
  });

  it("clears the stored token and shows permanent unavailable state for 410", async () => {
    authState.user = null;
    exchangeInvitationMock.mockRejectedValueOnce(new InvitationExchangeError("unavailable"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("showflow.pendingInvitationToken")).toBeNull();
  });

  it("offers a generic retry for unknown exchange failures", async () => {
    authState.user = null;
    exchangeInvitationMock.mockRejectedValueOnce(new Error("network"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/couldn't continue/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
  });

  it("shows a friendly message when acceptance fails", async () => {
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation expired"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("names the signed-in email on a different-email mismatch, so the reader knows which account to switch away from", async () => {
    // The accept_invitation RPC error never carries the invited address (see the SQL:
    // 'Invitation was issued to a different email'), so the signed-in email is the only
    // account identifier this page can truthfully surface. Two short sentences (who is
    // signed in, then what to do) rather than one clause gluing both together.
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation was issued to a different email"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByText(/you are signed in as singer@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/sent to a different address, so sign in with that one/i)).toBeInTheDocument();
  });

  it("falls back to a generic different-address message when no signed-in email is known", async () => {
    authState.user = { id: "u1", email: undefined };
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation was issued to a different email"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByText(/different email address/i)).toBeInTheDocument();
    // No account to sign out of is known, so there is nothing this page can switch away
    // from -- the button stays hidden rather than promising a remedy it cannot perform.
    expect(screen.queryByRole("button", { name: /sign out and use another address/i })).not.toBeInTheDocument();
  });

  it("offers a 'Sign out and use another address' button on the mismatch, and it actually gets there", async () => {
    // The message above names the fix ("sign in with that one"); this is the only control
    // on the card that can actually perform it -- everything else just goes to the
    // invitee's own (wrong-account) dashboard.
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation was issued to a different email"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    const button = await screen.findByRole("button", { name: /sign out and use another address/i });
    expect(signOutSpy).not.toHaveBeenCalled();
    fireEvent.click(button);

    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(1));
    // Bounces through /login with a return redirect back to this exact accept-invite URL,
    // the same construction the unauthenticated-visit path already uses, so signing in
    // with the invited address lands the invitee right back here to finish accepting.
    expect(navigateSpy).toHaveBeenCalledWith(
      `${ROUTES.LOGIN}?redirect=${encodeURIComponent(ROUTES.ACCEPT_INVITE)}`,
      { replace: true },
    );
  });

  it("makes the remedy the primary action on the wrong-email card, not equal weight with the passive escape", async () => {
    // Regression: both buttons used variant="outline", so the actual remedy (switch
    // accounts) carried the same visual weight as the no-op "Go to dashboard" escape.
    // Primary uses the default Button variant's bg-primary class; outline uses bg-background.
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation was issued to a different email"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    const remedyButton = await screen.findByRole("button", { name: /sign out and use another address/i });
    const escapeButton = screen.getByRole("button", { name: /go to dashboard/i });
    expect(remedyButton.className).toContain("bg-primary");
    expect(escapeButton.className).toContain("bg-background");
  });

  it.each([
    "Invitation expired",
    "Not authenticated",
    "Some unexpected failure",
  ] as const)("does not offer the switch-account button for a %s error", async (message) => {
    acceptInvitationMock.mockRejectedValueOnce(new Error(message));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    await screen.findByText(/could not accept|invalid or has expired|please sign in/i);
    expect(screen.queryByRole("button", { name: /sign out and use another address/i })).not.toBeInTheDocument();
  });

  it("navigates to the dashboard, replacing history, from an error card", async () => {
    // Consistency with the success screen's own "Go to dashboard" button, which also
    // replaces history so Back cannot re-mount this page and re-run acceptInvitation.
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation expired"));
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    const button = await screen.findByRole("button", { name: /go to dashboard/i });
    fireEvent.click(button);
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
  });
});

describe("AcceptInvitePage success screen", () => {
  describe("calm sign-in handoff", () => {
    it("queries password status only after membership acceptance succeeds", async () => {
      let resolveAcceptance!: (value: { orgId: string; artistLinked: boolean }) => void;
      acceptInvitationMock.mockReturnValue(new Promise((resolve) => { resolveAcceptance = resolve; }));
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      expect(passwordStatusMock).not.toHaveBeenCalled();
      resolveAcceptance({ orgId: org1.id, artistLinked: true });
      await screen.findByRole("heading", { name: /you've joined/i });
      expect(passwordStatusMock).toHaveBeenCalled();
    });

    it("offers passwordless users two equal, unselected sign-in choices", async () => {
      passwordStatusHolder.data = false;
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      const create = await screen.findByRole("button", { name: /create a password/i });
      const magic = screen.getByRole("button", { name: /continue with magic links/i });
      expect(create.className).toBe(magic.className);
      expect(create).toHaveAttribute("aria-pressed", "false");
      expect(magic).toHaveAttribute("aria-pressed", "false");
      expect(create.className).toContain("min-h-11");
      expect(create.className).toContain("focus-visible:ring-2");
      expect(create.className).toContain("motion-reduce:transition-none");
      expect(screen.queryByRole("button", { name: /go to dashboard/i })).not.toBeInTheDocument();
    });

    it("opens password setup inline, retains invite context, and moves focus to its heading", async () => {
      passwordStatusHolder.data = false;
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      fireEvent.click(await screen.findByRole("button", { name: /create a password/i }));
      const heading = screen.getByRole("heading", { name: /set a password/i });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(screen.getByRole("heading", { name: /you've joined riverside opera/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/invitation accepted/i)).toBeInTheDocument();
      expect(screen.getByText(/your role: admin/i)).toBeInTheDocument();
      expect(screen.getByText(/password requirements/i).closest('[aria-live="polite"]')).toBeInTheDocument();
    });

    it("keeps the stored token when membership acceptance fails", async () => {
      acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation expired"));
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      await screen.findByText(/invalid or has expired/i);
      expect(sessionStorage.getItem("showflow.pendingInvitationToken")).toBe("abc123");
    });

    it("keeps the current dashboard action for users who already have a password", async () => {
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      expect(await screen.findByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
      expect(screen.queryByText(/sign in next time/i)).not.toBeInTheDocument();
    });

    it("continues with magic links directly to the dashboard", async () => {
      passwordStatusHolder.data = false;
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      fireEvent.click(await screen.findByRole("button", { name: /continue with magic links/i }));
      expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
    });

    it("confirms successful password setup before offering the dashboard", async () => {
      passwordStatusHolder.data = false;
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      fireEvent.click(await screen.findByRole("button", { name: /create a password/i }));
      fireEvent.click(screen.getByRole("button", { name: /complete password setup/i }));
      expect(screen.getByRole("status")).toHaveTextContent(/password is ready/i);
      fireEvent.click(screen.getByRole("button", { name: /go to dashboard/i }));
      expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
    });

    it("treats password-status failure as non-blocking without guessing", async () => {
      passwordStatusHolder.data = undefined;
      passwordStatusHolder.isError = true;
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      expect(await screen.findByText("Your invitation was accepted. You can manage sign-in methods from your profile.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /create a password/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /go to dashboard/i })).toBeInTheDocument();
    });

    it("keeps mobile DOM order as context then choices and never adds a third bypass action", async () => {
      passwordStatusHolder.data = false;
      let resolveAcceptance!: (value: { orgId: string; artistLinked: boolean }) => void;
      acceptInvitationMock.mockReturnValue(new Promise((resolve) => { resolveAcceptance = resolve; }));
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      expect(screen.queryByText(/sign in next time/i)).not.toBeInTheDocument();
      resolveAcceptance({ orgId: org1.id, artistLinked: true });
      const context = await screen.findByText(/your role: admin/i);
      const choices = screen.getByTestId("sign-in-choices");
      expect(context.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByRole("button", { name: /go to dashboard/i })).not.toBeInTheDocument();
    });
  });
  it("clears the pending token after signed-in acceptance succeeds", async () => {
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    await screen.findByRole("heading", { name: /you've joined/i });
    expect(sessionStorage.getItem("showflow.pendingInvitationToken")).toBeNull();
  });

  it("renders an informative card instead of auto-navigating", async () => {
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    expect(await screen.findByRole("heading", { name: /you've joined riverside opera/i })).toBeInTheDocument();
    expect(switchOrgSpy).toHaveBeenCalledWith(org1.id);
    // No auto-navigate to the dashboard on success.
    expect(navigateSpy).not.toHaveBeenCalled();
    // The card replaces the success toast.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("names the signed-in email, so the reader can confirm this is the account that joined", async () => {
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(screen.getByText(/singer@example\.com/)).toBeInTheDocument();
  });

  it("refreshes org memberships before switching the active org", async () => {
    // AuthContext state (orgs/memberships) can predate the membership accept_invitation
    // just created. Without a refetch the card would degrade to a heading and a button
    // and the org switch would silently no-op (currentOrg falls back to orgs[0]).
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(refreshOrgsSpy).toHaveBeenCalledTimes(1);
    expect(switchOrgSpy).toHaveBeenCalledWith(org1.id);
    const refreshOrder = refreshOrgsSpy.mock.invocationCallOrder[0];
    const switchOrder = switchOrgSpy.mock.invocationCallOrder[0];
    expect(refreshOrder).toBeLessThan(switchOrder);
  });

  it("shows the role label and description resolved from memberships", async () => {
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(await screen.findByText(/your role: admin/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(roleLabel("admin")))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(roleDescription("admin")))).toBeInTheDocument();
  });

  it("resolves the role by a deterministic admin over producer over artist precedence, not membership row order", async () => {
    // An org member can hold more than one role at once (Admin > People "Roles" editor),
    // and fetchMyMemberships returns rows unordered, so index 0 is not safe. Put the
    // weaker role first in the array to prove precedence, not array order, decides.
    authState.memberships = [membershipFor("artist"), membershipFor("admin")];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    expect(await screen.findByText(/your role: admin/i)).toBeInTheDocument();

    switchOrgSpy.mockClear();
    authState.memberships = [membershipFor("artist"), membershipFor("producer")];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc456`);
    expect(await screen.findByText(/your role: production team/i)).toBeInTheDocument();
  });

  it("does not glue a 'you joined as' sentence onto the role description", async () => {
    // Regression: the role label used to be spliced into a second-person sentence
    // ("You joined as Artist. Gets booked for shows...") immediately followed by
    // ROLE_DESCRIPTIONS' third-person, subjectless clause. The role is now its own
    // label ("Your role: Artist") with the description as a separate caption below it.
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    const card = screen.getByTestId("accept-invite-success");
    expect(card.textContent ?? "").not.toMatch(/you joined as/i);
  });

  describe("next-step line is booking-flow-aware, not a tautology of the button beneath it", () => {
    // Three real org configurations for the joined org's booking flow: an offer
    // pipeline, direct booking (artist_acceptance off), and no pipeline at all
    // (module entitlement off, or the org's flow preset is paused). Each role's line
    // must name what that configuration actually does, matching the branch style
    // firstRun.ts's welcomeCopy uses for the same distinction on the dashboard rail.
    it.each([
      ["admin", /gets your first offers out/i],
      ["producer", /confirming bookings is yours to do/i],
      ["artist", /offers arrive by email/i],
    ] as const)("%s: names the offer pipeline when the org runs one", async (role, expected) => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS; // active: true, artist_acceptance: true
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor(role)];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it.each([
      ["admin", /gets your first date booked/i],
      ["producer", /bookings waiting on your confirmation/i],
      ["artist", /your producer books you directly/i],
    ] as const)("%s: names direct booking when the org skips offers", async (role, expected) => {
      flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct"); // artist_acceptance: false
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor(role)];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it.each([
      ["admin", /workspace needs from you next/i],
      ["producer", /shows what is waiting on you/i],
      ["artist", /what is next for you/i],
    ] as const)("%s: falls back to a generic line when the booking module is off", async (role, expected) => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = false;
      authState.memberships = [membershipFor(role)];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("falls back to the generic line when the org's flow preset is paused (off)", async () => {
      flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "off"); // active: false
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(/workspace needs from you next/i)).toBeInTheDocument();
    });

    it("falls back to the generic line while the flow has not loaded yet, never guessing", async () => {
      flowHolder.flow = undefined;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(/what is next for you/i)).toBeInTheDocument();
    });
  });

  describe("next-step line waits for its data instead of rendering a claim that then swaps", () => {
    // Regression: bookingFlow and bookingSetupStatus only start fetching on the render
    // where `joined` is set, so react-query returns `data: undefined` / an outstanding
    // status for both on the very first paint. The page must not render NEXT_STEP_LINES
    // (or ADMIN_SETUP_COMPLETE_LINE) off that transient, wrong state and then silently
    // swap once the real data lands -- it must hold the line until both queries settle.
    it("renders neither the offers promise, the already-set-up line, nor any other next-step claim while the flow query is still loading", async () => {
      flowLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      // The card itself (role block, button) is up -- only the next-step line is held back.
      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(await screen.findByText(/your role: admin/i)).toBeInTheDocument();
      expect(screen.queryByText(/gets your first offers out/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/gets your first date booked/i)).not.toBeInTheDocument();
      expect(screen.queryByText(ADMIN_SETUP_COMPLETE_LINE)).not.toBeInTheDocument();
      expect(screen.queryByText(/workspace needs from you next/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("next-step-line-loading")).toBeInTheDocument();
    });

    it("renders neither the offers promise, the already-set-up line, nor any other next-step claim while the entitlements query is still loading", async () => {
      // Regression: bookingModuleOn (useFeature('booking_flow')) fails open to the
      // registry default while entitlements load, so this must not be treated as a
      // resolved answer -- the line must wait for the entitlements query itself to settle,
      // exactly like it already waits for the flow and setup-status queries.
      entitlementsLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(await screen.findByText(/your role: admin/i)).toBeInTheDocument();
      expect(screen.queryByText(/gets your first offers out/i)).not.toBeInTheDocument();
      expect(screen.queryByText(ADMIN_SETUP_COMPLETE_LINE)).not.toBeInTheDocument();
      expect(screen.queryByText(/workspace needs from you next/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("next-step-line-loading")).toBeInTheDocument();
    });

    it("does not fetch the admin setup-status query while entitlements are still loading, even though useFeature's fail-open default would otherwise pass", async () => {
      entitlementsLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true; // the fail-open default value; must not be trusted yet
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(bookingSetupStatusMock).not.toHaveBeenCalledWith(org1.id);
    });

    it("renders neither the setup-list promise nor the already-set-up line while the setup-status query is still loading for an admin at a module-on org", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      flowLoadingHolder.loading = false;
      bookingSetupLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(screen.queryByText(/gets your first offers out/i)).not.toBeInTheDocument();
      expect(screen.queryByText(ADMIN_SETUP_COMPLETE_LINE)).not.toBeInTheDocument();
      expect(screen.getByTestId("next-step-line-loading")).toBeInTheDocument();
    });

    it("swaps the placeholder for the real line, and only the real line, once both queries resolve", async () => {
      flowLoadingHolder.loading = true;
      bookingSetupLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      const { rerender } = renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(screen.getByTestId("next-step-line-loading")).toBeInTheDocument();

      // Both queries land: the flow is an offer pipeline, and setup is already complete.
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      flowLoadingHolder.loading = false;
      bookingSetupHolder.complete = true;
      bookingSetupLoadingHolder.loading = false;
      rerender(acceptInviteTree(`${ROUTES.ACCEPT_INVITE}?token=abc123`));

      expect(screen.queryByTestId("next-step-line-loading")).not.toBeInTheDocument();
      expect(await screen.findByText(ADMIN_SETUP_COMPLETE_LINE)).toBeInTheDocument();
      expect(screen.queryByText(/gets your first offers out/i)).not.toBeInTheDocument();
    });

    it("a producer or artist is never held back by the admin-only setup-status query: it is not even fetched for them", async () => {
      // Sanity companion to the "never fetches" describe below -- proves the READY state
      // (not just the fetch gating) for non-admin roles: since the setup-status hook is
      // never asked for their org id, its isLoading is always false for them regardless of
      // bookingSetupLoadingHolder, so only the flow query can hold their line back.
      flowLoadingHolder.loading = false;
      bookingSetupLoadingHolder.loading = true;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("producer")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(screen.queryByTestId("next-step-line-loading")).not.toBeInTheDocument();
      expect(screen.getByText(PRODUCER_OFFERS_CONFIRM_LINE)).toBeInTheDocument();
    });
  });

  describe("the five-query booking setup status read is admin-only, never fetched for roles or orgs whose line does not consume it", () => {
    // Regression: the page used to gate useBookingSetupStatus's org id on ONLY
    // `bookingModuleOn`, so a brand-new artist's or producer's success screen fired all
    // five org-wide catalog reads behind it (app_settings, shows, show_dates,
    // show_cast_eligibility, cast_city_priority, artists) purely to render a sentence that
    // discards bookingSetupComplete entirely (resolveNextStepLine only branches on it for
    // role === 'admin'). Gating must also check the resolved role.
    it.each(["producer", "artist"] as const)(
      "%s: the setup-status hook is called only with a null org id, never the real one",
      async (role) => {
        featureHolder.bookingFlowOn = true;
        authState.memberships = [membershipFor(role)];
        acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
        renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

        await screen.findByRole("heading", { name: /you've joined riverside opera/i });
        expect(bookingSetupStatusMock).not.toHaveBeenCalledWith(org1.id);
        for (const call of bookingSetupStatusMock.mock.calls) {
          expect(call[0]).toBeNull();
        }
      },
    );

    it("admin at a module-off org: the setup-status hook is called only with a null org id, never the real one", async () => {
      featureHolder.bookingFlowOn = false;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(bookingSetupStatusMock).not.toHaveBeenCalledWith(org1.id);
    });

    it("admin at a module-on org: the setup-status hook IS called with the joined org's real id", async () => {
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      await waitFor(() => expect(bookingSetupStatusMock).toHaveBeenCalledWith(org1.id));
    });
  });

  describe("admin next-step line does not promise a setup list an already-configured org does not have", () => {
    // A second-or-later admin invited into a LIVE org (Admin > People, any time after the
    // org's first month) is the common case, not an edge case: its booking setup already
    // ran to completion, so "Your dashboard has a short setup list" would be false the
    // moment the invitee clicked through. bookingSetupHolder.complete (mocked
    // useBookingSetupStatus) carries the same signal the dashboard itself retires its
    // rail on (firstRun.ts's welcomeCopy, `complete` branch).
    it.each(["offers", "direct"] as const)(
      "admin, %s flow, setup already complete: shows the already-set-up line, not the setup-list promise",
      async (preset) => {
        flowHolder.flow = preset === "offers" ? BOOKING_FLOW_DEFAULTS : applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
        featureHolder.bookingFlowOn = true;
        bookingSetupHolder.complete = true;
        authState.memberships = [membershipFor("admin")];
        acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
        renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

        expect(await screen.findByText(ADMIN_SETUP_COMPLETE_LINE)).toBeInTheDocument();
        expect(screen.queryByText(/short setup list/i)).not.toBeInTheDocument();
      },
    );

    it.each([
      ["producer", PRODUCER_OFFERS_CONFIRM_LINE],
      ["artist", NEXT_STEP_LINES.artist.offers],
    ] as const)(
      "%s is unaffected by setup completion: still names what is waiting, not a setup claim",
      async (role, expectedLine) => {
        // Only the admin line makes a setup-list promise in the first place; producer and
        // artist lines describe what is waiting on them, true either way. The producer
        // expectation is PRODUCER_OFFERS_CONFIRM_LINE (not NEXT_STEP_LINES.producer.offers)
        // because canConfirmHolder defaults to true, the confirm-capable branch.
        flowHolder.flow = BOOKING_FLOW_DEFAULTS;
        featureHolder.bookingFlowOn = true;
        bookingSetupHolder.complete = true;
        authState.memberships = [membershipFor(role)];
        acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
        renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

        await screen.findByRole("heading", { name: /you've joined/i });
        expect(screen.getByText(expectedLine)).toBeInTheDocument();
        expect(screen.queryByText(ADMIN_SETUP_COMPLETE_LINE)).not.toBeInTheDocument();
      },
    );

    it("an admin at an org with the booking module off is unaffected by setup completion (there is no setup to be complete)", async () => {
      featureHolder.bookingFlowOn = false;
      bookingSetupHolder.complete = true; // must be ignored: the module is off, not done
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      expect(await screen.findByText(NEXT_STEP_LINES.admin.off)).toBeInTheDocument();
      expect(screen.queryByText(ADMIN_SETUP_COMPLETE_LINE)).not.toBeInTheDocument();
    });

    it("an admin whose setup is still outstanding keeps the original setup-list line (unchanged default)", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      bookingSetupHolder.complete = false;
      authState.memberships = [membershipFor("admin")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      expect(await screen.findByText(/gets your first offers out/i)).toBeInTheDocument();
    });
  });

  describe("resolveNextStepLine (pure)", () => {
    it("returns the setup-list promise for an admin whose booking setup is outstanding", () => {
      expect(resolveNextStepLine("admin", "offers", false)).toBe(NEXT_STEP_LINES.admin.offers);
      expect(resolveNextStepLine("admin", "direct", false)).toBe(NEXT_STEP_LINES.admin.direct);
    });

    it("swaps in ADMIN_SETUP_COMPLETE_LINE for an admin whose booking setup is already done", () => {
      expect(resolveNextStepLine("admin", "offers", true)).toBe(ADMIN_SETUP_COMPLETE_LINE);
      expect(resolveNextStepLine("admin", "direct", true)).toBe(ADMIN_SETUP_COMPLETE_LINE);
    });

    it("never swaps the line for bookingState 'off', regardless of setup completion", () => {
      expect(resolveNextStepLine("admin", "off", true)).toBe(NEXT_STEP_LINES.admin.off);
    });

    it("never swaps the line for producer direct/off or artist any state, regardless of setup completion", () => {
      expect(resolveNextStepLine("producer", "direct", true)).toBe(NEXT_STEP_LINES.producer.direct);
      expect(resolveNextStepLine("producer", "off", true)).toBe(NEXT_STEP_LINES.producer.off);
      expect(resolveNextStepLine("artist", "offers", true)).toBe(NEXT_STEP_LINES.artist.offers);
    });

    it("gates the producer 'offers' confirmation claim on canConfirmBookings, not the org's flow state alone", () => {
      // The org may have revoked producer_can_confirm_bookings (src/lib/capabilities.ts):
      // an offer pipeline running does not by itself mean confirming is this producer's
      // to do.
      expect(resolveNextStepLine("producer", "offers", true, true)).toBe(PRODUCER_OFFERS_CONFIRM_LINE);
      expect(resolveNextStepLine("producer", "offers", true, false)).toBe(NEXT_STEP_LINES.producer.offers);
    });

    it("defaults canConfirmBookings to true when omitted, matching useCan's own loading fallback for a producer", () => {
      expect(resolveNextStepLine("producer", "offers", true)).toBe(PRODUCER_OFFERS_CONFIRM_LINE);
    });

    it("returns the artist-not-linked line for an artist whose profile could not be linked, regardless of booking state", () => {
      // Regression: an artist invite whose catalog artist was already claimed (two
      // invites stamped to the same artist, or an admin re-linking between invite and
      // accept) leaves the invitee with no artists row. Offers/bookings are keyed on
      // artist_id, so the ordinary offers/direct lines promise something that cannot
      // happen for this account until an admin links it.
      expect(resolveNextStepLine("artist", "offers", false, true, false)).toBe(ARTIST_NOT_LINKED_NEXT_STEP_LINE);
      expect(resolveNextStepLine("artist", "direct", false, true, false)).toBe(ARTIST_NOT_LINKED_NEXT_STEP_LINE);
      expect(resolveNextStepLine("artist", "off", false, true, false)).toBe(ARTIST_NOT_LINKED_NEXT_STEP_LINE);
    });

    it("defaults artistLinked to true when omitted, matching the common (linked) case", () => {
      expect(resolveNextStepLine("artist", "offers", false)).toBe(NEXT_STEP_LINES.artist.offers);
    });

    it("does not affect admin or producer lines: artistLinked only ever gates the artist role", () => {
      expect(resolveNextStepLine("admin", "offers", false, true, false)).toBe(NEXT_STEP_LINES.admin.offers);
      expect(resolveNextStepLine("producer", "offers", true, true, false)).toBe(PRODUCER_OFFERS_CONFIRM_LINE);
    });
  });

  describe("resolveBookingRunState (pure)", () => {
    it("is 'off' when the booking_flow module is not entitled, regardless of flow data", () => {
      expect(resolveBookingRunState(false, BOOKING_FLOW_DEFAULTS)).toBe("off");
    });

    it("is 'off' when flow data has not resolved yet", () => {
      expect(resolveBookingRunState(true, undefined)).toBe("off");
    });

    it("is 'off' when the org's flow preset is paused", () => {
      expect(resolveBookingRunState(true, applyPreset(BOOKING_FLOW_DEFAULTS, "off"))).toBe("off");
    });

    it("is 'offers' when active and artist_acceptance is on", () => {
      expect(resolveBookingRunState(true, BOOKING_FLOW_DEFAULTS)).toBe("offers");
    });

    it("is 'direct' when active and artist_acceptance is off", () => {
      expect(resolveBookingRunState(true, applyPreset(BOOKING_FLOW_DEFAULTS, "direct"))).toBe("direct");
    });
  });

  it("navigates to the dashboard, replacing history, only when the button is clicked", async () => {
    // replace: true so the consumed accept-invite URL does not stay in history: Back
    // would otherwise re-mount this page and re-run acceptInvitation.
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    const button = await screen.findByRole("button", { name: /go to dashboard/i });
    expect(navigateSpy).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
  });

  it("falls back to 'your organization' when the joined org is not resolvable", async () => {
    authState.orgs = [];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    expect(await screen.findByRole("heading", { name: /you've joined your organization/i })).toBeInTheDocument();
  });

  it("omits the role line when no membership resolves the role", async () => {
    authState.memberships = [];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(screen.queryByText(/your role:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(roleDescription("admin")))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(roleDescription("producer")))).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(roleDescription("artist")))).not.toBeInTheDocument();
  });

  it("shows a persistent notice in the card when the artist profile could not be linked", async () => {
    // This is the one consequence on this screen the invitee may need to act on, so it
    // belongs in the permanent card rather than an auto-dismissing toast.
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(await screen.findByText(/could not automatically link your artist profile/i)).toBeInTheDocument();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("does not show the artist-link notice when linking succeeded", async () => {
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    expect(screen.queryByText(/could not automatically link/i)).not.toBeInTheDocument();
  });

  describe("producer next-step line respects the confirm_bookings capability, not just the org's flow state", () => {
    // Regression: the producer 'offers' line used to unconditionally claim "confirmations
    // are yours to make", but producer_can_confirm_bookings (src/lib/capabilities.ts) is
    // admin-revocable in Settings > Roles and permissions -- enforced at RLS, edge, and UI
    // (DashboardPage's bulk Confirm button, ShowsBookingsPage / ShowDateDetailSheet's
    // action visibility). This screen must not promise a right the org may have revoked.
    it("producer, offers flow, capability ON: promises confirming bookings is theirs to do", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      canConfirmHolder.value = true;
      authState.memberships = [membershipFor("producer")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(PRODUCER_OFFERS_CONFIRM_LINE)).toBeInTheDocument();
    });

    it("producer, offers flow, capability OFF: does not claim confirmations are the producer's to make", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      canConfirmHolder.value = false;
      authState.memberships = [membershipFor("producer")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(NEXT_STEP_LINES.producer.offers)).toBeInTheDocument();
      expect(screen.queryByText(/yours to do/i)).not.toBeInTheDocument();
      expect(screen.queryByText(PRODUCER_OFFERS_CONFIRM_LINE)).not.toBeInTheDocument();
    });

    it("producer, direct flow: unaffected by the capability, the direct line only describes the booking's state", async () => {
      flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
      featureHolder.bookingFlowOn = true;
      canConfirmHolder.value = false;
      authState.memberships = [membershipFor("producer")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(NEXT_STEP_LINES.producer.direct)).toBeInTheDocument();
    });

    it("admin and artist next-step lines are unaffected by the confirm_bookings capability", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      canConfirmHolder.value = false;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(NEXT_STEP_LINES.artist.offers)).toBeInTheDocument();
    });
  });

  describe("artist next-step line accounts for an unlinked profile, and the alert outranks it", () => {
    // Regression: when joined.artistLinked is false, the card still rendered
    // NEXT_STEP_LINES.artist.offers/direct ("Offers arrive by email...", "Your producer
    // books you directly...") directly above the alert explaining the link failed.
    // bookings.artist_id has no row to key on for this account, so neither promise can
    // come true until an admin links the profile.
    it("does not promise offers arrive when the org runs an offer pipeline but the artist profile could not be linked", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.queryByText(NEXT_STEP_LINES.artist.offers)).not.toBeInTheDocument();
      expect(screen.getByText(/once an admin links your artist profile/i)).toBeInTheDocument();
    });

    it("does not promise direct booking either, when the artist profile could not be linked", async () => {
      flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.queryByText(NEXT_STEP_LINES.artist.direct)).not.toBeInTheDocument();
      expect(screen.getByText(/once an admin links your artist profile/i)).toBeInTheDocument();
    });

    it("still shows the real next-step line for an artist whose profile linked successfully (unaffected default)", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      expect(screen.getByText(NEXT_STEP_LINES.artist.offers)).toBeInTheDocument();
    });

    it("puts the alert above the next-step line in the DOM, so the consequence outranks the promise", async () => {
      flowHolder.flow = BOOKING_FLOW_DEFAULTS;
      featureHolder.bookingFlowOn = true;
      authState.memberships = [membershipFor("artist")];
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      const card = screen.getByTestId("accept-invite-success");
      const html = card.innerHTML.toLowerCase();
      const alertIndex = html.indexOf("could not automatically link");
      const lineIndex = html.indexOf("once an admin links");
      expect(alertIndex).toBeGreaterThan(-1);
      expect(lineIndex).toBeGreaterThan(-1);
      expect(alertIndex).toBeLessThan(lineIndex);
    });

    it("demotes the dashboard button to a secondary action when it leads to a dead end for the unlinked artist", async () => {
      // Mirrors the wrong-email error card: the remedy (an admin linking the profile,
      // named in the alert) outranks the passive "Go to dashboard" escape, which for this
      // account currently shows only "No artist profile linked to your account."
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      authState.memberships = [membershipFor("artist")];
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      const button = screen.getByRole("button", { name: /go to dashboard/i });
      expect(button.className).toContain("bg-background");
    });

    it("keeps the dashboard button as the primary action once the artist profile is linked", async () => {
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      authState.memberships = [membershipFor("artist")];
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      const button = screen.getByRole("button", { name: /go to dashboard/i });
      expect(button.className).toContain("bg-primary");
    });

    it("does not demote the dashboard button for admin or producer roles, since the dashboard is not a dead end for them", async () => {
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      authState.memberships = [membershipFor("admin")];
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      const button = screen.getByRole("button", { name: /go to dashboard/i });
      expect(button.className).toContain("bg-primary");
    });
  });

  describe("the success card stops asserting joined/role facts once the signed-in session changes underneath it", () => {
    // Reproduced in the running local app: `joined` is component state, but
    // user/memberships/orgs come live from AuthContext. A cross-tab sign-out/sign-in (or
    // dev autologin re-signing-in as a different account) left the card's heading and
    // "Signed in as" line pointing at two different accounts while the role block quietly
    // swapped to whichever org/role the NEW session happened to resolve -- none of it true
    // for the person actually reading the screen.
    it("swaps to a neutral, identity-free message instead of continuing to show a stale org/role", async () => {
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      authState.memberships = [membershipFor("admin")];
      const { rerender } = renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined riverside opera/i });
      expect(screen.getByText(/your role: admin/i)).toBeInTheDocument();

      // The session under the mounted page changes to a different account.
      authState.user = { id: "u2", email: "someone-else@example.com" };
      rerender(acceptInviteTree(`${ROUTES.ACCEPT_INVITE}?token=abc123`));

      expect(screen.queryByRole("heading", { name: /you've joined riverside opera/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/your role:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/singer@example\.com/)).not.toBeInTheDocument();
      expect(await screen.findByRole("heading", { name: /signed in as a different account/i })).toBeInTheDocument();
      expect(screen.getByText(/someone-else@example\.com/)).toBeInTheDocument();
    });

    it("still goes to the dashboard from the identity-changed state", async () => {
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      authState.memberships = [membershipFor("admin")];
      const { rerender } = renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      await screen.findByRole("heading", { name: /you've joined riverside opera/i });

      authState.user = { id: "u2", email: "someone-else@example.com" };
      rerender(acceptInviteTree(`${ROUTES.ACCEPT_INVITE}?token=abc123`));

      const button = await screen.findByRole("button", { name: /go to dashboard/i });
      fireEvent.click(button);
      expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
    });

    it("does not swap to the identity-changed state merely because the user object is unset while loading", async () => {
      // Guard against a false positive: joined is only ever set once `user` is truthy (the
      // effect bounces to /login otherwise), so a later `user` of exactly the same id must
      // not be treated as a change.
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
      authState.memberships = [membershipFor("admin")];
      const { rerender } = renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
      await screen.findByRole("heading", { name: /you've joined riverside opera/i });

      // Same user id, e.g. a re-render triggered by an unrelated auth context update.
      authState.user = { id: "u1", email: "singer@example.com" };
      rerender(acceptInviteTree(`${ROUTES.ACCEPT_INVITE}?token=abc123`));

      expect(screen.getByRole("heading", { name: /you've joined riverside opera/i })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /signed in as a different account/i })).not.toBeInTheDocument();
    });
  });
});

describe("success screen copy has no em or en dashes", () => {
  it("NEXT_STEP_LINES and ADMIN_SETUP_COMPLETE_LINE have no dashes", () => {
    for (const perRole of Object.values(NEXT_STEP_LINES)) {
      for (const line of Object.values(perRole)) {
        expect(line).not.toMatch(/[—–]/);
      }
    }
    expect(ADMIN_SETUP_COMPLETE_LINE).not.toMatch(/[—–]/);
    expect(PRODUCER_OFFERS_CONFIRM_LINE).not.toMatch(/[—–]/);
    expect(ARTIST_NOT_LINKED_NEXT_STEP_LINE).not.toMatch(/[—–]/);
  });

  it.each(["admin", "producer", "artist"] as const)(
    "the rendered %s success card has no dashes",
    async (role) => {
      authState.memberships = [membershipFor(role)];
      // artistLinked: false so the sweep also covers the inline notice copy.
      acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
      renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

      await screen.findByRole("heading", { name: /you've joined/i });
      const card = screen.getByTestId("accept-invite-success");
      expect(card.textContent ?? "").not.toMatch(/[—–]/);
    },
  );

  it("the rendered admin success card has no dashes when booking setup is already complete", async () => {
    flowHolder.flow = BOOKING_FLOW_DEFAULTS;
    featureHolder.bookingFlowOn = true;
    bookingSetupHolder.complete = true;
    authState.memberships = [membershipFor("admin")];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: false });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    const card = screen.getByTestId("accept-invite-success");
    expect(card.textContent ?? "").not.toMatch(/[—–]/);
  });

  it("the rendered wrong-email error card has no dashes", async () => {
    acceptInvitationMock.mockRejectedValueOnce(new Error("Invitation was issued to a different email"));
    const { container } = renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("button", { name: /sign out and use another address/i });
    expect(container.textContent ?? "").not.toMatch(/[—–]/);
  });
});

describe("useFeature really reads useAuth().currentOrg, not a stale org (unmocked hook)", () => {
  it("resolves booking_flow entitlement for the JOINED org, proving switchOrg lands before this hook's render", async () => {
    // Every other test in this file fully mocks useFeature/useEntitlements, so none of
    // them can catch a regression in the ordering the page's own doc comment relies on:
    // "switchOrg(orgId) above already ran by the time `joined` is set (same .then
    // callback, batched with setJoined into one render)". This test routes useFeature
    // through its REAL implementation (hooksMode.real), backed only by a mocked
    // fetchEntitlements data-access call (the sanctioned data-layer mock, same pattern as
    // useEntitlements.test.tsx) -- no fake Supabase client needed, since the real
    // useEntitlements() only ever uses `supabase` as an opaque arg to fetchEntitlements.
    //
    // authState starts on a DIFFERENT org (oldOrg) with BOTH orgs already in `orgs` (as
    // refreshOrgs would leave it). switchOrgSpy's real implementation (see its
    // declaration) flips authState.currentOrg the moment switchOrg(orgId) runs, so this
    // proves the real useFeature -> useEntitlements -> fetchEntitlements chain re-derives
    // off the JOINED org, not whatever org the invitee was in before accepting. Verified by
    // removing the page's own `switchOrg(orgId)` call: with it gone,
    // fetchEntitlementsMock is only ever asked about oldOrg and this assertion times out
    // (restored before landing -- see the round's test log, not left in the diff).
    hooksMode.real = true;
    authState.currentOrg = oldOrg;
    authState.orgs = [oldOrg, org1];
    authState.memberships = [membershipFor("admin")];
    fetchEntitlementsMock.mockResolvedValue([{ feature: "booking_flow", enabled: true }]);
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });

    renderAtWithQueryClient(`${ROUTES.ACCEPT_INVITE}?token=abc123`);

    await screen.findByRole("heading", { name: /you've joined/i });
    await waitFor(() =>
      expect(fetchEntitlementsMock).toHaveBeenCalledWith(expect.anything(), org1.id),
    );
  });
});
