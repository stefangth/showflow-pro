import { describe, it, expect } from "vitest";
import { readEdgeError } from "./edgeErrors";

const httpError = (body: unknown, status = 403) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status }),
  });

describe("readEdgeError", () => {
  it("maps feature_disabled to copy naming the module and where to enable it", async () => {
    expect(await readEdgeError(httpError({ error: "feature_disabled" })))
      .toBe("This module is off for this organization. Enable it in Platform, Organizations.");
  });

  it("maps a known validation code to its own copy", async () => {
    expect(await readEdgeError(httpError({ error: "invalid_fee" }, 400)))
      .toBe("The fee must be a number.");
  });

  it("falls back to the raw code when it is unmapped", async () => {
    expect(await readEdgeError(httpError({ error: "some_new_code" }))).toBe("some_new_code");
  });

  it("falls back to the error message when the body is not JSON", async () => {
    const err = Object.assign(new Error("boom"), {
      context: new Response("<html>502</html>", { status: 502 }),
    });
    expect(await readEdgeError(err)).toBe("boom");
  });

  it("passes a plain Error through unchanged", async () => {
    expect(await readEdgeError(new Error("network down"))).toBe("network down");
  });

  it("handles a non-Error value", async () => {
    expect(await readEdgeError("nope")).toBe("Something went wrong.");
  });
});
