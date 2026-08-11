import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ROUTES } from "@/config/app.config";
import { partialMock } from "@/test/castHelpers";

const navigateSpy = vi.fn();
// Narrow seam: keep every other react-router-dom export real (Link, MemoryRouter, ...)
// so this test stays honest if the component later renders more than useNavigate.
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

const markReadSpy = vi.fn();
const markAllSpy = vi.fn();

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/features/auth/AuthContext";

// The role→route reachability check reads the org's Editor Mode page-access override
// (see src/lib/notifications/entityRoutes.ts canReachPath), so NotificationsList must
// source it from useEditorConfig rather than assuming the static default registry.
let mockPageAccess: Record<string, string[]> = {};
vi.mock("@/features/editor/EditorContext", () => ({
  useEditorConfig: () => ({ pageAccess: mockPageAccess }),
}));

interface FakeNotification {
  id: string;
  title: string;
  message: string | null;
  read: boolean;
  created_at: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
}
let mockNotifications: FakeNotification[] = [];

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ data: mockNotifications, isLoading: false }),
  useMarkNotificationRead: () => ({ mutate: markReadSpy, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: markAllSpy, isPending: false }),
}));

import { NotificationsList } from "./NotificationsList";

function mockRoles(roles: string[], isSuperAdmin = false) {
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({ roles: roles as never, isSuperAdmin }),
  );
}

