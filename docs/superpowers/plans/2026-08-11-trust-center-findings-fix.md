# Trust Center — closing the gauntlet findings

Spec: `docs/superpowers/specs/2026-08-10-trust-center-design.md`
Source of findings: `.gauntlet/2026-08-10-trust-center-design/findings-r7-{claims,code,coverage,design}.md`
and the blind-verdict `gaps` recorded in `.gauntlet/2026-08-10-trust-center-design/gauntlet-ledger.md`.

Two repos, both already on their branches with a clean tree:

| repo | path | branch |
|---|---|---|
| APP | `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/email-templates-coverage-3d70d9` | `claude/trust-center-design-6e4524` |
| LAND | `/Users/stefanschaal/Claude Code/showflow-pro.landingpage` | `feature/trust-center` |

The two are joined by one generated contract: `src/lib/trust/facts.ts` (APP) is the
only source. `npm run sync:mirrors` regenerates `public/trust.json` from it, and
LAND's `npm run sync:trust -- --from <APP>/public/trust.json` regenerates
`src/data/trustFallback.ts`. Never hand-edit either generated file.

## Global Constraints

These bind every task. A change that violates one is a defect regardless of what
else it achieves.

1. **Only claims traceable to existing code or a published artefact.** Every
   user-visible assertion must be checkable against a file in one of these repos
   or against `docs/legal/privacy-policy.en.md`. When a claim and the code
   disagree, the claim changes.
2. **No false claims.** A claim narrowed to vagueness to dodge a finding is still
   a failure. Say the true, specific thing.
3. **Never rewrite a published legal document to make a claim true.** The
   privacy policies are out of bounds in this plan except where a task says
   otherwise in so many words, and any such edit must be reported in the task
   report so a human can sign it off.
4. **Exclude "open items".** No "what we have not done yet" section, no
   roadmap, no compliance-in-progress chips.
5. **No em-dashes or en-dashes in shipped copy** (UI strings, emails, changelog,
   `facts.ts` claim text). Use a period, comma, colon, or restructure.
6. **No super-admin or platform-admin surface.** These roles are invisible to
   customers; the matrix has three role columns and no ShowFlow staff column.
7. **Semantic tokens only.** No hardcoded colors in APP components. Accent stops
   `accent-50`..`900` do not support Tailwind opacity modifiers.
8. **Tests import the real module.** Never re-implement production logic in a test.
9. After any `facts.ts` change, regenerate both artifacts and leave
   `npm run sync:mirrors:check` (APP) and `sync:trust -- --check` (LAND)
   passing.

## Verification

APP, all of these must pass before a task is DONE:

```
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npx vitest run src/lib/trust src/components/settings/trust
npm run sync:mirrors:check
```

LAND:

```
npm run build
npm run lint
npm run sync:trust -- --from "<APP>/public/trust.json" --check
```

---

## Task 1 — The Critical: an undisclosed analytics processor on the trust page

`findings-r7-claims.md` § 1.

`@vercel/analytics` is imported in LAND `src/App.tsx:3` and mounted at `:27` as
`{analyticsOn && <Analytics />}`, where `analyticsOn` tracks
`readConsent() === 'accept'`. So it is **already consent-gated** — the finding's
"runs analytics" framing overstates it, and no beacon fires before consent.

The defect that remains is real and narrower: once a visitor accepts cookies, an
analytics processor runs on the very page that tells them no analytics exists.
That page prints three claims it then falsifies:

- `facts.ts:369` — "Turns off analytics, session replay, and error tracking if and when any of them is enabled"
- `facts.ts:261` — "12 months, once analytics is enabled"
- `Trust.tsx` hero — "every outside processor that ever touches it"

and the subprocessor table lists Vercel's purpose as "Application hosting, edge
network" only, while marking Sentry and PostHog **Off** on the stated grounds
that neither SDK is in the dependency tree. `@vercel/analytics` is in the tree
and is mounted.

This is the same defect the build already fixed once for Google Fonts, and the
fix must be at least as honest.

