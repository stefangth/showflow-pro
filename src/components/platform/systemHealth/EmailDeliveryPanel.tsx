import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { StatusDot } from "@/components/ui/status-dot";
import { redactEmail, redactEmailsInText } from "@/lib/identity";
import { EMAIL_HEALTH } from "@/config/app.config";
import { healthTone, healthLabel, type EmailHealth, type HealthState } from "@/lib/systemHealth";

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.01 || n === 0 ? 1 : 2)}%`;
const toneForRate = (rate: number, warn: number, down: number) =>
  rate > down ? "text-destructive" : rate > warn ? "text-warning" : "text-success";

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-l bg-well-tint p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-medium tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function EmailDeliveryPanel({
  health, state, window, onWindowChange,
}: { health: EmailHealth; state: HealthState; window: number; onWindowChange: (m: number) => void }) {
  const h = health;
  const badge = (s: string): string =>
    s === "bounced" ? "border-warning/30 text-warning"
      : s === "failed" || s === "complained" ? "border-destructive/30 text-destructive"
      : "border-border text-muted-foreground";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <CardTitle className="font-display text-base">Email delivery</CardTitle>
        <StatusPill tone={healthTone(state)} dot>{healthLabel(state)}</StatusPill>
        <span className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-m border border-border text-xs">
          {EMAIL_HEALTH.windowOptions.map((m) => (
            <button key={m} onClick={() => onWindowChange(m)}
              className={`px-3 py-1 ${window === m ? "bg-well-tint font-medium text-foreground" : "text-muted-foreground"}`}>
              {m === 1440 ? "24h" : "7d"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Delivery rate" value={pct(h.deliveryRate)} sub={`${h.delivered} of ${h.sent} delivered`}
               tone={h.deliveryRate < EMAIL_HEALTH.deliveryWarn ? "text-warning" : "text-success"} />
          <Kpi label="Bounce rate" value={pct(h.bounceRate)} sub={`${h.bounced} bounced · warn > 2%`}
               tone={toneForRate(h.bounceRate, EMAIL_HEALTH.bounceWarn, EMAIL_HEALTH.bounceDown)} />
          <Kpi label="Complaint rate" value={pct(h.complaintRate)} sub={`${h.complained} complaints · norm < 0.1%`}
               tone={toneForRate(h.complaintRate, EMAIL_HEALTH.complaintWarn, EMAIL_HEALTH.complaintDown)} />
          <Kpi label="Send failures" value={String(h.failureCount)} sub={`${h.suppressed} suppressed pre-send`}
               tone={h.failureCount > 0 ? "text-warning" : "text-success"} />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-muted-foreground">By template</div>
          <div className="space-y-1.5">
            {h.byTemplate.map((t) => (
              <div key={t.templateName} className="flex items-center gap-3 rounded-l border border-border p-2.5">
                <StatusDot tone={healthTone(t.bounced > 0 || t.failed > 0 ? "degraded" : "operational")} />
                <span className="flex-1 truncate font-mono text-sm">{t.templateName}</span>
                <span className="text-xs text-muted-foreground">{t.sent} sent · {t.bounced} bounced · {t.failed} failed</span>
                <span className="min-w-[52px] text-right text-sm font-medium tabular-nums">{pct(t.deliveryRate)}</span>
              </div>
            ))}
            {h.byTemplate.length === 0 && <p className="text-sm text-muted-foreground">No email in this window.</p>}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-muted-foreground">Recent issues</div>
          <div className="space-y-1.5">
            {h.recentIssues.map((i, idx) => (
              <div key={idx} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
                <Badge variant="outline" className={`text-eyebrow ${badge(i.status)}`}>{i.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{redactEmail(i.recipientEmail)}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{redactEmailsInText(i.errorMessage) ?? i.templateName}</span>
                <span className="text-xs text-muted-foreground">{new Date(i.occurredAt).toLocaleString()}</span>
              </div>
            ))}
            {h.recentIssues.length === 0 && <p className="text-sm text-muted-foreground">No delivery issues in this window.</p>}
          </div>
        </div>

        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          {h.lastEventAt
            ? `Delivery webhook healthy — last Resend event ${new Date(h.lastEventAt).toLocaleString()}.`
            : "No delivery events received yet — if sends continue with none, this domain reads Stale (check the Resend webhook)."}
        </div>
      </CardContent>
    </Card>
  );
}
