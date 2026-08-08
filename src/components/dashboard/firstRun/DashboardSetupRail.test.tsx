import { it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardSetupRail } from "./DashboardSetupRail";
import type { ComposedStep } from "@/lib/dashboard/types";

// useCan is a thin hook; stub it as a settable mock so both the granted and
// denied capability paths can be exercised per test.
vi.mock("@/hooks/useCapabilities", () => ({ useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
});

const steps: ComposedStep[] = [
  { key: "flow", moduleKey: "booking_flow", title: "Booking flow", todoHint: "Pick a flow.", doneHint: "Chosen.", ctaLabel: "Choose flow", ctaRoute: "/settings", ctaCapability: "edit_booking_settings", done: true, block: null },
  { key: "slots", moduleKey: "booking_flow", title: "Slots per show", todoHint: "Set slots.", doneHint: "Set.", ctaLabel: "Set slots", ctaRoute: "/productions", ctaCapability: "edit_booking_settings", done: false, block: "filling" },
];

it("renders todo hint + CTA for an incomplete step", () => {
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up · 1 of 2" title="Get running" body="Body." complete={false} steps={steps} rules={[]} offFooters={["Hire orders is off."]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Set slots")).toBeInTheDocument();
  expect(screen.getByText("Hire orders is off.")).toBeInTheDocument();
});

it("renders rules read-only when complete", () => {
  render(<MemoryRouter><DashboardSetupRail eyebrow="How this org works" title="Rules" body="Body." complete steps={[]} rules={[{ title: "Offers with tiers", hint: "Tier 1 first." }]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Offers with tiers")).toBeInTheDocument();
  expect(screen.queryByText("Set slots")).not.toBeInTheDocument();
});

it("does not show a block chip on an already-done step", () => {
  const doneStep: ComposedStep[] = [
    { key: "ladder", moduleKey: "booking_flow", title: "Cast priorities", todoHint: "t", doneHint: "d", ctaLabel: "Open bookings", ctaRoute: "/bookings", ctaCapability: "edit_booking_settings", done: true, block: "filling" },
  ];
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up" title="Get running" body="Body." complete={false} steps={doneStep} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByText("Blocks filling")).not.toBeInTheDocument();
  expect(screen.queryByText("Blocks offers")).not.toBeInTheDocument();
});

it("shows a 'Blocks issuing' chip on a not-done hire-order step that blocks issuing", () => {
  const issuingStep: ComposedStep[] = [
    { key: "letterhead", moduleKey: "hire_orders", title: "Letterhead", todoHint: "Set it.", doneHint: "Set.", ctaLabel: "Set letterhead", ctaRoute: "/settings", ctaCapability: "edit_hire_order_settings", done: false, block: "issuing" },
  ];
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up" title="Get running" body="Body." complete={false} steps={issuingStep} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Blocks issuing")).toBeInTheDocument();
});

it("hides the CTA when the viewer lacks the step's capability", () => {
  vi.mocked(useCan).mockReturnValue(false);
  const gatedStep: ComposedStep[] = [
    { key: "slots", moduleKey: "booking_flow", title: "Slots per show", todoHint: "Set slots.", doneHint: "Set.", ctaLabel: "Set slots", ctaRoute: "/productions", ctaCapability: "edit_booking_settings", done: false, block: null },
  ];
  render(<MemoryRouter><DashboardSetupRail eyebrow="Org setup" title="What is outstanding" body="Body." complete={false} steps={gatedStep} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Slots per show")).toBeInTheDocument();
  expect(screen.queryByText("Set slots")).not.toBeInTheDocument();
});
