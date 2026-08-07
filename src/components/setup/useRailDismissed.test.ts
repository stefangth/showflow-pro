import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRailDismissed } from "./useRailDismissed";

/**
 * Plan B Task 3: the setup rail's "Hide" action had no un-hide path anywhere
 * (the rail's `dismiss` writes a localStorage flag and nothing ever clears
 * it). `undismiss` is the missing other half.
 */
describe("useRailDismissed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts not dismissed when no flag is set", () => {
    const { result } = renderHook(() => useRailDismissed("hireOrderSetup", "org-1"));
    expect(result.current[0]).toBe(false);
  });

  it("dismiss sets the flag and undismiss clears it again", () => {
    const { result } = renderHook(() => useRailDismissed("hireOrderSetup", "org-1"));
    const [, dismiss, undismiss] = result.current;

    act(() => dismiss());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("showflow.hireOrderSetup.hidden.org-1")).toBe("true");

    act(() => undismiss());
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem("showflow.hireOrderSetup.hidden.org-1")).toBeNull();
  });

  it("keeps each namespace's dismissal independent", () => {
    const { result: hireOrders } = renderHook(() => useRailDismissed("hireOrderSetup", "org-1"));
    const { result: bookings } = renderHook(() => useRailDismissed("bookingSetup", "org-1"));

    act(() => hireOrders.current[1]());
    expect(hireOrders.current[0]).toBe(true);
    expect(bookings.current[0]).toBe(false);

    act(() => hireOrders.current[2]());
    expect(hireOrders.current[0]).toBe(false);
  });

  it("propagates undismiss to every other mounted reader of the same key", () => {
    const { result: a } = renderHook(() => useRailDismissed("hireOrderSetup", "org-1"));
    const { result: b } = renderHook(() => useRailDismissed("hireOrderSetup", "org-1"));

    act(() => a.current[1]());
    expect(b.current[0]).toBe(true);

    act(() => a.current[2]());
    expect(b.current[0]).toBe(false);
  });
});
