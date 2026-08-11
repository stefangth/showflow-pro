import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { buildCapabilityInventory } from "@/lib/trust/capabilityInventory";
import { CapabilitiesCard } from "./CapabilitiesCard";

/** Escape a string for literal use inside a RegExp.
 *
 *  These matchers build a pattern out of copy that comes from the capability
 *  registry, so every metacharacter in it has to be neutralised, not just the
 *  full stops the headline happens to contain today. Escaping `.` alone left
 *  the backslash unescaped, which CodeQL flagged: a right whose label ever
 *  carried one would compile to a different pattern than the text it came
 *  from, and the test would fail somewhere far from the cause. The character
 *  class below includes the backslash itself, so it is escaped first. */
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("CapabilitiesCard", () => {
  // Every other card on Settings > Trust & data states a fact about the
  // signed-in organisation, and the tab's own header promises facts "narrowed
  // to the organisation you are signed in to". This card cannot deliver that:
  // it folds CAPABILITY_DEFS, i.e. the position each right SHIPS in, while
  // `resolveCapability` layers a platform default and an org override on top
  // before anything is enforced. Without the qualifier an administrator who
  // has already switched a right on reads "Off by default" as "off here".
  it("says the list is the shipped position, not this organisation's setting", () => {
    renderWithProviders(<CapabilitiesCard />);

    const qualifier = screen.getByText(/position each right ships in/i);
    expect(qualifier).toHaveTextContent(/not this organisation's current setting/i);
    // ...and points at where the live setting actually lives.
    expect(qualifier).toHaveTextContent(/Roles and permissions/i);
  });

  it("prints the registry's own counts, not a hand-typed headline", () => {
    const inventory = buildCapabilityInventory();

    renderWithProviders(<CapabilitiesCard />);

    expect(screen.getByText(new RegExp(literal(inventory.headline)))).toBeInTheDocument();
  });

  // The lead-in this card used to carry between the headline and the note read
  // "Most are checked in the database on write", which turned the note's three
  // named exceptions into a claim that the other 25 rights hold a database
  // policy. Six of them do not (capabilityEnforcement.test.ts recomputes the
  // split). The note states the whole split itself now, so the paragraph must
  // be the headline and the note and nothing between them.
  it("introduces the carve-out with nothing that contradicts it", () => {
    const inventory = buildCapabilityInventory();

    renderWithProviders(<CapabilitiesCard />);

    const summary = screen.getByText(new RegExp(literal(inventory.headline)));
    expect(summary.textContent).toBe(`${inventory.headline}. ${inventory.note}`);
  });
});
