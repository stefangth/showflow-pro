import { describe, it, expect } from "vitest";
import { linesFromText, serializeLines, mergeLetterhead } from "./letterhead";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";

describe("linesFromText", () => {
  it("trims trailing whitespace per line and drops leading and trailing blanks", () => {
    expect(linesFromText("\nStreet 1  \n\n10999 Berlin \n\n")).toEqual(["Street 1", "", "10999 Berlin"]);
  });
  it("round-trips through serializeLines", () => {
    expect(linesFromText(serializeLines(["A", "B"]))).toEqual(["A", "B"]);
  });
});

describe("mergeLetterhead", () => {
  const stored: Letterhead = {
    legal_name: "Aurora Productions GmbH",
    address_lines: ["Street 1"],
    registration_line: "HRB 1",
    agent_name: "Katrin Behrens",
    agent_email: "katrin@example.com",
    agent_signature_path: "org-1/agent-signature.png",
  };

  // The whole point of this module: the rail edits three fields and must not erase the
  // three it never renders.
  it("preserves agent fields the compact form never renders", () => {
    const next = mergeLetterhead(stored, {
      legal_name: "Aurora Productions AG",
      address_lines: ["Street 2"],
      registration_line: "HRB 2",
    });
    expect(next.agent_name).toBe("Katrin Behrens");
    expect(next.agent_email).toBe("katrin@example.com");
    expect(next.agent_signature_path).toBe("org-1/agent-signature.png");
    expect(next.legal_name).toBe("Aurora Productions AG");
    expect(next.address_lines).toEqual(["Street 2"]);
  });

  it("allows an explicit clear of an agent field", () => {
    expect(mergeLetterhead(stored, { agent_signature_path: null }).agent_signature_path).toBeNull();
  });

  it("falls back to the blank default when nothing is stored", () => {
    const next = mergeLetterhead(null, { legal_name: "New GmbH" });
    expect(next.legal_name).toBe("New GmbH");
    expect(next.address_lines).toEqual([]);
    expect(next.agent_signature_path).toBeNull();
  });
});
