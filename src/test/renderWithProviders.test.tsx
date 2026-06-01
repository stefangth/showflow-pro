import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders, renderHookWithProviders } from "./renderWithProviders";

describe("renderWithProviders", () => {
  it("renders children inside a QueryClientProvider", async () => {
    function Probe() {
      const q = useQuery({ queryKey: ["probe"], queryFn: async () => "ok" });
      return <div>{q.data ?? "loading"}</div>;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
  });
});

describe("renderHookWithProviders", () => {
  it("runs a hook that uses react-query", async () => {
    const { result } = renderHookWithProviders(() =>
      useQuery({ queryKey: ["h"], queryFn: async () => 42 }),
    );
    await waitFor(() => expect(result.current.data).toBe(42));
  });
});
