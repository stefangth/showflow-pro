import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  // Regression: tailwind-merge has no built-in knowledge of this project's
  // custom fontSize scale (theme.extend.fontSize in tailwind.config.ts:
  // eyebrow/caption/control/body/title-sm/title/display-sm/display). Without
  // registering those keys under the `font-size` class group, twMerge treats
  // `text-eyebrow`/`text-control`/etc. as members of the `text-*` COLOR
  // group, so pairing a custom size with a real text-color utility on one
  // element silently drops one of the two (last class wins). See
  // src/lib/utils.ts.
  it("keeps a custom font-size class alongside a text-color class", () => {
    expect(cn("text-eyebrow text-muted-foreground")).toBe("text-eyebrow text-muted-foreground");
    expect(cn("text-control text-foreground")).toBe("text-control text-foreground");
  });

  it("keeps a text-color class alongside a custom font-size class regardless of order", () => {
    expect(cn("text-muted-foreground text-eyebrow")).toBe("text-muted-foreground text-eyebrow");
  });

  it("still resolves a conflict between two custom font sizes on the same element", () => {
    // Both are font sizes, so they remain mutually exclusive: last wins.
    expect(cn("text-eyebrow text-control")).toBe("text-control");
  });

  it("still resolves a conflict between two text-color classes", () => {
    expect(cn("text-muted-foreground text-foreground")).toBe("text-foreground");
  });
});
