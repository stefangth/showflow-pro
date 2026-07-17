import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { ROUTE_FEATURES } from "@/config/app.config";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("./AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../editor/EditorContext", () => ({
  useEditorConfig: vi.fn(() => ({ isEditorMode: false, pageAccess: {} })),
}));

vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

// The org-gate screens are stubbed to identifiable text so we assert which gate fired.
vi.mock("@/pages/NoOrgScreen", () => ({
  default: () => React.createElement("div", null, "No Org Screen"),
}));
vi.mock("@/pages/SuspendedOrgScreen", () => ({
  default: () => React.createElement("div", null, "Suspended Screen"),
}));

import { useAuth } from "./AuthContext";
import { useEditorConfig } from "../editor/EditorContext";
import { useEntitlements } from "@/hooks/useEntitlements";

// ── Helpers ───────────────────────────────────────────────────────────────

const ACTIVE_ORG = { id: "org-1", name: "Acme", slug: "acme", status: "active" };

function renderProtected(
  {
    requiredRoles,
    path = "/protected",
  }: { requiredRoles?: string[]; path?: string } = {}
) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          { path: "/login", element: React.createElement("div", null, "Login Page") }
        ),
        React.createElement(
          Route,
          { path: "/dashboard", element: React.createElement("div", null, "Dashboard") }
        ),
        React.createElement(
          Route,
          {
            path,
            element: React.createElement(
              ProtectedRoute,
              {
                requiredRoles: requiredRoles as any,
                children: React.createElement("div", null, "Protected Content"),
              }
            ),
          }
        )
      )
    )
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEditorConfig).mockReturnValue({
      isEditorMode: false,
      pageAccess: {},
    } as any);
    vi.mocked(useEntitlements).mockReturnValue({
      features: new Set(),
      isLoading: false,
    } as any);
  });

  it("shows loading spinner when auth is loading", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      roles: [],
      currentOrg: null,
    } as any);

    renderProtected();

    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects to /login when user is not authenticated", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      roles: [],
      currentOrg: null,
    } as any);

    renderProtected();

    expect(screen.getByText("Login Page")).toBeTruthy();
  });

  it("shows the no-org screen when the user has no active org", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: [],
      currentOrg: null,
    } as any);

    renderProtected();

    expect(screen.getByText("No Org Screen")).toBeTruthy();
  });

  it("shows the suspended screen when the active org is suspended", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["producer"],
      currentOrg: { ...ACTIVE_ORG, status: "suspended" },
    } as any);

    renderProtected({ requiredRoles: ["producer"] });

    expect(screen.getByText("Suspended Screen")).toBeTruthy();
  });

  it("renders children for an authenticated org member with no role restriction", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    } as any);

    renderProtected();

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("renders children for user with matching required role", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["producer"],
      currentOrg: ACTIVE_ORG,
    } as any);

    renderProtected({ requiredRoles: ["admin", "producer"] });

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("redirects to /dashboard when user lacks required role", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    } as any);

    renderProtected({ requiredRoles: ["admin"] });

    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("allows admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-admin" } as any,
      loading: false,
      roles: ["admin"],
      currentOrg: ACTIVE_ORG,
    } as any);
    vi.mocked(useEditorConfig).mockReturnValue({
      isEditorMode: true,
      pageAccess: {},
    } as any);

    renderProtected({ requiredRoles: ["producer"] });

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("does NOT allow non-admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    } as any);
    vi.mocked(useEditorConfig).mockReturnValue({
      isEditorMode: true,
      pageAccess: {},
    } as any);

    renderProtected({ requiredRoles: ["admin"] });

    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  describe("feature gating", () => {
    // ROUTE_FEATURES is empty in production; inject a temporary entry to
    // exercise the gate mechanism, then remove it so other tests are unaffected.
    beforeEach(() => {
      (ROUTE_FEATURES as Record<string, string>)["/protected"] = "hire_orders";
    });
    afterEach(() => {
      delete (ROUTE_FEATURES as Record<string, string>)["/protected"];
    });

    it("shows FeatureDisabledScreen when the route's feature is disabled for the org", () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: "user-1" } as any,
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      } as any);
      vi.mocked(useEntitlements).mockReturnValue({
        features: new Set(),
        isLoading: false,
      } as any);

      renderProtected();

      expect(screen.getByText("Hire orders is not enabled")).toBeTruthy();
      expect(screen.queryByText("Protected Content")).toBeNull();
    });

    it("renders children when the feature is enabled for the org", () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: "user-1" } as any,
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      } as any);
      vi.mocked(useEntitlements).mockReturnValue({
        features: new Set(["hire_orders"]),
        isLoading: false,
      } as any);

      renderProtected();

      expect(screen.getByText("Protected Content")).toBeTruthy();
    });

    it("lets a super-admin bypass the feature gate", () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: "user-1" } as any,
        loading: false,
        roles: [],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: true,
      } as any);
      vi.mocked(useEntitlements).mockReturnValue({
        features: new Set(),
        isLoading: false,
      } as any);

      renderProtected();

      expect(screen.getByText("Protected Content")).toBeTruthy();
    });

    it("does not flash FeatureDisabledScreen while entitlements are still loading", () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: "user-1" } as any,
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      } as any);
      vi.mocked(useEntitlements).mockReturnValue({
        features: new Set(),
        isLoading: true,
      } as any);

      renderProtected();

      expect(screen.queryByText("Hire orders is not enabled")).toBeNull();
      expect(screen.getByText("Protected Content")).toBeTruthy();
    });
  });
});
