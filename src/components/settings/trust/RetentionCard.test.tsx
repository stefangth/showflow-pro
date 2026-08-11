import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { RETENTION } from "@/lib/trust/facts";
import { RetentionCard } from "./RetentionCard";

describe("RetentionCard", () => {
  it("renders every retention row from the claim table, verbatim", () => {
    renderWithProviders(<RetentionCard />);

    for (const row of RETENTION) {
      expect(screen.getByText(row.item)).toBeInTheDocument();
      expect(screen.getByText(row.period)).toBeInTheDocument();
    }
  });

  // The subhead used to read: Nothing is kept "just in case". That is a claim
  // about behaviour, and the two categories the table leads with do not keep
  // it — see the scheduled-job assertion below. What the card can say, and now
  // does, is where the periods come from.
  it("attributes the periods to the privacy policy instead of claiming a deletion practice", () => {
    renderWithProviders(<RetentionCard />);

    const subhead = screen.getByText(/section 7 of the privacy policy/i);
    expect(subhead).toHaveTextContent(/Each category below has a stated period/i);
    expect(screen.queryByText(/just in case/i)).toBeNull();
  });
});

// The fact the old subhead got wrong, pinned so the sentence can be
// strengthened the day it becomes true. Nothing in the repo deletes bookings,
// the audit log or chat on a timer: the only retention cron is email-log-prune
// (public.prune_email_log), and the sole deletions of booking and chat rows are
// the per-user anonymize_user and the per-org delete_org, neither of which is
// time-based. Chat archiving at 30 days is an interface rule
// (CHAT_ARCHIVE_DAYS), not a delete.
describe("scheduled retention jobs", () => {
  const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");

  it("schedules no job that prunes bookings, the audit log or chat", () => {
    const jobs = [...sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*\$\$([\s\S]*?)\$\$/g)];
    expect(jobs.length, "no cron jobs found — the scan pattern has drifted").toBeGreaterThan(0);

    const touching = jobs
      .filter(([, , body]) => /\b(bookings|booking_audit_log|chat_messages)\b/.test(body))
      .map(([, name]) => name);

    // If this ever fails, a timed deletion now exists and the card may make a
    // stronger claim than "these are the periods the policy commits to".
    expect([...new Set(touching)]).toEqual([]);
  });
});
