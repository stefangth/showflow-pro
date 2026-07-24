# Hire orders: wizard fill, CTA system, partial-success, agent signature, editable PDF copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Ship (in one PR) the wizard "copy duration to all dates", the hire-order CTA system (4 placements), multi-date partial-success, a per-org agent-signature image on issued PDFs, and a fully editable per-org PDF copy set with live preview.

**Architecture:** Reuse existing infra: `@react-pdf/renderer` already renders signature images (`<Image>`); `app_settings` + `resolveOrgSetting` hold all config; `generate-hire-orders` is the one edge endpoint with per-action auth. New UI is thin React on existing hooks. Migration-light (no schema changes expected).

**Tech Stack:** React 18 + TS + Tailwind + shadcn; @tanstack/react-query; Deno edge (`handle(req, deps)` DI); `@react-pdf/renderer` v4; Vitest + `supabaseFake`; Deno test + `makeFakeDeps`; pgTAP.

Spec: `docs/superpowers/specs/2026-07-24-hire-orders-wizard-cta-signature-copy-design.md`.

## Global Constraints

- Gating: `canManage = hasRole('admin')||hasRole('producer')`; action gate `useCan('generate_hire_orders')`; module gate `useFeature('hire_orders')` (default OFF). **Buttons disabled when feature off; the aggregate banner (B1) is hidden when off or count=0.** Edge stays `requireOrgRole` + `requireFeature` + capability, unchanged.
- Styling: semantic tokens only (`bg-*`, `text-*`, `border-*`, accent stops); **no hardcoded colors**; accent numbered stops take no opacity modifier.
- Copy: **no em/en dashes** in any user-facing string (house rule) — use period/colon/middot.
- Data: reads via `useQuery`, writes via `useMutation`; query keys hierarchical (`['hire-orders', ...]`); mutations invalidate the whole domain via `invalidateHireOrders`.
- Dual-home: any file mirrored in `supabase/functions/_shared/**` must stay byte-identical to its `src/**` twin; add/keep a byte-equality test.
- TDD: failing test first, co-located; data-access tested with `src/test/supabaseFake.ts`; edge with `makeFakeDeps`; never `vi.mock` the client; no `as any` (single `as unknown as Row` at the boundary).
- Everything ships behind `hire_orders` (dark by default).

---

## File structure

**Create**
- `src/lib/hireOrders/durationFill.ts` (+ `.test.ts`) — pure `copyDurationToAll`.
- `src/components/hireOrders/HireOrderReadyBanner.tsx` (+ `.test.tsx`) — shared banner.
- `src/lib/hireOrders/pdfCopy.ts` (+ `.test.ts`) — copy registry, `applyTokens`, `resolveHireOrderCopy`.
- `supabase/functions/_shared/pdfCopy.ts` — byte-identical mirror of the registry block.
- `src/components/settings/hireOrders/PdfCopyCard.tsx` (+ `.test.tsx`) — copy editor.
- `src/data/hireOrders.ts` additions tested in `src/data/hireOrders.readiness.test.ts`.

**Modify**
- `src/components/hireOrders/NewOrderWizard.tsx` — A (copy-to-all link), C2 (covered-date flag).
- `src/pages/ShowsBookingsPage.tsx` — B1 (banner + wizard mount), B2 (per-row cell).
- `src/components/shows/ShowDateDetailSheet.tsx` — B3 (top CTA).
- `src/components/shows/hireOrders/HireOrdersCard.tsx` — B4 (banner swap).
- `src/data/hireOrders.ts` + `src/hooks/useHireOrders.ts` — `fetchDatesReadyForHireOrder` / `useDatesReadyForHireOrder`.
- `supabase/functions/generate-hire-orders/index.ts` — C1 (partial-success), D1 (`upload-agent-signature`), D3 (resolve agent signature at issue/preview + snapshot), E3 (preview copy override + issue freezes copy).
- `supabase/functions/_shared/hireOrders.ts` — `RenderInput` (+ `agent_signature_data_url`, `copy`), `HireOrderLetterhead` (+ `agent_signature_path`), copy mirror import.
- `supabase/functions/_shared/hire-order-pdf/render.tsx` — D3 (producer `<Image>`), E2 (all literals → `copy.<key>`).
- `src/components/settings/hireOrders/LetterheadCard.tsx` — D2 (signature upload row); `Letterhead` type (+ `agent_signature_path`).
- `src/components/settings/hireOrders/HireOrdersTab.tsx` — mount `PdfCopyCard`.
- `src/data/hireOrders.ts` — `uploadAgentSignature` / `removeAgentSignature`, `previewHireOrderCopy`.
- `public/changelog.md` + regen `public/changelog.json`.

