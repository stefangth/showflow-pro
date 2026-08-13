// src/components/dashboard/firstRun/firstRunLeaves.test.tsx
import { it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FirstRunHeaderCard } from "./FirstRunHeaderCard";
import { OffFooters } from "./OffFooters";
import { FirstRunSideCard } from "./FirstRunSideCard";
import { FirstRunQueue } from "./FirstRunQueue";
import type { SideLink, QueueRow } from "@/lib/dashboard/stageChain.types";

it("FirstRunHeaderCard renders copy, ticks, module states, fires onGhost, and hides ticks when hasSteps is false", () => {
  const onGhost = vi.fn();
  const { unmount } = render(
    <FirstRunHeaderCard
      eyebrow="Halle Kollektiv · first run"
      headline="34 dates landed. Four of them can be offered tonight."
      body="Stage 01 is running."
      ghost="Change the flow in Settings"
      hint="Tier 1 goes out at 09:00h (Berlin, Germany)"
      progressLabel="Set up · 2 of 7"
      progressHint="The steps left sit in the stage they hold up."
      hasSteps
      ticks={[true, true, false, false, false, false, false]}
      modules={[
        { label: "Booking engine", on: true },
        { label: "Hire orders", on: false },
      ]}
      onGhost={onGhost}
    />,
  );

  expect(screen.getByText("Halle Kollektiv · first run")).toBeInTheDocument();
  expect(screen.getByText("34 dates landed. Four of them can be offered tonight.")).toBeInTheDocument();

  const ticks = screen.getAllByTestId("first-run-tick");
  expect(ticks).toHaveLength(7);
  expect(ticks.filter((t) => t.getAttribute("data-filled") === "true")).toHaveLength(2);

  expect(within(screen.getByTestId("first-run-module-Booking engine")).getByText("On")).toBeInTheDocument();
  expect(within(screen.getByTestId("first-run-module-Hire orders")).getByText("Off")).toBeInTheDocument();

  screen.getByRole("button", { name: "Change the flow in Settings" }).click();
  expect(onGhost).toHaveBeenCalledOnce();
  unmount();

  render(
    <FirstRunHeaderCard
      eyebrow="e"
      headline="h"
      body="b"
      ghost="g"
      hint="hint"
      progressLabel="Nothing to set up"
      progressHint="Steps appear the moment a module is switched on."
      hasSteps={false}
      ticks={[]}
      modules={[{ label: "Booking engine", on: false }]}
    />,
  );
  expect(screen.queryByTestId("first-run-tick")).not.toBeInTheDocument();
});

it("OffFooters renders every footer line, and renders nothing for an empty list", () => {
  const { container: withFooters } = render(
    <OffFooters
      footers={[
        "Booking engine is not enabled for this org. Ask your account manager to switch it on.",
        "Hire orders is off for this org. Ask your account manager to switch it on.",
      ]}
    />,
  );
  expect(
    within(withFooters).getByText("Booking engine is not enabled for this org. Ask your account manager to switch it on."),
  ).toBeInTheDocument();
  expect(
    within(withFooters).getByText("Hire orders is off for this org. Ask your account manager to switch it on."),
  ).toBeInTheDocument();

  const { container: empty } = render(<OffFooters footers={[]} />);
  expect(empty.firstChild).toBeNull();
});

it("FirstRunSideCard renders the title, body, and every link", () => {
  const links: SideLink[] = [
    { title: "See it as your artists do", where: "The pencil top right opens the editor bar." },
    { title: "Read what each role covers", where: "Settings · Docs" },
  ];
  render(
    <FirstRunSideCard
      title="Nothing here blocks the rest of the app"
      body="Some steps above block the first booking. The app itself is open."
      links={links}
    />,
  );
  expect(screen.getByText("Nothing here blocks the rest of the app")).toBeInTheDocument();
  expect(screen.getByText("Some steps above block the first booking. The app itself is open.")).toBeInTheDocument();
  for (const link of links) {
    expect(screen.getByText(link.title)).toBeInTheDocument();
    expect(screen.getByText(link.where)).toBeInTheDocument();
  }
});

it("FirstRunQueue shows the Sample pill only when sample is set, and the cta button only when present", () => {
  const rows: QueueRow[] = [
    { dot: "accent", title: "Nachtstück · 14 Aug confirmed", hint: "An accepted tier-1 offer, confirmed by a producer", when: "09:12", cta: "Open" },
    { dot: "faint", title: "30 dates waiting on slots", hint: "Set cast slots and tonight's digest includes them", when: "—", cta: "" },
  ];

  const { unmount } = render(
    <FirstRunQueue title="What this page becomes" hint="Sample rows, shown once a module is on." sample opacity={0.55} rows={rows} />,
  );
  expect(screen.getByText("What this page becomes")).toBeInTheDocument();
  expect(screen.getByText("Sample")).toBeInTheDocument();
  for (const row of rows) {
    expect(screen.getByText(row.title)).toBeInTheDocument();
    expect(screen.getByText(row.when)).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set slots" })).not.toBeInTheDocument();
  unmount();

  render(<FirstRunQueue title="Your dates" hint="Live." sample={false} opacity={1} rows={[]} />);
  expect(screen.queryByText("Sample")).not.toBeInTheDocument();
});
