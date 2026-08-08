export const meta = {
  name: "cockpit-pixel-polish",
  description: "Fan out subagents to make the Show Date Cockpit pixel-match the design reference",
  phases: [
    { title: "Polish", detail: "one agent per component compares app vs reference and fixes its file" },
    { title: "Rebuild", detail: "typecheck + re-screenshot" },
    { title: "Verify", detail: "harsh critic re-checks each facet against the reference" },
  ],
};

const REPO = ".";
const REF_SRC = "public/ref/cockpit-original.html";
const SHOTS = "screenshots";

// Each facet owns ONE file (no write conflicts across parallel agents). The
// `spec` is the exact target distilled from the prototype so an agent can fix
// even what a small PNG hides.
const FACETS = [
  {
    key: "header",
    file: "src/components/shows/date/CockpitHeader.tsx",
    also: "src/components/shows/date/SlotMeter.tsx",
    app: `${SHOTS}/app-cast.png`,
    ref: `${SHOTS}/ref-cast.png`,
    spec: `The anchored header. Target (from ${REF_SRC}):
- Production eyebrow: 11px/600 uppercase, letter-spacing ~1.6px, color var(--accent-600).
- Date line: font-display 22px/28px, weight 600, letter-spacing -0.3px.
- Meta line: 13px/18px, var(--text-muted).
- Slot meter ROW: a mono label "N of 6 slots" (12px, var(--text)) directly LEFT of the meter; the meter is FIXED-WIDTH segments 16px x 6px, radius 2px, gap 3px (confirmed=var(--green-500), accepted=var(--accent-400), open=var(--surface-3)); then a vertical divider 1px x 14px var(--line); then the status: a 6px square-ish dot + text, BOTH colored by tone (amber=var(--amber-600) etc), 12px.
- Primary CTA: bg var(--accent-500), white text, 36px tall, radius var(--radius-m). A round 36x36 outline overflow "..." button may sit to its right.
- Tab bar: 13px; inactive weight 500 var(--text-muted); active weight 600 var(--text) with a 2px var(--accent-500) bottom border; gap 2px. Hire-order tab badge reads e.g. "3 LEFT" on an amber tint (var(--amber-100)/var(--amber-600)); the Chat tab badge is "3" on var(--surface-3).
The "Flow: ..." indicator is an app-only addition; keep it subtle and low-prominence so it does not disrupt the reference rhythm.`,
  },
  {
    key: "rail",
    file: "src/components/shows/date/CockpitRail.tsx",
    app: `${SHOTS}/app-cast.png`,
    ref: `${SHOTS}/ref-cast.png`,
    spec: `The left rail (288px, bg var(--surface-2), right border, padding 18px). Sections separated by 1px var(--line) dividers: Date (clock/pin/ticket icon rows, mono time) → Eligibility (chips: inherited = outline w/ faint "inherited"; override = var(--surface-3) bg; skills = var(--accent-100) bg var(--accent-700)) → full-width "Edit date setup" outline button (30px) → Activity (grid: 46px mono faint time column + text) → Chat (label + right-aligned "3" badge on var(--accent-500)/white, then a preview line). Uppercase section labels 11px/600 letter-spacing ~1.6px var(--text-muted).`,
  },
  {
    key: "cast",
    file: "src/components/shows/date/CockpitCastList.tsx",
    app: `${SHOTS}/app-cast.png`,
    ref: `${SHOTS}/ref-cast.png`,
    spec: `Cast tab cards. Each group is a card (radius var(--radius-l), 0.5px var(--line) border) with an uppercase header "Main cast · 2 of 4" (11px/600). Rows: padding 11px 14px, hairline divider between; 28px round avatar (tone bg), name 14px/18px weight 500, meta 11px mono var(--text-faint); right side a status badge (Confirmed=green, Accepted=accent, Offered=amber) and a Confirm outline button (30px) for accepted rows. Open slots: dashed-border 28px avatar, "Open slot" faint name, amber meta, an "Open next tier" outline button.`,
  },
  {
    key: "ladder",
    file: "src/components/shows/date/CockpitOfferLadder.tsx",
    app: `${SHOTS}/app-offers.png`,
    ref: `${SHOTS}/ref-offers.png`,
    spec: `The Offers tab "Offer ladder" card (radius-l, 0.5px border, padding 16px). Title "Offer ladder" font-display 17px/600; right subtitle "Show-specific priorities · auto-escalate on" 12px muted. A 4-column grid of tiers, each with a 2px LEFT border colored by state (past=var(--green-500) on var(--surface-2); open=var(--amber-500) on var(--amber-100); future=var(--line-strong)); tier title 12px/600, sub 12px (open=amber-600, future=text-faint, past=muted). Below: buttons row — "Preview next tier" (outline), "Open tier 3" (outline), "Close tier 2" (ghost).`,
  },
  {
    key: "footer",
    file: "src/components/shows/date/CockpitFooter.tsx",
    also: "src/components/shows/date/CockpitShell.tsx",
    app: `${SHOTS}/app-cast.png`,
    ref: `${SHOTS}/ref-cast.png`,
    spec: `The persistent footer bar at the bottom of the work column: border-top 0.5px var(--line), bg var(--surface), padding 12px 20px. Left: "Hire order" 14px/500 + a badge ("3 LEFT" amber / "READY" green, mono 10px) + a 12px muted detail line. Right: a CTA button (primary accent when READY, else outline disabled 34px). The CockpitShell must keep the work column from clipping (min-w-0) and the rail full-height with a right border.`,
  },
  {
    key: "peek",
    file: "src/components/bookings/RowPeek.tsx",
    app: `${SHOTS}/app-peek.png`,
    ref: `${SHOTS}/ref-cast.png`,
    spec: `The bookings-row peek popover (320px, padding 14px). Eyebrow: "<date> · <tone>" 11px/600 uppercase colored by tone (filled=green, at-risk=amber, neutral=accent). Headline 14px/500. A slot meter (same tones as the header). Buttons row: "Confirm N" (primary accent, when confirmable) + "Open date" (outline), each flex-1. Hint line: mono 11px var(--text-faint) "Space to peek · Enter to open". (There is no full ref screenshot for the peek; match the design-system styling and the header meter tones.)`,
  },
];

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    file: { type: "string" },
    changed: { type: "boolean" },
    summary: { type: "string", description: "What was changed and why (concise)" },
    selfVerdict: { type: "string", enum: ["match", "close", "off"] },
  },
  required: ["file", "changed", "summary", "selfVerdict"],
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    facet: { type: "string" },
    pass: { type: "boolean" },
    score: { type: "number", description: "0-100 fidelity vs reference" },
    remaining: { type: "array", items: { type: "string" }, description: "specific residual diffs, empty if none" },
  },
  required: ["facet", "pass", "score", "remaining"],
};

