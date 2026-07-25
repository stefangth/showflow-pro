import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateDocumentPane } from "./TemplateDocumentPane";
import { sampleRenderInput } from "./sampleDocument";
import { resolveHireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import { resolveHireOrderTheme } from "@/lib/hireOrders/pdf/pdfTheme";
import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";

// One of the few justified `vi.mock` cases in this repo: the module under
// test is not a Supabase client but a heavy PDF renderer, and these tests are
// about the pane's OWN behaviour (debounce, previous-frame persistence,
// out-of-order resolution, object-URL lifecycle, error surfacing) - not about
// what the renderer produces. The renderer itself has its own Deno tests.
vi.mock("@/lib/hireOrders/pdf/render", () => ({
  renderHireOrderPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

import { renderHireOrderPdf } from "@/lib/hireOrders/pdf/render";

const DEBOUNCE_MS = 250;

const baseInput = sampleRenderInput(resolveHireOrderCopy(), resolveHireOrderTheme());

/** A distinct RenderInput per "keystroke" - same shape as baseInput, just a
 *  different notes value, so identity (and therefore the effect dependency)
 *  changes on every call like a real edit would. */
function withNotes(notes: string): RenderInput {
  return { ...baseInput, data: { ...baseInput.data, notes: { value: notes, source: "manual" } } };
}

/** A promise this test can resolve/reject from the outside, on demand - lets
 *  us control which of two concurrent renders finishes first, independent of
 *  real elapsed time. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TemplateDocumentPane", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let urlCounter: number;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let revokeObjectURLMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    urlCounter = 0;
    createObjectURLMock = vi.fn(() => `blob:mock-${++urlCounter}`);
    revokeObjectURLMock = vi.fn();
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;
  });

  afterEach(() => {
    // Unmount every rendered tree (RTL's own auto-cleanup afterEach is
    // registered at file scope, which runs AFTER this describe-scoped
    // afterEach - restoring the URL globals first would make the pane's
    // unmount-cleanup effect blow up when that later cleanup() runs).
    cleanup();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the document into an iframe", async () => {
    render(<TemplateDocumentPane input={baseInput} />);
    await waitFor(() =>
      expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", expect.stringContaining("blob:")),
    );
  });

  it("surfaces a render failure instead of showing a blank frame", async () => {
    vi.mocked(renderHireOrderPdf).mockRejectedValueOnce(new Error("font blew up"));
    render(<TemplateDocumentPane input={baseInput} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("font blew up"));
  });

  it("debounces rapid input changes into a single render call for the final value", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TemplateDocumentPane input={withNotes("a")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender(<TemplateDocumentPane input={withNotes("ab")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender(<TemplateDocumentPane input={withNotes("abc")} />);

    // Still well inside the 250ms window since the last edit - no call yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(renderHireOrderPdf).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(renderHireOrderPdf).toHaveBeenCalledTimes(1);
    expect(renderHireOrderPdf).toHaveBeenCalledWith(withNotes("abc"));
  });

  it("keeps the previous frame visible while a new render is in flight", async () => {
    vi.useFakeTimers();
    const first = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(first.promise);

    const { rerender } = render(<TemplateDocumentPane input={withNotes("a")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(renderHireOrderPdf).toHaveBeenCalledTimes(1);
    // Nothing has resolved yet - no frame at all, but definitely not stuck
    // waiting forever without ever having rendered once.
    expect(screen.queryByTitle("Hire order preview")).not.toBeInTheDocument();

    await act(async () => {
      first.resolve(new Uint8Array([1]));
      await first.promise;
    });
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");

    const second = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(second.promise);
    rerender(<TemplateDocumentPane input={withNotes("ab")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(renderHireOrderPdf).toHaveBeenCalledTimes(2);

    // The second render is in flight and unresolved - the OLD frame must
    // still be showing, not a blank pane.
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");

    await act(async () => {
      second.resolve(new Uint8Array([2]));
      await second.promise;
    });
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-2");
  });

  it("does not let a stale, earlier-started render clobber a later one that resolves first", async () => {
    // The out-of-order guard. Two renders both start (in start order), then
    // resolve in the OPPOSITE order: the later-started one finishes first.
    // The earlier-started one arriving afterward must be a no-op.
    vi.useFakeTimers();
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(<TemplateDocumentPane input={withNotes("a")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    }); // render #1 (earlier-started) is now in flight, awaiting `first`

    rerender(<TemplateDocumentPane input={withNotes("ab")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    }); // render #2 (later-started) is now in flight, awaiting `second`

    expect(renderHireOrderPdf).toHaveBeenCalledTimes(2);

    // Resolve the LATER-started render (#2) FIRST.
    await act(async () => {
      second.resolve(new Uint8Array([2]));
      await second.promise;
    });
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);

    // Now resolve the EARLIER-started render (#1), which is stale by the
    // time it lands. It must not overwrite #2's result.
    await act(async () => {
      first.resolve(new Uint8Array([1]));
      await first.promise;
    });
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");
    // The stale render must never even reach URL.createObjectURL - only one
    // object URL should exist for the whole test.
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale render's failure surface as an error over a newer success", async () => {
    vi.useFakeTimers();
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(<TemplateDocumentPane input={withNotes("a")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    rerender(<TemplateDocumentPane input={withNotes("ab")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    // The later-started render (#2) succeeds first.
    await act(async () => {
      second.resolve(new Uint8Array([2]));
      await second.promise;
    });
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");

    // The earlier-started render (#1) then rejects. Its failure is stale and
    // must not blank out or error-banner the already-current, successful frame.
    await act(async () => {
      first.reject(new Error("stale font failure"));
      await first.promise.catch(() => {});
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTitle("Hire order preview")).toHaveAttribute("src", "blob:mock-1");
  });

  it("revokes the previous object URL when a newer render replaces it", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TemplateDocumentPane input={withNotes("a")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    rerender(<TemplateDocumentPane input={withNotes("ab")} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-1");
  });

  it("revokes the current object URL on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<TemplateDocumentPane input={baseInput} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-1");
  });

  it("does not call revokeObjectURL on unmount when no render has resolved yet", async () => {
    vi.useFakeTimers();
    const pending = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(pending.promise);
    const { unmount } = render(<TemplateDocumentPane input={baseInput} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(createObjectURLMock).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });

  it("does not leak an object URL when unmounted while a render is in flight", async () => {
    // The debounce timer has already fired (renderHireOrderPdf is running),
    // but nothing has resolved yet - then the component unmounts. Unlike the
    // "no render has resolved yet" test above, this one resolves the pending
    // promise AFTER unmount: a naive implementation only clears the debounce
    // timer on unmount (a no-op once it has already fired) and never
    // invalidates the in-flight render's run token, so the late resolution
    // still passes its stale-check, creates a fresh object URL, and that URL
    // is created after the unmount cleanup already ran - so nothing ever
    // revokes it. That is the leak: one blob URL per unmounted-mid-render
    // edit, for the lifetime of the tab.
    vi.useFakeTimers();
    const pending = deferred<Uint8Array>();
    vi.mocked(renderHireOrderPdf).mockReturnValueOnce(pending.promise);
    const { unmount } = render(<TemplateDocumentPane input={baseInput} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(renderHireOrderPdf).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURLMock).not.toHaveBeenCalled(); // nothing to revoke yet

    // The in-flight render resolves AFTER unmount.
    await act(async () => {
      pending.resolve(new Uint8Array([9]));
      await pending.promise;
    });
    // The late resolution must be treated as stale: no URL created (and so
    // nothing left dangling for revokeObjectURL to ever have to clean up).
    expect(createObjectURLMock).not.toHaveBeenCalled();
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
  });
});