describe("NotificationsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications = [];
    mockPageAccess = {};
    mockRoles(["admin"]);
  });

  it("clicking an unread notification with a resolvable target marks it read, navigates, and fires onNavigate", () => {
    mockNotifications = [{
      id: "n1", title: "Offer expiring soon", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    const onNavigate = vi.fn();
    const { container } = renderWithProviders(<NotificationsList onNavigate={onNavigate} />);

    // Paired with the absence assertion below: a targeted row DOES render the chevron,
    // so the pair actually proves the affordance tracks reachability instead of always
    // being present (or always absent).
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();

    fireEvent.click(screen.getByText("Offer expiring soon"));

    expect(markReadSpy).toHaveBeenCalledWith("n1");
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.BOOKINGS);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("clicking an unread notification with no resolvable target only marks it read", () => {
    mockNotifications = [{
      id: "n2", title: "Something happened", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: null, related_entity_id: null,
    }];
    const onNavigate = vi.fn();
    renderWithProviders(<NotificationsList onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("Something happened"));

    expect(markReadSpy).toHaveBeenCalledWith("n2");
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("a read notification with a target still navigates on click without re-marking it read", () => {
    mockNotifications = [{
      id: "n3", title: "Sync needs attention", message: null, read: true,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "airtable_sync_log", related_entity_id: null,
    }];
    renderWithProviders(<NotificationsList />);

    fireEvent.click(screen.getByText("Sync needs attention"));

    expect(markReadSpy).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(`${ROUTES.SETTINGS}?tab=airtable`);
  });

  // Regression: booking/show_date/show_date_offer_tier notifications are written for
  // artists (booking_confirmed, offer_expiring, schedule_change) just as often as for
  // producers, but /bookings is admin/producer only. An artist clicking one must land
  // on their availability page, where their booked dates actually render, not get
  // bounced by ProtectedRoute.
  it("routes an artist's booking notification to their availability page, not the admin-only bookings board", () => {
    mockRoles(["artist"]);
    mockNotifications = [{
      id: "n4", title: "Booking confirmed", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    fireEvent.click(screen.getByText("Booking confirmed"));

    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.AVAILABILITY);
  });

  // Regression: the "goes somewhere" affordance used to be a `title` attribute, which
  // many screen readers skip once the element already has an accessible name (the
  // notification's own title/message/timestamp), and which never surfaces on touch at
  // all. A visually-hidden (sr-only) span inside the button's accessible name reaches
  // both audiences the title attribute missed.
  it("gives a row with a target a screen-reader-only affordance, and gives a row with no target none", () => {
    mockNotifications = [
      {
        id: "n8", title: "Offer expiring soon", message: null, read: false,
        created_at: "2026-08-10T00:00:00Z",
        related_entity_type: "booking", related_entity_id: "b1",
      },
      {
        id: "n9", title: "Something happened", message: null, read: false,
        created_at: "2026-08-10T00:00:00Z",
        related_entity_type: null, related_entity_id: null,
      },
    ];
    renderWithProviders(<NotificationsList />);

    const targetedRow = screen.getByText("Offer expiring soon").closest("a")!;
    expect(targetedRow).not.toHaveAttribute("title");
    expect(targetedRow.querySelector(".sr-only")?.textContent).toMatch(/opens the related page/i);

    const untargetedButton = screen.getByText("Something happened").closest("button")!;
    expect(untargetedButton).not.toHaveAttribute("title");
    expect(untargetedButton.querySelector(".sr-only")).toBeNull();
  });

  // Regression: a targeted row used to render as a plain <button>, which has no `href` —
  // so a notification could only ever be opened via the in-app SPA navigate. Cmd/ctrl/
  // middle-click (open in a new tab), hover-preview in the status bar, and "copy link
  // address" all depend on a real anchor with a real href.
  it("renders a targeted row as a real anchor with an href to its destination", () => {
    mockNotifications = [{
      id: "n10", title: "Offer expiring soon", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);
    const link = screen.getByText("Offer expiring soon").closest("a");
    expect(link).toHaveAttribute("href", ROUTES.BOOKINGS);
  });

  // A target-less notification has nowhere to send a cmd/middle-click either, so it stays
  // a real <button> (keyboard-focusable, no dead `href`) rather than an anchor with none.
  it("renders a target-less row as a button, not an anchor", () => {
    mockNotifications = [{
      id: "n11", title: "Something happened", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: null, related_entity_id: null,
    }];
    renderWithProviders(<NotificationsList />);
    expect(screen.getByText("Something happened").closest("button")).not.toBeNull();
    expect(screen.getByText("Something happened").closest("a")).toBeNull();
  });

  // Regression: the row's onClick used to unconditionally call `navigate`, which only
  // makes sense for a plain, unmodified left click. A cmd/ctrl/shift-click or a middle-click
  // signals "open in a new tab", and hijacking that with an in-app SPA navigate in the
  // CURRENT tab silently threw away the very intent the modifier expressed. The real href
  // (see above) lets the browser handle those clicks itself; this component's job is only
  // to get out of the way.
  it("still marks a modified click's notification read, but leaves navigation to the browser's own new-tab handling", () => {
    mockNotifications = [{
      id: "n12", title: "Offer expiring soon", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    const link = screen.getByText("Offer expiring soon").closest("a")!;
    // The row is a real <a href>, and the component deliberately leaves a modified click's
    // default action untouched so the browser's own new-tab handling applies (see the
    // component comment above `handleClick`). jsdom's own anchor-navigation default action
    // is "not implemented" and logs a console error whenever it runs unprevented, which is
    // pure test noise, not a signal about the component. This listener swallows only that
    // jsdom side effect (preventDefault, never stopPropagation) at the target phase, before
    // React's own delegated handler runs on the bubble path, so it changes nothing about
    // what the component itself observes or does; the assertions below still verify the
    // component's actual behavior via the spies.
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link, { metaKey: true });

    expect(markReadSpy).toHaveBeenCalledWith("n12");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // Regression: middle-click fires the DOM `auxclick` event, not `click`, in every
  // evergreen browser, so the `e.button !== 0` branch inside the `click` handler above
  // never actually runs for a middle-click — the row's real `href` still opens a new tab
  // (native anchor behavior), but the notification was never marked read. A dedicated
  // `auxclick` handler is needed to cover exactly that gap.
  it("marks a middle-clicked notification read, leaving the new-tab open to the browser", () => {
    mockNotifications = [{
      id: "n13", title: "Offer expiring soon", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    const link = screen.getByText("Offer expiring soon").closest("a")!;
    fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));

    expect(markReadSpy).toHaveBeenCalledWith("n13");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // A right-click also fires `auxclick` in some browsers (button 2), but it opens the
  // native context menu, not a new tab, so there is nothing for this component to do:
  // read-marking on right-click would fire on every context-menu open, including ones
  // the user cancels without picking anything.
  it("does not mark a right-clicked notification read", () => {
    mockNotifications = [{
      id: "n14", title: "Offer expiring soon", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    const link = screen.getByText("Offer expiring soon").closest("a")!;
    fireEvent(link, new MouseEvent("auxclick", { button: 2, bubbles: true, cancelable: true }));

    expect(markReadSpy).not.toHaveBeenCalled();
  });

  it("does not show the arrow affordance for a notification the current role has no destination for", () => {
    mockRoles(["artist"]);
    mockNotifications = [{
      id: "n5", title: "Sync needs attention", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "airtable_sync_log", related_entity_id: null,
    }];
    const { container } = renderWithProviders(<NotificationsList />);

    // The chevron promises the row goes somewhere on click; it must not appear
    // when this role has nowhere to go (see the click assertions below).
    expect(container.querySelector(".lucide-chevron-right")).toBeNull();

    fireEvent.click(screen.getByText("Sync needs attention"));

    expect(markReadSpy).toHaveBeenCalledWith("n5");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  // Regression: entityRoutes' reachability check must read the ACTIVE ORG's Editor Mode
  // override, not just the static default registry, or an org that edits its page
  // access (e.g. drops producer from /bookings) reopens the exact dead-end/bounce this
  // deep-link feature exists to prevent.
  it("stops routing to bookings once the org's Editor Mode removes this role's access", () => {
    mockRoles(["producer"]);
    mockPageAccess = { "/bookings": ["admin"] };
    mockNotifications = [{
      id: "n6", title: "Cast escalation requested", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    fireEvent.click(screen.getByText("Cast escalation requested"));

    expect(markReadSpy).toHaveBeenCalledWith("n6");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("routes to bookings once the org's Editor Mode grants this role access, even without the default role", () => {
    mockRoles(["artist"]);
    mockPageAccess = { "/bookings": ["admin", "producer", "artist"] };
    mockNotifications = [{
      id: "n7", title: "Booking confirmed", message: null, read: false,
      created_at: "2026-08-10T00:00:00Z",
      related_entity_type: "booking", related_entity_id: "b1",
    }];
    renderWithProviders(<NotificationsList />);

    fireEvent.click(screen.getByText("Booking confirmed"));

    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.BOOKINGS);
  });
});
