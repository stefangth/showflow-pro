import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { LinkedAccountPanel } from "./LinkedAccountPanel";

describe("LinkedAccountPanel", () => {
  it("unregistered artist → external badge, no login email", () => {
    renderWithProviders(
      <LinkedAccountPanel userId={null} bookingEmail="book@x.com" canSeeAccount={true} />,
    );
    expect(screen.getByText(/external/i)).toBeInTheDocument();
    expect(screen.queryByText("login@x.com")).not.toBeInTheDocument();
  });

  it("registered + admin → account name, login email, and effective digest email (login-first)", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada Lovelace" }}
        canSeeAccount={true}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByText("login@x.com").length).toBeGreaterThanOrEqual(1);
  });

  it("registered + admin + null account email → effective digest email falls back to booking", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: null, display_name: "Ada" }}
        canSeeAccount={true}
      />,
    );
    expect(screen.getByText("book@x.com")).toBeInTheDocument();
  });

  it("registered + producer (cannot see account) → badge only, no login email", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada" }}
        canSeeAccount={false}
      />,
    );
    expect(screen.getByText(/registered/i)).toBeInTheDocument();
    expect(screen.queryByText("login@x.com")).not.toBeInTheDocument();
  });
});
