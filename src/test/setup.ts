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

// This jsdom runs on an opaque origin, which leaves `localStorage` undefined rather
// than merely empty. Components that read it during render (EditorProvider's initial
// editor-mode state, AuthContext's remembered org) would throw on mount. An in-memory
// stand-in keeps them testable; each file clears what it sets.
// Installed unconditionally rather than behind a `!window.localStorage` probe: vitest
// puts jsdom's globals on the Node global object, so *reading* the property at all hits
// Node's own experimental getter and prints "localStorage is not available because
// --localstorage-file was not provided" once per worker. Defining over it is silent, and
// a fresh in-memory Storage per worker is what we want for isolation anyway.
if (typeof window !== "undefined") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: memoryStorage, writable: true, configurable: true });
}

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
