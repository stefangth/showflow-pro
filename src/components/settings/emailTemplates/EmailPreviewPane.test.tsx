import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { EmailPreviewPane } from "./EmailPreviewPane";

const DEBOUNCE_MS = 250;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seedClient() {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase({
    "fn:preview-transactional-email": {
      data: { templates: [{ html: "<h1>Initial preview</h1>" }] },
      error: null,
    },
  }));
}

function props(subject: string, highlightRole = "heading") {
  return {
    templateKey: "org-invitation",
    copyOverride: { "org-invitation.subject": subject },
    themeOverride: { roles: { heading: { weight: 700 } } },
    highlightRole,
  };
}

describe("EmailPreviewPane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedClient();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces rapid drafts into one request containing every override", async () => {
    const { rerender } = render(<EmailPreviewPane {...props("A")} />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    rerender(<EmailPreviewPane {...props("AB")} />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    rerender(<EmailPreviewPane {...props("ABC", "body")} />);

    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect((client.calls as unknown[]).filter((call) => (call as { table: string }).table === "fn:preview-transactional-email")).toHaveLength(0);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(client.calls).toContainEqual({
      table: "fn:preview-transactional-email",
      method: "invoke",
      args: [{
        templateName: "org-invitation",
        copyOverride: { "org-invitation.subject": "ABC" },
        themeOverride: { roles: { heading: { weight: 700 } } },
        highlightRole: "body",
      }],
    });
  });

  it("keeps the previous frame while the next request is unresolved", async () => {
    const { rerender } = render(<EmailPreviewPane {...props("A")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Initial preview</h1>");

    const next = deferred<{ data: { templates: { html: string }[] }; error: null }>();
    const invoke = vi.fn(() => next.promise);
    (client.functions as { invoke: typeof invoke }).invoke = invoke;
    rerender(<EmailPreviewPane {...props("AB")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));

    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Initial preview</h1>");
    await act(async () => {
      next.resolve({ data: { templates: [{ html: "<h1>Next preview</h1>" }] }, error: null });
      await next.promise;
    });
    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Next preview</h1>");
  });

  it("lets the latest request win when responses resolve out of order", async () => {
    const first = deferred<{ data: { templates: { html: string }[] }; error: null }>();
    const second = deferred<{ data: { templates: { html: string }[] }; error: null }>();
    const invoke = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    (client.functions as { invoke: typeof invoke }).invoke = invoke;

    const { rerender } = render(<EmailPreviewPane {...props("A")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    rerender(<EmailPreviewPane {...props("AB")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));

    await act(async () => {
      second.resolve({ data: { templates: [{ html: "<h1>Latest</h1>" }] }, error: null });
      await second.promise;
    });
    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Latest</h1>");

    await act(async () => {
      first.resolve({ data: { templates: [{ html: "<h1>Stale</h1>" }] }, error: null });
      await first.promise;
    });
    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Latest</h1>");
  });

  it("ignores a stale error after a newer success", async () => {
    const first = deferred<{ data: null; error: Error }>();
    const second = deferred<{ data: { templates: { html: string }[] }; error: null }>();
    const invoke = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    (client.functions as { invoke: typeof invoke }).invoke = invoke;

    const { rerender } = render(<EmailPreviewPane {...props("A")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    rerender(<EmailPreviewPane {...props("AB")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    await act(async () => {
      second.resolve({ data: { templates: [{ html: "<h1>Latest</h1>" }] }, error: null });
      await second.promise;
    });
    await act(async () => {
      first.resolve({ data: null, error: new Error("stale failure") });
      await first.promise;
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Latest</h1>");
  });

  it("does not update after unmount and cancels a queued request", async () => {
    const pending = deferred<{ data: { templates: { html: string }[] }; error: null }>();
    const invoke = vi.fn(() => pending.promise);
    (client.functions as { invoke: typeof invoke }).invoke = invoke;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const queued = render(<EmailPreviewPane {...props("queued")} />);
    queued.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    expect(invoke).not.toHaveBeenCalled();

    const inFlight = render(<EmailPreviewPane {...props("in flight")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
    expect(invoke).toHaveBeenCalledTimes(1);
    inFlight.unmount();
    await act(async () => {
      pending.resolve({ data: { templates: [{ html: "<h1>Late</h1>" }] }, error: null });
      await pending.promise;
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders the HTML in a titled sandboxed iframe", async () => {
    render(<EmailPreviewPane {...props("A")} />);
    await act(async () => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));

    const frame = screen.getByTitle("Email template preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", "<h1>Initial preview</h1>");
  });
});