const fixPrompt = (f, roundNote) => `You are a meticulous UI engineer making the Show Date Cockpit pixel-match a design reference.

Compare the APP screenshot against the REFERENCE screenshot and fix ONLY this file: ${f.file}${f.also ? ` (you may also edit ${f.also})` : ""}.

Steps:
1. Read the APP screenshot: ${f.app}
2. Read the REFERENCE screenshot: ${f.ref}
3. Read the exact prototype markup for ground-truth styles: ${REF_SRC}
4. Read the file(s) you own and edit them to eliminate every visible difference for THIS facet.

Target spec:
${f.spec}

Rules:
- Use the design tokens already in the app: Tailwind utilities + CSS vars like var(--accent-600), var(--line), var(--surface-2), var(--radius-l), var(--green-500). NOTE: accent numbered stops (accent-400..900) do NOT support /opacity modifiers.
- Do NOT change component prop signatures or logic — styling/markup only. Do NOT touch other files.
- Be exact about sizes, weights, letter-spacing, colors, gaps, paddings, radii.
- If it already matches, make no change and report selfVerdict "match".
${roundNote ? `\nResidual issues flagged last round to fix now:\n${roundNote}` : ""}

Return the structured result.`;

const verifyPrompt = (f) => `You are a HARSH design critic. Compare the two screenshots side by side and judge whether the app's "${f.key}" facet is pixel-faithful to the reference. Be unforgiving about spacing, font size/weight, letter-spacing, color tokens, border radius, and alignment.

APP: ${f.app}
REFERENCE: ${f.ref}
Ground-truth markup: ${REF_SRC}

Target for this facet:
${f.spec}

pass=true ONLY if a designer would call it indistinguishable from the reference. List every remaining diff specifically. Return the structured verdict.`;

