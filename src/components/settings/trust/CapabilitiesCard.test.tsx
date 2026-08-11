import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { buildCapabilityInventory } from "@/lib/trust/capabilityInventory";
import { CapabilitiesCard } from "./CapabilitiesCard";

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

    expect(screen.getByText(new RegExp(inventory.headline.replace(/\./g, "\\.")))).toBeInTheDocument();
  });
});
