import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapStep } from "./MapStep";

describe("MapStep", () => {
  it("does not render a Select for the inert 'sessions' field", () => {
    render(<MapStep headers={["Artist", "Fee"]} mapping={{}} onMappingChange={vi.fn()} />);

    // Every other field key does get a combobox…
    expect(screen.getByRole("combobox", { name: /artist name column/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^fee column$/i })).toBeInTheDocument();
    // …but "sessions" has no sheet-column convention (guessOrderMapping/
    // buildOrderRows never read it), so it must not present a control at all.
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /sessions column/i })).not.toBeInTheDocument();
  });
});
