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
