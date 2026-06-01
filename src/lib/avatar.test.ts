import { describe, it, expect } from "vitest";
import { getAvatarTone } from "./avatar";

describe("getAvatarTone", () => {
  it("is deterministic for the same seed", () => {
    expect(getAvatarTone("Alice")).toEqual(getAvatarTone("Alice"));
  });

  it("always returns a palette entry with bg + text hex", () => {
    for (const seed of ["", "a", "Alice", "a very long name with spaces", "🎭"]) {
      const tone = getAvatarTone(seed);
      expect(tone.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(tone.text).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("handles the empty string without throwing", () => {
    expect(() => getAvatarTone("")).not.toThrow();
  });

  it("distributes different seeds across more than one tone", () => {
    const tones = new Set(
      ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"].map((s) => getAvatarTone(s).bg),
    );
    expect(tones.size).toBeGreaterThan(1);
  });
});