**The route is the owner's ruling, recorded in the ledger before this task is
dispatched.** Both routes end with every string true:

- **Disclose.** Add Vercel Web Analytics to `SUBPROCESSORS` as an analytics
  purpose distinct from hosting, note that it runs only after consent, and
  rewrite the three strings so none claims analytics is absent. This edits §5 of
  both privacy policies and is the one carve-out to Global Constraint 3; report
  the exact wording added.
- **Remove.** Drop `@vercel/analytics` from LAND's dependencies and its mount.
  The three strings then become true as written, the subprocessor table is
  already correct, and no legal document is touched.

Acceptance:
- No string on either surface claims analytics is unenabled while a beacon loads.
- The subprocessor table distinguishes Vercel's hosting role from its analytics role.
- `SUBPROCESSOR_SUMMARY` and the KPI counts move with the table and stay derived, not retyped.
- `facts.privacy.test.ts` still passes and still pins the table against §5.

## Task 2 — Five claims that outrun the code

`findings-r7-claims.md` §§ 2, 3, 4, 5, 6. All in APP `src/lib/trust/facts.ts`
plus its tests, except § 6 which also touches `VisibilityMatrix.tsx`.

1. **§2 Auditability.** The claim says all booking changes are logged; only
   status transitions are. Narrow it to booking status changes and say that
   automated transitions are logged the same way. Verify against the trigger
   that writes `booking_audit_log` before wording it.
2. **§3 Capabilities carve-out.** Current copy implies 25 of 28 rights are
   database-checked; 19 are. State the real three-way split, or say "checked on
   the server" if that is the true superset. Count it yourself from
   `CAPABILITY_DEFS` against `is_capability_enabled` in migrations and
   `requireCapability` in edge functions. Whatever number ships must be derived
   in code or pinned by a test, not typed.
3. **§4 "Nothing is kept 'just in case'."** This asserts a deletion practice
   that does not hold for the two headline categories. Drop the sentence or
   replace it with something true of the table beneath it.
4. **§5 Outside-reach tile.** It cites one test that does not assert what the
   tile claims. Cite both files the way `CONTROLS[0]` does, or narrow the
   sentence to what the cited test actually proves.
5. **§6 "enforced in the database, not the interface"** is falsified two rows
   below it, and the public page already says the more accurate thing. Copy the
   landing page's wording into `VisibilityMatrix.tsx` so the two surfaces agree.

Acceptance: each of the five claims is checkable against a named file, and a
test fails if the underlying fact changes. Regenerate the contract.

## Task 3 — Values that live outside the gate that is supposed to hold them

`findings-r7-code.md` § 3, `findings-r7-coverage.md` §§ 1, 2.

1. **Backup window and region are hand-retyped into components** rather than
   imported from `facts.ts`, so the drift gate cannot see them. Export both
   strings from `facts.ts` and import them at every render site. Grep both repos
   for the literals before declaring it done.
2. **The retention table publishes periods nothing enforces**, and one is
   contradicted by the code. For each row of `RETENTION`, either point it at the
   code or config that enforces it, or reword it as the policy commitment it
   actually is. Say which in the report, row by row. Do not delete a row to make
   the problem go away.
3. **Two document "last updated" dates are hand-typed** and outside every drift
   gate. Derive them from the documents themselves, or pin them with a test that
   reads the document. A date a reader treats as fact cannot be a literal nobody
   checks.

## Task 4 — A gate that says it is a guarantee, and a validator with a hole

`findings-r7-code.md` §§ 1, 4.

1. **The LAND drift gate is advisory** (`continue-on-error: true`, and it fetches
   a `/trust.json` that is not served yet, so it fails on every run), while two
   source comments state it as a guarantee. Point the CI step at a checked-out
   `showflow-pro` via `--from` so it actually gates, or keep the live fetch on a
   schedule and correct both comments to describe what really runs. A required
   check that can only fail teaches everyone to merge past red.
2. **`isTrustPayload` does not validate `roles[].value`**, the one enum that
   indexes the matrix. A payload with an unknown role value passes validation and
   renders a broken matrix. Reject unknown role values and require the fields the
   matrix reads. Add the test for a payload that should be rejected.

