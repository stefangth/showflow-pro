import { describe, it, expect } from "vitest";
import { deriveEmailStatus, type EmailHealth } from "@/lib/systemHealth";
import { EMAIL_HEALTH } from "@/config/app.config";

const t = EMAIL_HEALTH;
const base: EmailHealth = {
  attempted: 0, sent: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0,
  failed: 0, suppressed: 0, deliveryRate: 0, bounceRate: 0, complaintRate: 0,
  failureCount: 0, lastEventAt: null, byTemplate: [], recentIssues: [],
};

describe("deriveEmailStatus", () => {
  it("idle (no attempts) → operational", () => {
    expect(deriveEmailStatus(base, t)).toBe("operational");
  });
  it("all suppressed pre-send → operational", () => {
    expect(deriveEmailStatus({ ...base, attempted: 5, suppressed: 5 }, t)).toBe("operational");
  });
  it("everything failed pre-Resend → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 4, failed: 4, failureCount: 4 }, t)).toBe("down");
  });
  it("sending but zero delivery webhooks → stale", () => {
    expect(deriveEmailStatus({ ...base, attempted: 30, sent: 30 }, t)).toBe("stale");
  });
  it("bounce 2.9% (>2%, <5%) → degraded", () => {
    expect(deriveEmailStatus({ ...base, attempted: 241, sent: 241, delivered: 233, bounced: 7, deliveryRate: 0.967, bounceRate: 0.029 }, t)).toBe("degraded");
  });
  it("bounce 6% (>5%) → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 100, sent: 100, delivered: 94, bounced: 6, deliveryRate: 0.94, bounceRate: 0.06 }, t)).toBe("down");
  });
  it("complaint 0.4% (>0.3%) → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 250, sent: 250, delivered: 249, complained: 1, deliveryRate: 0.996, complaintRate: 0.004 }, t)).toBe("down");
  });
  it("any send failure alongside healthy delivery → degraded", () => {
    expect(deriveEmailStatus({ ...base, attempted: 51, sent: 50, delivered: 50, failed: 1, failureCount: 1, deliveryRate: 1 }, t)).toBe("degraded");
  });
  it("healthy delivery, no faults → operational", () => {
    expect(deriveEmailStatus({ ...base, attempted: 100, sent: 100, delivered: 100, deliveryRate: 1 }, t)).toBe("operational");
  });
});
