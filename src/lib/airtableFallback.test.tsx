import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { airtableFallbackMessage } from "./airtableFallback";

describe("airtableFallbackMessage", () => {
  it("renders the no-scope message with the scope name in a <code> token", () => {
    const { container } = render(<>{airtableFallbackMessage("no-scope")}</>);
    expect(container.querySelector("code")?.textContent).toBe("schema.bases:read");
    expect(container.textContent).toMatch(/lacks the/i);
  });
  it("does not blame the scope for a per-base permission failure", () => {
    const m = airtableFallbackMessage("per-base");
    expect(m).toMatch(/this specific base/i);
    expect(m).not.toMatch(/schema\.bases:read/);
  });
  it("describes a transient error without blaming the key", () => {
    const m = airtableFallbackMessage("error");
    expect(m).toMatch(/Couldn't reach Airtable/i);
    expect(m).not.toMatch(/schema\.bases:read/);
  });
});
