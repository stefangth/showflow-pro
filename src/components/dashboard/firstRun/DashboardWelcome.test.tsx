// src/components/dashboard/firstRun/DashboardWelcome.test.tsx
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardWelcome } from "./DashboardWelcome";
import { DashboardWelcomeCollapsed } from "./DashboardWelcomeCollapsed";

const welcome = {
  eyebrow: "Welcome", headline: "Finish setting up Halle Kollektiv",
  body: "A few decisions still shape how this workspace runs.", primaryLabel: "Start setup", secondaryLabel: "Later",
  progressLabel: "Set up · 1 of 4", progressFilled: 1, progressTotal: 4, progressHint: "About 15 minutes",
};

it("renders copy and fires primary/secondary", () => {
  const onPrimary = vi.fn(), onSecondary = vi.fn();
  render(<DashboardWelcome welcome={welcome} onPrimary={onPrimary} onSecondary={onSecondary} />);
  expect(screen.getByText(/Finish setting up Halle Kollektiv/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(onPrimary).toHaveBeenCalledOnce();
  expect(onSecondary).toHaveBeenCalledOnce();
});

it("collapsed chip reopens the rail", () => {
  const onOpen = vi.fn();
  render(<DashboardWelcomeCollapsed label="Set up in progress" hint="2 steps left" ctaLabel="Resume" onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(onOpen).toHaveBeenCalledOnce();
});
