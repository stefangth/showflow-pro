import { render, screen, fireEvent } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";
import i18n from "@/i18n";
import { AvailabilityFirstRun } from "./AvailabilityFirstRun";

const base = {
  orgName: "Nordstadt Produktionen",
  hireOrdersEnabled: true,
  artistAcceptance: true,
  digestLabel: "19:00",
  windowHours: 48,
  onBlockDates: () => {},
};

function renderRun(props: Partial<React.ComponentProps<typeof AvailabilityFirstRun>>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AvailabilityFirstRun {...base} blockedCount={0} {...props} />
    </I18nextProvider>,
  );
}

test("shows the one-task strip and 0 of 1 when nothing is blocked", () => {
  renderRun({ blockedCount: 0 });
  expect(screen.getByText(i18n.t("availability:firstRun.task.title"))).toBeInTheDocument();
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByText(i18n.t("availability:firstRun.setup.ofOne"))).toBeInTheDocument();
});

test("retires the strip once a date is blocked, keeping the rules card", () => {
  renderRun({ blockedCount: 2 });
  expect(screen.queryByText(i18n.t("availability:firstRun.task.title"))).not.toBeInTheDocument();
  // meter caps at 1 of 1
  expect(screen.getByText("1")).toBeInTheDocument();
  // rules card is reference and always shows
  expect(screen.getByText(i18n.t("availability:firstRun.rules.heading"))).toBeInTheDocument();
});

test("Block dates button calls onBlockDates", () => {
  const onBlockDates = vi.fn();
  renderRun({ blockedCount: 0, onBlockDates });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("availability:firstRun.task.cta") }));
  expect(onBlockDates).toHaveBeenCalled();
});

test("offers rule reflects direct-book orgs", () => {
  renderRun({ blockedCount: 0, artistAcceptance: false });
  expect(screen.getByText(i18n.t("availability:firstRun.rules.offersBodyDirect"))).toBeInTheDocument();
});

test("hire-orders footer line only shows when hire orders are on", () => {
  const { rerender } = renderRun({ blockedCount: 0, hireOrdersEnabled: false });
  expect(screen.queryByText(i18n.t("availability:firstRun.hireOrdersFooter"))).not.toBeInTheDocument();
  rerender(
    <I18nextProvider i18n={i18n}>
      <AvailabilityFirstRun {...base} blockedCount={0} hireOrdersEnabled />
    </I18nextProvider>,
  );
  expect(screen.getByText(i18n.t("availability:firstRun.hireOrdersFooter"))).toBeInTheDocument();
});
