// Use the vitest-flavored entrypoint so the custom matchers (toBeInTheDocument,
// etc.) augment vitest's `expect` for the typechecker, not just at runtime.
import "@testing-library/jest-dom/vitest";

if (typeof window !== 'undefined') Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom ships no `AbortSignal.timeout` (every browser this app supports does).
// Without it the bounded font fetch in src/lib/hireOrders/pdf/pdfDeps.ts throws
// a TypeError before it ever calls fetch, which its own error handling then
// swallows — so the network branch under test would silently never run.
if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
    return controller.signal;
  };
}

// Radix UI primitives (Popover, Select, …) call these in jsdom, which doesn't
// implement them — without the stubs, opening a popover/menu throws in tests.
if (typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}
