import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandWordmark } from "./BrandWordmark";
import { APP_META, CHANGELOG_URL } from "@/config/app.config";

describe("BrandWordmark", () => {
  it("renders the version pill as a link to the public changelog", () => {
    render(<BrandWordmark />);
    const pill = screen.getByRole("link", { name: /changelog/i });
    expect(pill.getAttribute("href")).toBe(CHANGELOG_URL);
    expect(pill.textContent).toContain(APP_META.VERSION);
  });

  it("opens the changelog in a new tab without handing it a window opener", () => {
    render(<BrandWordmark />);
    const pill = screen.getByRole("link", { name: /changelog/i });
    expect(pill.getAttribute("target")).toBe("_blank");
    expect(pill.getAttribute("rel")).toContain("noopener");
  });
});