**No migration** is expected (D/E ride `app_settings` + the existing `hire-orders` bucket). If a bucket read-policy gap surfaces for the agent signature at render time, note it — render reads via the service role, so none should be needed.

---

## Part A — Wizard "Copy duration to all dates"

### Task A1: per-row copy-to-all
**Files:** Create `src/lib/hireOrders/durationFill.ts` (+ test); Modify `NewOrderWizard.tsx` (`dateSchedules` state area ~247, step-3 render ~848-855).
**Interfaces:** Produces `copyDurationToAll(schedules: Record<string, DateSchedule>, sourceId: string): Record<string, DateSchedule>` — returns a new map where every entry's `durationMin` equals `schedules[sourceId].durationMin`, sessions untouched; no-op if source missing.

- [ ] Step 1 (RED): test — given 3 schedules and a source with `durationMin:"90"`, result has all three `durationMin:"90"`, sessions unchanged; source-missing returns input unchanged.
- [ ] Step 2: run, verify fail.
- [ ] Step 3 (GREEN): implement the pure map.
- [ ] Step 4: run, pass.
- [ ] Step 5: wire into wizard — add `copyDurationToAll` import; under each date's duration input, when `parseDurationValue(schedule.durationMin) !== null` and `assignedDateIds.length > 1`, render `<Button variant="link" size="sm" onClick={() => { setDateSchedules(s => copyDurationToAll(s, dateId)); toast.success(...) }} aria-label={`Copy ${label}'s duration to all dates`}>Copy to all dates</Button>`. Component test: link hidden with one date / blank value; click fills others.
- [ ] Step 6: `npx vitest run src/lib/hireOrders/durationFill.test.ts src/components/hireOrders/NewOrderWizard.test.tsx` green; commit `feat: wizard copy duration to all dates`.

---

## Part B — CTA system

### Task B0: `HireOrderReadyBanner`
**Files:** Create `src/components/hireOrders/HireOrderReadyBanner.tsx` (+ test).
**Interfaces:** Produces `HireOrderReadyBanner({ title, description, ctaLabel, onCta, disabled?, icon? }: HireOrderReadyBannerProps)`. Card: `rounded-xl border bg-accent-50` (or a semantic soft token — verify a suitable token exists; else use `bg-muted`), icon tile, title (`font-semibold`), description (`text-muted-foreground`), primary `Button` right-aligned, `disabled` forwarded.
- [ ] RED: test renders title/description/ctaLabel; `onCta` fires on click; `disabled` disables the button; asserts no "Preview terms" text.
- [ ] GREEN: implement with semantic tokens only.
- [ ] Verify + commit `feat: HireOrderReadyBanner component`.

### Task B1-data: readiness query
**Files:** Modify `src/data/hireOrders.ts` (+ `src/data/hireOrders.readiness.test.ts`), `src/hooks/useHireOrders.ts`.
**Interfaces:** Produces `fetchDatesReadyForHireOrder(client, orgId): Promise<{ readyIds: string[]; orderByDate: Record<string, HireOrderLite> }>` — dates with `show_dates.status='fully_filled'` minus any covered by a non-void `hire_orders` (legacy `show_date_id` or `hire_order_dates.show_date_id`); `orderByDate` maps a date → its active order (for the B2 chip). Hook `useDatesReadyForHireOrder(orgId)` key `['hire-orders','ready',orgId]`.
- [ ] RED: `supabaseFake` test — fully_filled dates minus void-order and active-order-covered ones; aggregate child coverage excluded too.
- [ ] GREEN: implement (two selects: fully_filled show_dates for org; non-void hire_orders + hire_order_dates for org; compute set difference in TS).
- [ ] Verify + commit `feat: fetchDatesReadyForHireOrder`.

