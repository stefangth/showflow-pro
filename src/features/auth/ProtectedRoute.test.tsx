import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("./AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../editor/EditorContext", () => ({
  useEditorConfig: vi.fn(() => ({ isEditorMode: false, pageAccess: {} })),
}));

import { useAuth } from "./AuthContext";
import { useEditorConfig } from "../editor/EditorContext";

// ── Helpers ───────────────────────────────────────────────────────────────

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
  });

  it("shows loading spinner when auth is loading", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: true,
      roles: [],    } as any);

    renderProtected();

    // The loading spinner renders (no text, just a div with animate-spin)
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects to /login when user is not authenticated", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      roles: [],    } as any);

    renderProtected();

    expect(screen.getByText("Login Page")).toBeTruthy();
  });

  it("renders children for authenticated user with no role restriction", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],    } as any);

    renderProtected();

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("renders children for user with matching required role", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["producer"],    } as any);

    renderProtected({ requiredRoles: ["admin", "producer"] });

    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("redirects to /dashboard when user lacks required role", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],    } as any);

    renderProtected({ requiredRoles: ["admin"] });

    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("allows admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-admin" } as any,
      loading: false,
      roles: ["admin"],    } as any);
    vi.mocked(useEditorConfig).mockReturnValue({
      isEditorMode: true,
      pageAccess: {},
    } as any);

    renderProtected({ requiredRoles: ["producer"] });

    // Admin in editor mode bypasses role gates
    expect(screen.getByText("Protected Content")).toBeTruthy();
  });

  it("does NOT allow non-admin in editor mode to bypass role restrictions", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      loading: false,
      roles: ["artist"],    } as any);
    vi.mocked(useEditorConfig).mockReturnValue({
      isEditorMode: true,
      pageAccess: {},
    } as any);

    renderProtected({ requiredRoles: ["admin"] });

    // Non-admin in editor mode still redirects
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });
});
