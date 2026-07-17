import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/data/hireOrders", () => ({
  fetchHireOrdersForDate: vi.fn(),
  fetchHireOrder: vi.fn(),
  fetchMyHireOrders: vi.fn(),
  invokeHireOrderAction: vi.fn(),
  updateHireOrderStatus: vi.fn(),
}));

import { toast } from "sonner";
import { useMyArtist } from "@/hooks/useMyArtist";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  invokeHireOrderAction,
  updateHireOrderStatus,
} from "@/data/hireOrders";
import {
  useHireOrdersForDate,
  useHireOrder,
  useMyHireOrders,
  useHireOrderAction,
  useMarkCountersigned,
} from "./useHireOrders";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { Wrapper, qc };
}

describe("useHireOrdersForDate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches for a given show date id", async () => {
    vi.mocked(fetchHireOrdersForDate).mockResolvedValue([{ id: "ho-1" }] as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrdersForDate("d1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ho-1" }]);
    expect(fetchHireOrdersForDate).toHaveBeenCalledWith(expect.anything(), "d1");
  });

  it("stays disabled without a showDateId", () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrdersForDate(undefined), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchHireOrdersForDate).not.toHaveBeenCalled();
  });
});

describe("useHireOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches a single order by id", async () => {
    vi.mocked(fetchHireOrder).mockResolvedValue({ id: "ho-1" } as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrder("ho-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchHireOrder).toHaveBeenCalledWith(expect.anything(), "ho-1");
  });

  it("stays disabled without an id", () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrder(undefined), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useMyHireOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives artistIds from useMyArtist and fetches", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
    vi.mocked(fetchMyHireOrders).mockResolvedValue([{ id: "ho-1" }] as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useMyHireOrders(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMyHireOrders).toHaveBeenCalledWith(expect.anything(), ["artist-1"]);
  });

  it("stays disabled when there is no linked artist", () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useMyHireOrders(), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMyHireOrders).not.toHaveBeenCalled();
  });
});

describe("useHireOrderAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toasts a success summary when draft creates orders, and invalidates hire-orders", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ created: ["ho-1", "ho-2"], skipped: [] });
    const { Wrapper, qc } = wrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "draft", org_id: "org-1", show_date_id: "d1" });
    });

    expect(invokeHireOrderAction).toHaveBeenCalledWith(expect.anything(), { action: "draft", org_id: "org-1", show_date_id: "d1" });
    expect(toast.success).toHaveBeenCalledWith("Drafted 2 hire orders");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["hire-orders"] });
  });

  it("toasts an error when draft produces only skips", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ created: [], skipped: [{ booking_id: "b1", reason: "exists" }] });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "draft", org_id: "org-1" });
    });

    expect(toast.error).toHaveBeenCalledWith("No hire orders drafted");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts issued and failed counts separately for issue", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: ["ho-1"],
      failed: [{ order_id: "ho-2", issues: ["missing_terms"] }],
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "issue", org_id: "org-1", order_ids: ["ho-1", "ho-2"] });
    });

    expect(toast.success).toHaveBeenCalledWith("Issued 1 hire order");
    expect(toast.error).toHaveBeenCalledWith("1 hire order failed to issue");
  });

  it("stays silent (no toast) for preview", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ pdf_base64: "abc" });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "preview", org_id: "org-1", order_id: "ho-1" });
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts an error on failure", async () => {
    vi.mocked(invokeHireOrderAction).mockRejectedValue(new Error("network down"));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ action: "draft", org_id: "org-1" })).rejects.toThrow();
    });

    expect(toast.error).toHaveBeenCalledWith("network down");
  });
});

describe("useMarkCountersigned", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateHireOrderStatus with countersigned, toasts, and invalidates hire-orders", async () => {
    vi.mocked(updateHireOrderStatus).mockResolvedValue(undefined);
    const { Wrapper, qc } = wrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useMarkCountersigned(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync("ho-1");
    });

    expect(updateHireOrderStatus).toHaveBeenCalledWith(expect.anything(), "ho-1", "countersigned");
    expect(toast.success).toHaveBeenCalledWith("Hire order marked as countersigned");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["hire-orders"] });
  });

  it("toasts an error on failure", async () => {
    vi.mocked(updateHireOrderStatus).mockRejectedValue(new Error("stale"));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useMarkCountersigned(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("ho-1")).rejects.toThrow();
    });

    expect(toast.error).toHaveBeenCalledWith("stale");
  });
});
