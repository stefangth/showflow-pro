// MIRROR: keep in sync with src/lib/systemHealth.ts deriveEmailStatus + src/config/app.config.ts EMAIL_HEALTH.
export type EmailState = "operational" | "degraded" | "down" | "stale";

export const EMAIL_THRESHOLDS = {
  bounceWarn: 0.02, bounceDown: 0.05, complaintWarn: 0.001, complaintDown: 0.003, deliveryWarn: 0.95,
};
export const EMAIL_ALERT = { windowMinutes: 180, minVolumeForAlert: 20, failureAlertCount: 3 };

export interface EmailSnapshot {
  attempted: number; sent: number; delivered: number; delayed: number; bounced: number;
  complained: number; failed: number; suppressed: number;
  delivery_rate: number; bounce_rate: number; complaint_rate: number; failure_count: number;
}

export function deriveEmailStatus(h: EmailSnapshot, t = EMAIL_THRESHOLDS): EmailState {
  if (h.attempted === 0) return "operational";
  if (h.sent === 0) return h.failed > 0 ? "down" : "operational";
  if (h.delivered + h.delayed + h.bounced + h.complained === 0) return "stale";
  if (h.bounce_rate > t.bounceDown || h.complaint_rate > t.complaintDown) return "down";
  if (h.bounce_rate > t.bounceWarn || h.complaint_rate > t.complaintWarn ||
      h.failure_count > 0 || h.delivery_rate < t.deliveryWarn) return "degraded";
  return "operational";
}
