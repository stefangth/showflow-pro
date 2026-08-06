import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ACTIVE_ORG_HEADER,
  setActiveOrg,
  getActiveOrg,
  createActiveOrgFetch,
} from "./activeOrg";

const ORG = "20751f12-a0c2-4154-a348-7e76452ddd6d";

/** Capture what the wrapper hands to the underlying fetch. */
function spyFetch() {
  const calls: { url: unknown; headers: Headers; init: RequestInit | undefined }[] = [];
  const base = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers), init });
    return new Response("{}", { status: 200 });
  });
  return { base: base as unknown as typeof fetch, calls };
}

describe("active-org request header", () => {
  beforeEach(() => setActiveOrg(null));

  it("omits the header when no org is active", async () => {
    const { base, calls } = spyFetch();
    await createActiveOrgFetch(base)("https://example.test/rest/v1/casts");
    expect(calls[0].headers.has(ACTIVE_ORG_HEADER)).toBe(false);
  });

  it("sends the active org once set", async () => {
    const { base, calls } = spyFetch();
    setActiveOrg(ORG);
    await createActiveOrgFetch(base)("https://example.test/rest/v1/casts");
    expect(calls[0].headers.get(ACTIVE_ORG_HEADER)).toBe(ORG);
  });

  it("reads the org at request time, not at wrapper-creation time", async () => {
    // The client is created once at import; the org changes later, on every switch.
    const { base, calls } = spyFetch();
    const wrapped = createActiveOrgFetch(base);
    setActiveOrg(ORG);
    await wrapped("https://example.test/rest/v1/casts");
    setActiveOrg("00000000-0000-0000-0000-00000000b007");
    await wrapped("https://example.test/rest/v1/casts");
    expect(calls[0].headers.get(ACTIVE_ORG_HEADER)).toBe(ORG);
    expect(calls[1].headers.get(ACTIVE_ORG_HEADER)).toBe("00000000-0000-0000-0000-00000000b007");
  });

  it("drops the header again when the org is cleared on sign-out", async () => {
    const { base, calls } = spyFetch();
    const wrapped = createActiveOrgFetch(base);
    setActiveOrg(ORG);
    setActiveOrg(null);
    await wrapped("https://example.test/rest/v1/casts");
    expect(calls[0].headers.has(ACTIVE_ORG_HEADER)).toBe(false);
  });

  it("preserves the caller's own headers and init", async () => {
    const { base, calls } = spyFetch();
    setActiveOrg(ORG);
    await createActiveOrgFetch(base)("https://example.test/rest/v1/casts", {
      method: "POST",
      headers: { apikey: "anon-key", Authorization: "Bearer jwt" },
    });
    expect(calls[0].headers.get("apikey")).toBe("anon-key");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer jwt");
    expect(calls[0].headers.get(ACTIVE_ORG_HEADER)).toBe(ORG);
    expect(calls[0].init?.method).toBe("POST");
  });

  it("ignores a blank org id rather than sending an empty header", async () => {
    const { base, calls } = spyFetch();
    setActiveOrg("   ");
    await createActiveOrgFetch(base)("https://example.test/rest/v1/casts");
    expect(calls[0].headers.has(ACTIVE_ORG_HEADER)).toBe(false);
    expect(getActiveOrg()).toBeNull();
  });
});
