import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";
import type { EmailHealth } from "@/lib/systemHealth";

const health: EmailHealth = {
  attempted: 248, sent: 241, delivered: 233, delayed: 1, bounced: 7, complained: 0, failed: 2, suppressed: 5,
  deliveryRate: 0.967, bounceRate: 0.029, complaintRate: 0, failureCount: 2, lastEventAt: "2026-07-11T08:00:00Z",
  byTemplate: [{ templateName: "offer_digest", sent: 210, delivered: 204, bounced: 6, failed: 0, deliveryRate: 0.971 }],
  recentIssues: [{ recipientEmail: "bthomas@gmail.com", templateName: "offer_digest", status: "bounced", errorMessage: "no mailbox", occurredAt: "2026-07-11T06:00:00Z" }],
};

describe("EmailDeliveryPanel", () => {
  it("renders KPIs, template rows, and a redacted recipient", () => {
    render(<EmailDeliveryPanel health={health} state="degraded" window={1440} onWindowChange={() => {}} />);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("offer_digest")).toBeInTheDocument();
    expect(screen.getByText("b***@gmail.com")).toBeInTheDocument();
    expect(screen.queryByText("bthomas@gmail.com")).not.toBeInTheDocument();
  });
});