const MAX_ROUNDS = 8;

let roundNotes = {};
let lastVerdicts = [];

for (let round = 1; round <= MAX_ROUNDS; round++) {
  // Budget guard: each round costs ~12 agents; stop early if the turn's token
  // target is nearly spent so the loop never runs the pool dry.
  if (round > 1 && budget.total && budget.remaining() < 120_000) {
    log(`Stopping loop before round ${round}: ~${Math.round(budget.remaining() / 1000)}k tokens left.`);
    break;
  }
  phase("Polish");
  log(`Round ${round}: ${FACETS.length} agents polishing their components`);
  const fixes = await parallel(
    FACETS.map((f) => () =>
      agent(fixPrompt(f, roundNotes[f.key]), {
        label: `fix:${f.key}`,
        phase: "Polish",
        agentType: "general-purpose",
        schema: FIX_SCHEMA,
      }),
    ),
  );
  log(`Round ${round} edits: ${fixes.filter(Boolean).map((r) => `${r.file.split("/").pop()}=${r.selfVerdict}`).join(", ")}`);

  phase("Rebuild");
  const build = await agent(
    `Run these two commands from the repo root and report results verbatim:
1. \`npx tsc -p tsconfig.app.json --noEmit\`  (must exit 0)
2. If tsc passes, \`node scripts/shoot-cockpit.mjs\` to regenerate screenshots.
If tsc FAILS, read the errors, fix ONLY the compile errors in the offending cockpit component files (styling regressions from this round), then re-run both. Report the final tsc exit code and whether screenshots were regenerated.`,
    { label: `rebuild:r${round}`, phase: "Rebuild", agentType: "general-purpose" },
  );
  log(`Round ${round} rebuild: ${String(build).slice(0, 160)}`);

  phase("Verify");
  const verdicts = await parallel(
    FACETS.map((f) => () =>
      agent(verifyPrompt(f), {
        label: `verify:${f.key}`,
        phase: "Verify",
        agentType: "general-purpose",
        schema: VERDICT_SCHEMA,
      }),
    ),
  );
  lastVerdicts = verdicts.filter(Boolean);
  const failing = lastVerdicts.filter((v) => !v.pass);
  log(`Round ${round} verdicts: ${lastVerdicts.map((v) => `${v.facet}=${v.pass ? "PASS" : "FAIL"}(${v.score})`).join(", ")}`);

  if (failing.length === 0) {
    log(`All facets PASS after round ${round}.`);
    break;
  }
  // Feed each failing facet's residuals into next round.
  roundNotes = {};
  for (const v of failing) {
    const facet = FACETS.find((f) => f.key === v.facet) ?? FACETS.find((f) => v.facet.includes(f.key));
    if (facet) roundNotes[facet.key] = v.remaining.map((r) => `- ${r}`).join("\n");
  }
}

return {
  verdicts: lastVerdicts,
  passing: lastVerdicts.filter((v) => v.pass).map((v) => v.facet),
  failing: lastVerdicts.filter((v) => !v.pass).map((v) => ({ facet: v.facet, score: v.score, remaining: v.remaining })),
};
