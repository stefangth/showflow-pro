import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDerivedDraft } from "./useDerivedDraft";

// Plain renderHook, no provider wrapper: the hook owns nothing but local state,
// which is the point — it takes the server value as an argument rather than
// reaching for a query itself, so every caller keeps its own query and gate.

interface Form { name: string; hours: number }
const FALLBACK: Form = { name: "", hours: 0 };
const STORED: Form = { name: "Aurora", hours: 48 };

describe("useDerivedDraft", () => {
  it("returns the fallback while the server value has not arrived", () => {
    const { result } = renderHook(() => useDerivedDraft<Form>(undefined, FALLBACK));
    expect(result.current[0]).toBe(FALLBACK);
  });

  // The whole point of the hook. A seed-once effect returns the fallback on the
  // render where the data first exists and the real value only a commit later —
  // and a Save in between persists the fallback over the org's stored settings.
  it("returns the server value in the same render it first exists, with no effect", () => {
    const { result } = renderHook(() => useDerivedDraft<Form>(STORED, FALLBACK));
    expect(result.current[0]).toBe(STORED);
  });

  it("follows the server value while the draft is untouched", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form | undefined }) => useDerivedDraft<Form>(server, FALLBACK),
      { initialProps: { server: STORED as Form | undefined } },
    );
    expect(result.current[0]).toBe(STORED);

    const other: Form = { name: "Nord", hours: 24 };
    rerender({ server: other });
    expect(result.current[0]).toBe(other);
  });

  // The reason the seed-once ref existed: an unrelated refetch must not wipe
  // work in progress. Deriving has to keep that guarantee, not trade it away.
  it("pins the draft to an edit, so a later server change cannot clobber it", () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: Form | undefined }) => useDerivedDraft<Form>(server, FALLBACK),
      { initialProps: { server: STORED as Form | undefined } },
    );

    act(() => result.current[1]({ name: "Typed", hours: 12 }));
    expect(result.current[0]).toEqual({ name: "Typed", hours: 12 });

    rerender({ server: { name: "Refetched", hours: 99 } });
    expect(result.current[0]).toEqual({ name: "Typed", hours: 12 });
  });

  // Every adopting component calls setForm((f) => ({ ...f, x })) somewhere, so
  // the updater has to compose against the DERIVED value, not against the
  // untouched-marker null underneath it.
  it("composes a functional update against the derived value", () => {
    const { result } = renderHook(() => useDerivedDraft<Form>(STORED, FALLBACK));

    act(() => result.current[1]((prev) => ({ ...prev, hours: 72 })));
    expect(result.current[0]).toEqual({ name: "Aurora", hours: 72 });
  });

  it("composes consecutive functional updates in one tick", () => {
    const { result } = renderHook(() => useDerivedDraft<Form>(STORED, FALLBACK));

    act(() => {
      result.current[1]((prev) => ({ ...prev, hours: 72 }));
      result.current[1]((prev) => ({ ...prev, name: "Both" }));
    });
    expect(result.current[0]).toEqual({ name: "Both", hours: 72 });
  });

  it("reports whether the draft has been edited", () => {
    const { result } = renderHook(() => useDerivedDraft<Form>(STORED, FALLBACK));
    expect(result.current[2]).toBe(false);

    act(() => result.current[1]({ name: "Typed", hours: 1 }));
    expect(result.current[2]).toBe(true);
  });
});
