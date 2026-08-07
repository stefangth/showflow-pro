import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { ROUTE_FEATURES } from "@/config/app.config";
import { partialMock } from "@/test/castHelpers";
import type { User } from "@supabase/supabase-js";

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
// AppLayout is heavy (nav, toolbar, supabase); stub it so we can assert the
// disabled screen is wrapped in it (toolbar stays reachable for a previewing super-admin).
vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "app-layout" }, children),
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
  }: { requiredRoles?: React.ComponentProps<typeof ProtectedRoute>["requiredRoles"]; path?: string } = {}
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
                requiredRoles,
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
    vi.mocked(useEditorConfig).mockReturnValue(partialMock<ReturnType<typeof useEditorConfig>>({
      isEditorMode: false,
      pageAccess: {},
    }));
    vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
      features: new Set(),
      isLoading: false,
    }));
  });

  it("shows loading spinner when auth is loading", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: null,
      loading: true,
      roles: [],
      currentOrg: null,
    }));

    renderProtected();

    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects to /login when user is not authenticated", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: null,
      loading: false,
      roles: [],
      currentOrg: null,
    }));

    renderProtected();

    expect(screen.getByText("Login Page")).toBeTruthy();
  });

  it("shows the no-org screen when the user has no active org", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: [],
      currentOrg: null,
    }));

    renderProtected();

    expect(screen.getByText("No Org Screen")).toBeTruthy();
  });

  it("shows the suspended screen when the active org is suspended", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: ["producer"],
      currentOrg: { ...ACTIVE_ORG, status: "suspended" },
    }));

    renderProtected({ requiredRoles: ["producer"] });

    expect(screen.getByText("Suspended Screen")).toBeTruthy();
  });

  it("renders children for an authenticated org member with no role restriction", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    }));

    renderProtected();

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("renders children for user with matching required role", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: ["producer"],
      currentOrg: ACTIVE_ORG,
    }));

    renderProtected({ requiredRoles: ["admin", "producer"] });

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("redirects to /dashboard when user lacks required role", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    }));

    renderProtected({ requiredRoles: ["admin"] });

    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("allows admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-admin" }),
      loading: false,
      roles: ["admin"],
      currentOrg: ACTIVE_ORG,
    }));
    vi.mocked(useEditorConfig).mockReturnValue(partialMock<ReturnType<typeof useEditorConfig>>({
      isEditorMode: true,
      pageAccess: {},
    }));

    renderProtected({ requiredRoles: ["producer"] });

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("does NOT allow non-admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      loading: false,
      roles: ["artist"],
      currentOrg: ACTIVE_ORG,
    }));
    vi.mocked(useEditorConfig).mockReturnValue(partialMock<ReturnType<typeof useEditorConfig>>({
      isEditorMode: true,
      pageAccess: {},
    }));

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
      vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
        user: partialMock<User>({ id: "user-1" }),
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      }));
      vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
        features: new Set(),
        isLoading: false,
      }));

      renderProtected();

      expect(screen.getByText("Hire orders is not enabled")).toBeTruthy();
      expect(screen.queryByText("Protected Content")).toBeNull();
      // A genuine member gets the bare disabled screen, NOT the app chrome (that
      // wrap exists only to keep the editor toolbar reachable for a super-admin).
      expect(screen.queryByTestId("app-layout")).toBeNull();
    });

    it("shows the feature gate, inside AppLayout, to a super-admin previewing via view-as", () => {
      vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
        user: partialMock<User>({ id: "user-1" }),
        loading: false,
        roles: ["admin"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: true,
        viewAsRole: "producer",
      }));
      vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
        features: new Set(),
        isLoading: false,
      }));

      renderProtected();

      expect(screen.getByText("Hire orders is not enabled")).toBeTruthy();
      expect(screen.queryByText("Protected Content")).toBeNull();
      // Wrapped in AppLayout so the editor toolbar (its child) stays reachable to exit view-as.
      expect(screen.getByTestId("app-layout")).toBeTruthy();
    });

    it("renders children when the feature is enabled for the org", () => {
      vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
        user: partialMock<User>({ id: "user-1" }),
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      }));
      vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
        features: new Set(["hire_orders"]),
        isLoading: false,
      }));

      renderProtected();

      expect(screen.getByText("Protected Content")).toBeTruthy();
    });

    it("lets a super-admin bypass the feature gate", () => {
      vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
        user: partialMock<User>({ id: "user-1" }),
        loading: false,
        roles: [],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: true,
      }));
      vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
        features: new Set(),
        isLoading: false,
      }));

      renderProtected();

      expect(screen.getByText("Protected Content")).toBeTruthy();
    });

    it("does not flash FeatureDisabledScreen while entitlements are still loading", () => {
      vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
        user: partialMock<User>({ id: "user-1" }),
        loading: false,
        roles: ["producer"],
        currentOrg: ACTIVE_ORG,
        isSuperAdmin: false,
      }));
      vi.mocked(useEntitlements).mockReturnValue(partialMock<ReturnType<typeof useEntitlements>>({
        features: new Set(),
        isLoading: true,
      }));

      renderProtected();

      expect(screen.queryByText("Hire orders is not enabled")).toBeNull();
      expect(screen.getByText("Protected Content")).toBeTruthy();
    });
  });
});
