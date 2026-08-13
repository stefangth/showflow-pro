import { render, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureInvitationToken } from "@/features/auth/invitationToken";
import { AnalyticsBridge } from "./AnalyticsBridge";

const analyticsLocations: string[] = [];

vi.mock("@/features/consent/ConsentContext", () => ({
  useConsent: () => ({ consent: { analytics: true, sessionReplay: false, errorTracking: false } }),
}));

vi.mock("./posthog", () => ({
  readAnalyticsConfig: () => ({ key: "phc_test", host: "https://analytics.test" }),
  applyConsent: vi.fn(() => analyticsLocations.push(`${window.location.pathname}${window.location.search}`)),
  capturePageview: vi.fn(),
}));

function InvitationRoute() {
  const location = useLocation();
  captureInvitationToken(
    {
      href: `${window.location.origin}${location.pathname}${location.search}${location.hash}`,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    },
    window.history,
    window.sessionStorage,
  );
  return <AnalyticsBridge />;
}

describe("invitation analytics ordering", () => {
  beforeEach(() => {
    analyticsLocations.length = 0;
    sessionStorage.clear();
    window.history.replaceState(null, "", "/accept-invite?token=stable-token");
  });

  it("scrubs the invitation token before the analytics effect initializes", async () => {
    render(
      <BrowserRouter>
        <Routes><Route path="/accept-invite" element={<InvitationRoute />} /></Routes>
      </BrowserRouter>,
    );

    await waitFor(() => expect(analyticsLocations).toEqual(["/accept-invite"]));
    expect(JSON.stringify(analyticsLocations)).not.toContain("stable-token");
    expect(window.location.href).not.toContain("stable-token");
  });
});
