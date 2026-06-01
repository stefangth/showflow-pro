import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "./queryClient";

describe("createTestQueryClient", () => {
  it("returns a QueryClient with retries disabled", () => {
    const qc = createTestQueryClient();
    expect(qc).toBeInstanceOf(QueryClient);
    expect(qc.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("returns a fresh instance each call", () => {
    expect(createTestQueryClient()).not.toBe(createTestQueryClient());
  });
});
