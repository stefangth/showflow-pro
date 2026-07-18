import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/data/hireOrders", () => ({
  fetchHireOrdersForDate: vi.fn(),
  fetchHireOrder: vi.fn(),
  fetchMyHireOrders: vi.fn(),
  fetchHireOrders: vi.fn(),
  invokeHireOrderAction: vi.fn(),
  updateHireOrderStatus: vi.fn(),
  updateHireOrderDraft: vi.fn(),
}));

import { toast } from "sonner";
import { useMyArtist } from "@/hooks/useMyArtist";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  fetchHireOrders,
  invokeHireOrderAction,
  updateHireOrderStatus,
  updateHireOrderDraft,
} from "@/data/hireOrders";
import {
  useHireOrdersForDate,
  useHireOrder,
  useMyHireOrders,
  useHireOrders,
  useHireOrderAction,
  useMarkCountersigned,
  useVoidHireOrder,
  useUpdateHireOrderDraft,
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

describe("useHireOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches for a given org and filters", async () => {
    vi.mocked(fetchHireOrders).mockResolvedValue([{ id: "ho-1" }] as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrders("org-1", { status: ["draft"] }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ho-1" }]);
    expect(fetchHireOrders).toHaveBeenCalledWith(expect.anything(), "org-1", { status: ["draft"] });
  });

  it("defaults filters to {} when omitted", async () => {
    vi.mocked(fetchHireOrders).mockResolvedValue([] as never);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrders("org-1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchHireOrders).toHaveBeenCalledWith(expect.anything(), "org-1", {});
  });

  it("stays disabled without an orgId", () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrders(null), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchHireOrders).not.toHaveBeenCalled();
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

  it("toasts an error with the skip reason when draft produces only skips", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ created: [], skipped: [{ booking_id: "b1", reason: "exists" }] });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "draft", org_id: "org-1" });
    });

    expect(toast.error).toHaveBeenCalledWith("No hire orders drafted: already ordered");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("toasts success AND a warning when a draft creates some but skips others", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      created: ["ho-1"],
      skipped: [
        { booking_id: "b1", reason: "exists" },
        { booking_id: "b2", reason: "exists" },
      ],
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "draft", org_id: "org-1", show_date_id: "d1" });
    });

    expect(toast.success).toHaveBeenCalledWith("Drafted 1 hire order");
    // Deduped, number-agnostic reason copy: two `exists` skips collapse to one phrase
    // that reads correctly after a plural count ("2 bookings skipped: already ordered").
    expect(toast.warning).toHaveBeenCalledWith("2 bookings skipped: already ordered");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts an info message when draft has nothing to do (zero created, zero skipped)", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ created: [], skipped: [] });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "draft", org_id: "org-1", show_date_id: "d1" });
    });

    expect(toast.info).toHaveBeenCalledWith("No bookings need hire orders");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts issued and failed counts separately for issue, with friendly copy for missing_terms", async () => {
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
    expect(toast.error).toHaveBeenCalledWith(
      "1 hire order failed to issue: Add terms in Settings before issuing",
    );
  });

  it("maps multiple distinct failure codes to friendly copy, deduped and joined", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: [],
      failed: [
        { order_id: "ho-1", issues: ["missing_fee"] },
        { order_id: "ho-2", issues: ["missing_fee", "missing_recipient_email"] },
        { order_id: "ho-3", issues: ["some_unmapped_code"] },
      ],
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "issue", org_id: "org-1", order_ids: ["ho-1", "ho-2", "ho-3"] });
    });

    expect(toast.error).toHaveBeenCalledWith(
      "3 hire orders failed to issue: Set an engagement fee before issuing, Add a recipient email before issuing, some_unmapped_code",
    );
  });

  it("surfaces documenso_failed as a warning alongside a successful issue, not the failed-to-issue error", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: ["ho-1"],
      failed: [{ order_id: "ho-1", issues: ["documenso_failed"] }],
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "issue", org_id: "org-1", order_ids: ["ho-1"] });
    });

    expect(toast.success).toHaveBeenCalledWith("Issued 1 hire order");
    expect(toast.warning).toHaveBeenCalledWith("1 hire order issued, but countersign delivery failed");
    // The order counts toward "Issued 1" only -- it must not also read as a
    // failure, which would contradict the success toast right above it.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps a genuine issue failure separate from a documenso_failed warning when both occur in the same batch", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: ["ho-1"],
      failed: [
        { order_id: "ho-1", issues: ["documenso_failed"] },
        { order_id: "ho-2", issues: ["missing_terms"] },
      ],
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useHireOrderAction(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ action: "issue", org_id: "org-1", order_ids: ["ho-1", "ho-2"] });
    });

    expect(toast.success).toHaveBeenCalledWith("Issued 1 hire order");
    // Only the genuinely-failed order (ho-2) counts toward "failed to issue" --
    // the documenso_failed order (ho-1) does not inflate this count.
    expect(toast.error).toHaveBeenCalledWith(
      "1 hire order failed to issue: Add terms in Settings before issuing",
    );
    expect(toast.warning).toHaveBeenCalledWith("1 hire order issued, but countersign delivery failed");
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

describe("useUpdateHireOrderDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateHireOrderDraft with id + patch, invalidates hire-orders, and stays silent on success", async () => {
    vi.mocked(updateHireOrderDraft).mockResolvedValue(undefined);
    const { Wrapper, qc } = wrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateHireOrderDraft(), { wrapper: Wrapper });

    const patch = { data: { fee: { value: 100, source: "manual" as const } } };
    await act(async () => {
      await result.current.mutateAsync({ id: "ho-1", patch });
    });

    expect(updateHireOrderDraft).toHaveBeenCalledWith(expect.anything(), "ho-1", patch);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["hire-orders"] });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts an error on failure", async () => {
    vi.mocked(updateHireOrderDraft).mockRejectedValue(new Error("stale"));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateHireOrderDraft(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: "ho-1", patch: { data: {} } })).rejects.toThrow();
    });

    expect(toast.error).toHaveBeenCalledWith("stale");
  });
});

describe("useVoidHireOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateHireOrderStatus with void, toasts, and invalidates hire-orders", async () => {
    vi.mocked(updateHireOrderStatus).mockResolvedValue(undefined);
    const { Wrapper, qc } = wrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useVoidHireOrder(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync("ho-1");
    });

    expect(updateHireOrderStatus).toHaveBeenCalledWith(expect.anything(), "ho-1", "void");
    expect(toast.success).toHaveBeenCalledWith("Hire order voided");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["hire-orders"] });
  });

  it("toasts an error on failure", async () => {
    vi.mocked(updateHireOrderStatus).mockRejectedValue(new Error("stale"));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useVoidHireOrder(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("ho-1")).rejects.toThrow();
    });

    expect(toast.error).toHaveBeenCalledWith("stale");
  });
});
