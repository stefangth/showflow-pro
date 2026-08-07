// src/lib/dashboard/firstRun.ts
import { FEATURE_KEYS, type FeatureKey } from "@/lib/entitlements";
import type {
  ComposeInput, ComposeResult, ComposedStep, DashboardRole,
  ModuleOnboardingDef, OnboardingCtx, SamplePreviewData, WelcomeCopy,
} from "./types";

export function composeOnboarding(
  input: ComposeInput,
  registry: Record<FeatureKey, ModuleOnboardingDef<string>>,
): ComposeResult {
  const { enabled, role, moduleStatuses, ctx } = input;
  const steps: ComposedStep[] = [];
  const rules: ComposeResult["rules"] = [];
  let complete = true;

  for (const key of FEATURE_KEYS) {
    const def = registry[key];
    if (!enabled.has(key)) continue;
    const status = moduleStatuses[key];
    if (!status) { complete = false; continue; } // unread status => not complete
    for (const s of status.steps) {
      const meta = def.steps[s.key];
      if (!meta) continue; // defensive; parity test guarantees coverage
      steps.push({ ...meta, key: s.key, moduleKey: key, done: s.done, block: s.block });
    }
    if (!status.complete) complete = false;
    rules.push(...def.rules(role, ctx));
  }

  const offFooters = FEATURE_KEYS.filter((k) => !enabled.has(k)).map((k) => registry[k].offFooter);
  return { steps, complete, rules, offFooters };
}

// ---- Copy (ported from the prototype's renderVals; org name + counts interpolated).
export function welcomeCopy(
  role: DashboardRole, complete: boolean, ctx: OnboardingCtx,
  progress: { filled: number; total: number },
): WelcomeCopy {
  const org = ctx.orgName;
  const base = { eyebrow: "Welcome", progressFilled: progress.filled, progressTotal: progress.total };
  if (role === "admin") {
    return complete
      ? { ...base, headline: "This workspace is already set up", body: "Nothing to configure. Walk the decisions behind it, because every number on this page follows them.", primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      : { ...base, headline: `You are the first admin at ${org}`, body: "The database is empty. A few steps put real dates on this page, and the sample below becomes yours.", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 15 minutes" };
  }
  if (role === "producer") {
    return complete
      ? { ...base, headline: `You have joined ${org}`, body: `${ctx.counts.pendingConfirmations} artists are waiting on a confirm from you.`, primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      : { ...base, headline: `${org} is still being set up`, body: "Dates, offers and confirmations appear here the moment the first import lands.", primaryLabel: "See what is outstanding", secondaryLabel: "Later", progressLabel: `Org setup · ${progress.filled} of ${progress.total}`, progressHint: "Only an admin can do these" };
  }
  // artist
  return complete
    ? { ...base, headline: "Your first offers are on their way", body: "Your account is set up. A few rules decide when an offer reaches you and how long you have to answer.", primaryLabel: "How offers work here", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
    : { ...base, headline: `${org} added you to the roster`, body: "Offers arrive by email and land on this page. Block the dates you cannot play first, so you only get asked about dates that work.", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 2 minutes" };
}

export function railHeaderCopy(role: DashboardRole, complete: boolean) {
  if (complete) {
    return {
      eyebrow: role === "artist" ? "How offers work here" : "How this org works",
      title: "The rules you inherited",
      body: role === "producer"
        ? "You cannot change these, but every number on this page follows them."
        : "You can change them in Settings, but every number on this page follows them today.",
    };
  }
  if (role === "admin") return { eyebrow: "Set up", title: "Get the workspace running", body: "Some of these block the first offer. Nothing here stops you using the rest of the app." };
  if (role === "producer") return { eyebrow: "Org setup", title: "What is still outstanding", body: "Only an admin can do these. This is here so you know why the page is empty, not so you can fix it." };
  return { eyebrow: "Set up", title: "Before your first offer", body: "None of this blocks anything. It just makes the offers you get worth answering." };
}

export function collapsedCopy(role: DashboardRole, complete: boolean, remaining: number) {
  if (complete) return { label: role === "admin" ? "Set up · done" : "Set up · done", hint: role === "artist" ? "How offers reach you" : "Booking flow, dates, cast slots, your team", cta: "How this org works" };
  return {
    label: role === "producer" ? "Org setup in progress" : "Set up in progress",
    hint: `${remaining} step${remaining === 1 ? "" : "s"} left`,
    cta: role === "producer" ? "See what is outstanding" : "Resume",
  };
}

export const SAMPLE_PREVIEW: Record<DashboardRole, SamplePreviewData> = {
  admin: {
    stats: [
      { title: "Live dates", value: "34", label: "upcoming" },
      { title: "Waiting on a confirm", value: "6", label: "bookings" },
      { title: "Roster", value: "41", label: "artists" },
    ],
    queue: [
      { title: "6 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "Airtable sync brought in 4 new dates", hint: "None of them have cast slots set", when: "09:04", cta: "Review", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
  producer: {
    stats: [
      { title: "Waiting on you", value: "4", label: "confirmations" },
      { title: "Expiring today", value: "2", label: "offers" },
      { title: "Unfilled tiers", value: "3", label: "dates" },
    ],
    queue: [
      { title: "4 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "1 hire order awaits your countersign", hint: "Nora Lindqvist", when: "today", cta: "Sign", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
  artist: {
    stats: [
      { title: "Open offers", value: "2", label: "to answer" },
      { title: "Confirmed", value: "5", label: "dates" },
      { title: "Blocked", value: "3", label: "dates" },
    ],
    queue: [
      { title: "Offer for Nachtstück · Studio", hint: "Tier 1 · main cast · expires 17:00 today", when: "17:00", cta: "Answer", tone: "warning" },
      { title: "Offer for Kammerkonzert · Halle B", hint: "Tier 2 · understudy · expires Sun 09 Aug", when: "09 Aug", cta: "Answer", tone: "accent" },
      { title: "Hire order is ready to sign", hint: "Kammerkonzert 12 Aug · 480 EUR", when: "today", cta: "Sign", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Confirmed · main" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Confirmed · main" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "Offer pending" },
    ],
  },
};