### Task B1: aggregate banner on ShowsBookingsPage
**Files:** Modify `src/pages/ShowsBookingsPage.tsx` (header ~272; add `NewOrderWizard` mount; pull `currentOrg` from `useAuth`).
- [ ] Add `useFeature('hire_orders')`, `useCan('generate_hire_orders')`, `useDatesReadyForHireOrder(orgId)`, wizard `open` state.
- [ ] Render `HireOrderReadyBanner` above the table only when `featureOn && readyIds.length>0`: title `` `${n} date${n===1?'':'s'} ${n===1?'is':'are'} fully filled. Ready for hire order${n===1?'':'s'}.` ``, description "Create the orders to confirm the engagements and send them for countersignature.", cta "Generate hire orders", `onCta` opens wizard, `disabled={!can}`.
- [ ] Component test: banner shown when featureOn+count>0, hidden when off or 0; CTA opens wizard.
- [ ] Verify + commit `feat: bookings aggregate hire-order banner`.

### Task B2: per-row status-column CTA/chip
**Files:** Modify `src/pages/ShowsBookingsPage.tsx` (the dates list/table rows).
- [ ] For each date row add a "Hire order" cell: if `!featureOn` → disabled "Generate hire order"; else if `orderByDate[id]` → `<HireOrderStatusBadge status=...>` chip; else if `readySet.has(id)` (fully_filled, no order) → `<Button size="sm" variant="outline" disabled={!can} onClick={() => draft(id)}>Generate hire order</Button>` where `draft` = `useHireOrderAction().mutate({action:'draft',org_id,show_date_id:id})`; else `—`.
- [ ] Component test: cell flips CTA↔chip↔dash by state; CTA fires draft.
- [ ] Verify + commit `feat: per-row generate-hire-order cell`.

### Task B3: sheet top CTA
**Files:** Modify `src/components/shows/ShowDateDetailSheet.tsx` (header ~ where title renders).
- [ ] When `useFeature('hire_orders')` and `showDate.status==='fully_filled'` and no active order for the date (reuse `useHireOrdersForDate`), show a header `Button size="sm"` "Generate hire order" (`disabled={!can}`) → draft action for `showDate.id`.
- [ ] Component test: visibility + gating + fires draft.
- [ ] Verify + commit `feat: sheet top generate CTA`.

### Task B4: HireOrdersCard banner upgrade
**Files:** Modify `src/components/shows/hireOrders/HireOrdersCard.tsx:138-153`.
- [ ] Replace the inline banner with `HireOrderReadyBanner`. Single-date variant: title fully_filled → "This date is fully filled. Ready for a hire order." else "Generate for confirmed artists."; description (fully_filled + single confirmed artist) → `` `Generate the order to confirm the engagement and send it to ${artistName} for countersignature.` `` where `artistName = confirmed[0]?.artist?.name`; multiple → "…send it to the confirmed cast for countersignature."; cta "Generate hire order" → existing `handleGenerate`; `disabled={action.isPending||!canGenerate}`.
- [ ] Update the existing `HireOrdersCard.test.tsx` assertions to the new copy (no "Preview terms"; artist name shown).
- [ ] Verify + commit `feat: upgrade hire-orders card banner`.

---

## Part C — Partial-success on covered dates

### Task C1: edge draft-batch pre-filter
**Files:** Modify `supabase/functions/generate-hire-orders/index.ts` (`draftBatchArtist` ~1101; `DraftBatchResult`/outcome types; add a coverage query helper).
**Interfaces:** Add `skipped_dates?: string[]` to the created outcome; `draftBatch` result becomes `{ created: Array<{id:string; skipped_dates:string[]}> | string[] , ... }` — keep `created: string[]` for wire compatibility and add a parallel `partial: Array<{id, skipped_dates}>`? **Decision:** keep `created: string[]`; add `date_conflicts: Array<{artist_id, dropped: string[]}>` to the response so the wizard can warn. Covered = a non-void `hire_orders` whose `show_date_id` or `hire_order_dates.show_date_id` ∈ the artist's requested set.
- [ ] RED (DI): artist with dates [d1,d2,d3] where d2 already covered → order created for [d1,d3]; response `created:[id]`, `date_conflicts:[{artist_id, dropped:[d2]}]`. Artist with all covered → `skipped:[{artist_id,reason:'exists'}]`, no create. RPC mid-flight conflict still → `exists`.
- [ ] GREEN: in `draftBatchArtist`, query the artist's active coverage for the requested dates; subtract; if empty → skip `exists`; else call RPC with the remainder and, on success, return dropped dates. Aggregate into `date_conflicts`.
- [ ] Update `useHireOrders.ts` `draft-batch` toast to surface `date_conflicts` ("Created for N of M dates; K already had an order").
- [ ] Run whole `supabase/functions/` Deno suite; commit `feat: multi-date partial success on covered dates`.