## Task 5 — In-app layout defects

`findings-r7-design.md` §§ 3, 4, and the in-app half of § 2. APP
`src/components/settings/trust/*`.

1. **`OrgDataCard`'s four tiles have no container in either theme** — give the
   app tile the same definition the public one has.
2. **`DocumentsCard`'s header breaks the pattern every other card follows.** Use
   `RetentionCard.tsx:10-11` verbatim: `<h3>` then the muted paragraph. This also
   fixes the reported bug where a three-line wrapped caption sits beside the
   title, so "Documents" optically aligns to line 2 of the caption.
3. **One 54-word matrix cell starves the Data column** on both surfaces. Hold the
   mechanism cell to a short clause and move the qualifier out of the table.
4. **The in-app content column stops about 170px short of the viewport's right
   edge** while the tables inside it wrap. Match the right margin the rest of
   Settings uses.

Verify at 375, 768, 1024, 1280 and 1440 in both themes before reporting DONE.

## Task 6 — Public page layout defects

`findings-r7-design.md` § 1, `findings-r7-code.md` § 2, and blind-verdict gaps
2, 4, 5, 6, 9. LAND `src/pages/Trust.tsx`, `src/index.css`.

1. **The sticky header never sticks:** `html, body { overflow-x: hidden }`
   (`index.css:158-162`) kills `position: sticky` on `.tc-header`, so the
   wordmark and the only "Back to site" escape scroll away. Change `html`'s rule
   to `overflow-x: clip`, and verify no horizontal scroll returns at 375.
2. **Every in-page jump lands under the 64px sticky header.** Add
   `scroll-margin-top` to the six `<section id=…>` elements.
3. **One card-stretch policy page-wide.** Today the controls grid equalises
   heights while copy lengths differ 11 lines vs 4, leaving roughly 180px of void
   under "Encryption and secrets", and two sections later a pair is left unequal.
   Either stretch every grid row and bottom-anchor the evidence line so the space
   is not a trailing void, or stop stretching. One policy, applied everywhere.
4. **Reclaim wasted table width** in the subprocessor table: status badges are
   stranded about 150px from the right edge while purpose holds three-word values
   across 535px. Rebalance to content widths.
5. **Rebuild the documents list as one card**, hairline-separated rows, two
   columns at ≥1024px, with a button-shaped affordance per row instead of five
   separately bordered boxes with a text link across a void.
6. **Style the anchor-link row** (Controls / Access / Subprocessors / …), which
   currently renders as unstyled body text under the toggle and reads as leftover
   markup.

## Task 7 — Density and rhythm

Blind-verdict gaps 1, 3, 8, 10 (the parts that are not open items), and
`findings-r7-design.md` §§ 2, 5. Touches `facts.ts` copy and both surfaces.

The reference covers the same ground in about 3060px; this page needs 5478px at
1440, and 4041px even in Summary mode. That gap is the single biggest reason the
build lost the blind comparison.

1. **Hold every control-card body to a 3 to 4 line ceiling** and push detail into
   the mono evidence line. "Roles and rights" and "Tenant isolation" are the
   offenders at 11 to 12 lines desktop, 14 at 375px.
2. **Give the visibility matrix a fixed row rhythm.** Widen the data column so no
   label wraps, clamp the mechanism column to two lines, align badges to the
   first-line baseline. Target one constant row height across all eight rows.
3. **Make "Summary" an actual summary.** It currently removes 22% of the page.
   Hold each `claim` to roughly 35 words, one assertion, with the qualifiers
   moved into the detail view.
4. **Colour discipline.** Six green "Full" pills in the admin matrix read as a
   traffic-light verdict on a neutral fact. Keep access badges neutral, mute "No
   access", and spend colour only where it carries meaning.
5. **Shorten retention values** so key/value rows stop wrapping: "90 days, once
   error tracking is enabled" becomes "90 days" plus a condition footnote.

Verify the rendered page height at 1440 in both modes and report the before and
after numbers.
