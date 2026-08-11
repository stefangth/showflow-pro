import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnlinkedArtistCard } from "./UnlinkedArtistCard";

/**
 * The unlinked-artist state is shown identically on the Dashboard and the
 * Availability page. This locks the warm copy in one place so neither surface
 * can drift back to the old cold "No artist profile linked to your account"
 * line. The pure card needs no providers.
 */
describe("UnlinkedArtistCard", () => {
  it("names the org in the heading when one is given", () => {
    render(<UnlinkedArtistCard orgName="Acme" />);
    expect(screen.getByText("You're on the Acme roster")).toBeInTheDocument();
    expect(screen.getByText(/an admin still needs to link/i)).toBeInTheDocument();
  });

  it("falls back to a generic heading when the org name is absent", () => {
    render(<UnlinkedArtistCard orgName={null} />);
    expect(screen.getByText("You're on the roster")).toBeInTheDocument();
  });

  it("never shows the old cold copy", () => {
    render(<UnlinkedArtistCard orgName="Acme" />);
    expect(
      screen.queryByText(/No artist profile linked to your account/i),
    ).not.toBeInTheDocument();
  });
});