### Task C2: wizard step-1 covered-date flag
**Files:** Modify `NewOrderWizard.tsx` (step-1 assignment matrix ~700-741).
- [ ] Load `useDatesReadyForHireOrder(orgId)` (or a per-artist coverage query); in the artist×date matrix, mark a cell whose (artist,date) already has an active order with a subtle "has order" badge + disabled toggle.
- [ ] Component test: covered cell shows the flag and can't be selected.
- [ ] Verify + commit `feat: wizard flags already-ordered dates`.

---

## Part D — Agent signature (one image per org)

### Task D1: `upload-agent-signature` edge action
**Files:** Modify `generate-hire-orders/index.ts` (new action in `handle`), `_shared/hireOrders.ts` (`HireOrderLetterhead` + `agent_signature_path?: string|null`).
**Interfaces:** `POST { action:'upload-agent-signature', org_id, signature_png }` (base64 `data:image/png;base64,...`) and `{ action:'remove-agent-signature', org_id }`. Admin-only (`requireOrgRole(org_id,['admin'])`) + `requireFeature`. Reuse `sign`'s PNG validation (prefix, magic bytes, `MAX_SIGNATURE_PNG_CHARS`). Store at `${org}/agent-signature.png` in `BUCKET`; write `agent_signature_path` into `hire_order_letterhead` (read-merge-write the setting); return `{ path, url }` (signed URL). Remove: delete object + null the path.
- [ ] RED (DI): valid PNG → uploaded at the org path + setting updated + returns url; non-PNG/oversize → 400; non-admin → 403; feature off → gated. Remove clears path.
- [ ] GREEN: implement; route in `handle` BEFORE the draft/issue capability gate (it's admin-only, its own check).
- [ ] Deno suite green; commit `feat: agent-signature upload edge action`.

### Task D2: LetterheadCard upload UI
**Files:** Modify `src/components/settings/hireOrders/LetterheadCard.tsx` (+ `Letterhead` type + `defaults.ts`), `src/data/hireOrders.ts` (`uploadAgentSignature`/`removeAgentSignature`).
- [ ] Add `agent_signature_path` to `Letterhead`. Add an "Agent signature" row: file input (PNG only) → `FileReader.readAsDataURL` → `uploadAgentSignature(supabase,{org_id,signature_png})` → show returned image preview + "Remove" button (`removeAgentSignature`). Uses `useMutation`; toast on success/error.
- [ ] Component test (faked action): pick file → preview appears; remove → cleared.
- [ ] Verify + commit `feat: agent-signature upload in letterhead settings`.

### Task D3: render the agent signature on issued PDFs
**Files:** Modify `_shared/hireOrders.ts` (`RenderInput` + `agent_signature_data_url?: string`; letterhead already has the path), `render.tsx` (producer signature block ~524-529), `generate-hire-orders/index.ts` (`issueOne` ~1372, `previewOrder` ~1780, snapshot freeze).
- [ ] `issueOne`/`previewOrder`: after resolving letterhead, if `agent_signature_path` set, download the PNG from storage → base64 data URL → pass as `agent_signature_data_url`. Freeze it into `issue_snapshot` so the countersigned re-render reproduces it.
- [ ] `render.tsx`: producer block renders `<Image style={s.sigMarkImage} src={agent_signature_data_url}>` above the ruled line when present, else the current blank line.
- [ ] RED (render/DI): producer block draws `<Image>` when data url present, blank when absent; issue freezes the signature into the snapshot.
- [ ] GREEN; Deno suite green; commit `feat: render agent signature on issued PDFs`.

---

## Part E — Editable PDF copy

### Task E1: copy registry + resolver + tokens (dual-home)
**Files:** Create `src/lib/hireOrders/pdfCopy.ts` (+ test) and byte-identical `supabase/functions/_shared/pdfCopy.ts`; add byte-equality test (mirror the terms/entitlements pattern).
**Interfaces:** `type PdfCopyKey` (enum of ~40 keys grouped by section — enumerate from render.tsx map: header, parties, facts, sections, fees, terms, signatures, watermark, footer, certificate); `HIRE_ORDER_COPY_DEFAULTS: Record<PdfCopyKey,string>` (defaults verbatim from render.tsx, interpolated ones as `{{token}}` templates); `applyTokens(template, values: Record<string,string|number>): string`; `resolveHireOrderCopy(overrides?: Partial<Record<PdfCopyKey,string>>): Record<PdfCopyKey,string>` (override-over-default, blank→default); `ALLOWED_TOKENS: Record<PdfCopyKey, string[]>`.
- [ ] RED: `resolveHireOrderCopy` precedence; `applyTokens` substitutes known tokens, leaves unknown intact; em-dash validator flags a `—`.
- [ ] GREEN; byte-equality test passes.
- [ ] Verify + commit `feat: hire-order PDF copy registry`.

### Task E2: renderer reads copy
**Files:** Modify `render.tsx` (every hardcoded literal → `copy.<key>` / `applyTokens(copy.<key>, {...})`), `_shared/hireOrders.ts` (`RenderInput.copy: Record<PdfCopyKey,string>`).
- [ ] Add `copy` to `RenderInput`; thread a `resolveHireOrderCopy(overrides)` result from callers. Replace each literal (per the spec's enumerated list) with the keyed lookup.
- [ ] RED: render test — with an override for `terms_heading`, the PDF tree shows it; defaults otherwise. (Assert on the react-pdf element tree, same style as existing render tests.)
- [ ] GREEN; commit `feat: render hire-order PDF from copy dictionary`.

### Task E3: preview override + issue freeze
**Files:** Modify `generate-hire-orders/index.ts` (`previewOrder` accepts `copy_overrides`; `issueOne` resolves + freezes copy into snapshot; sign path reads snapshot copy).
- [ ] `previewOrder`: read `hire_order_copy` setting, merge any request `copy_overrides`, pass to renderer. `issueOne`: resolve `hire_order_copy`, pass to renderer, and store resolved copy in `issue_snapshot.copy`. `signOrder`: use snapshot copy (fallback to live resolve for legacy).
- [ ] RED (DI): preview honors an ad-hoc override; issue writes `copy` into the snapshot; sign uses it.
- [ ] GREEN; Deno suite green; commit `feat: PDF copy override in preview + snapshot freeze`.

### Task E4: PdfCopyCard settings UI
**Files:** Create `src/components/settings/hireOrders/PdfCopyCard.tsx` (+ test); Modify `HireOrdersTab.tsx` (mount it), `src/data/hireOrders.ts` (`previewHireOrderCopy`).
- [ ] Render every `PdfCopyKey` grouped by section, each an `Input`/`Textarea` prefilled with the effective value, a "Reset to default" button, and inline `{{token}}` help. "Preview" button calls the `preview` action with the current (unsaved) `copy_overrides` and opens the returned PDF. "Save" upserts `hire_order_copy`. Soft-validate no em-dashes.
- [ ] Component test: edit a key → save upserts; reset restores default; preview passes overrides.
- [ ] Verify + commit `feat: PDF copy editor settings card`.

---

## Finalization

### Task F1: changelog
- [ ] Add to the current changelog block (same-day fold if today, else a new dated block): `### New` bullets for the wizard fill, the generate-from-anywhere CTAs, agent signature, editable PDF copy; `### Improved` for multi-date partial success. No em-dashes. Regen: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
- [ ] Commit `docs: changelog for hire-order wizard/CTA/signature/copy`.

### Task F2: full verification + PR
- [ ] `npx vitest run` (all unit); `deno test --allow-all --node-modules-dir=none supabase/functions/` (all edge); `npm run lint`; `npx tsc --noEmit` (or the repo typecheck); pgTAP unaffected (no schema change) — spot-run `hire_orders.sql` via execute_sql only if a policy was touched.
- [ ] Push branch; open ONE PR to `main` titled "Hire orders: wizard fill, generate-from-anywhere CTAs, agent signature, editable PDF copy"; body summarizing A–E + test evidence.
- [ ] Poll CI to green; hand to user for review/approval (repo requires a review approval to merge).

---

## Self-review notes
- Spec coverage: A (Task A1), B (B0–B4), C (C1–C2), D (D1–D3), E (E1–E4), all mapped.
- Open-decision defaults locked: B2 immediate draft; D letterhead-stored + admin-only; banner copy de-em-dashed; E `{{token}}` + live preview.
- Shared-file sequencing: C1/D1/D3/E3 all touch `generate-hire-orders/index.ts` and D3/E2 touch `render.tsx` — execute these **sequentially** (not parallel subagents) to avoid conflicts; A/B/D2/E4 are frontend-isolated and safe to parallelize if desired.
