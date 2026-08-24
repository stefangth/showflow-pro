# Get Running v3 Wizard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/get-running` v3 wizard scale to its own width, read consistently across all 16 steps, link "Read more" at real documentation, colour the phase icon rail like the status dots, keep the board alive inside Settings once it retires, and stop "How this org works" sharing an icon with "Get running".

**Architecture:** Five independent seams. (1) `WizardShell` becomes a CSS *container* and its body grid keys off the wizard's own width instead of the viewport, because the wizard is ~316px narrower than the window. (2) Step chrome (heading, sub, primary footer action) moves OUT of the eight v3-owned step bodies and INTO the shell/registry, so the eight bodies reused from v1 and the setup rails get the same chrome without being edited. (3) A new `STEP_HELP` map plus `?item=`/`?q=` support on `HelpPage` turns each guide's "Read more" into a real help deep link. (4) `PhaseIconRail` reads `TONES` instead of `bg-primary`. (5) `GetRunningBoardV3`'s retired branch becomes context-aware.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4 + `@tailwindcss/container-queries`, react-i18next, Vitest + Testing Library.

**Spec:** No separate spec doc. The requirements are the owner's five-item punch list plus the audit recorded in this plan's "Audit findings" section below, both agreed in session on 2026-08-24.

## Global Constraints

- No em or en dashes in any user-facing copy, EN or DE. `src/i18n/copyLint.test.ts` fails the build. Use a period, a colon, or "to".
- German is informal Du, and reuses `src/i18n/terms.ts` `TERMS` for domain nouns. Never re-translate a term inline.
- Every EN key added to `src/i18n/locales/en/*.json` MUST have a DE twin at the identical path. `src/i18n/keyParity.test.ts` fails CI on any gap.
- No raw values outside `src/components/ui`: no hex, no `text-[13px]`, no `rounded-[10px]`, no bracket alpha. `eslint/ui-conventions.js` runs at `--max-warnings 0`.
- Status colour comes from `TONES` (`src/components/ui/tones.tsx`). Never a local tone map.
- Numbers render through `<Metric>`. Uppercase text renders through `<Eyebrow>`.
- Tests import the real module. Never re-implement production logic in a test.
- Run `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, and `npx vitest run` before every commit.

## Audit findings this plan closes

Measured on the local stack at 2026-08-24 (`Fresh Org`, an empty org, and `Bootstrap Org`).

**Responsive.** `WizardShell`'s body is `lg:grid-cols-[216px_minmax(0,1fr)_268px]`. `lg` is a 1024px *viewport* breakpoint, but the wizard renders inside the app content area, measured at exactly `viewport - 316px` (sidebar + page padding). At viewport 1024 the wizard is 708px and the computed columns are `216px 222px 268px`: the read-only guide is wider than the editor. Real overflow at that width, from a `scrollWidth > clientWidth` sweep: the "Field mapping" card overflows by 8px, its `grid-cols-2` body by 8px, each "Not mapped" select by 8px, the `Session 3 / optional` label cell by 25px. Below 1024 the layout stacks and is clean; at 375 there is no horizontal overflow anywhere. The broken band is viewport 1024 to ~1180.

**Chrome consistency.** Exactly the eight v3-owned bodies (`SourceStep`, `ConnectStep`, `MapStep`, `CitiesStep`, `ProductionsStep`, `SkillsStep`, `FeeStep`, `DocumentStep`) render their own `text-title-sm` heading and portal their own footer action. The eight steps whose bodies are reused from v1 / the setup rails (`artists`, `coverage`, `flow`, `timing`, `team`, `letterhead`, `terms`, `countersign`) render neither, so half the wizard opens with no title and no primary action.

**Copy and logic.** `MappingTab` prints `headerPrefix + <strong>{tableName}</strong> + headerSuffix`; with no table selected that renders "reads from one column in ." with a dangling period. `ConnectStep` with no source chosen shows the heading "Connect Airtable" over the body "By hand needs no connection." The `map` step is reachable with nine required rows and an empty column list before Airtable is connected. The `cities` guide still promises "New dates synced from Airtable inherit their city automatically" after the org picked By hand. The `coverage` step stacks `LadderPanelBody` and `EligibilityPanelBody`, each rendering its own full cast list and its own `UnlocksNote`, so the same two casts and two "WHAT THIS UNLOCKS" panels appear twice in one view. `ProductionsStep` renders an "Add a production" button in its header AND as the `EmptyState` action, and `EmptyState size="block"` sets its title at 22px, larger than the step heading above it.

**Links.** All 16 guide "Read more about X" links resolve through `stepFeatureLink(key)`, which is the step's SETTINGS home, not documentation: "Read more about the Airtable connection" goes to `/dates`. `HelpPage` has no deep-link support at all.

**Rail.** `PhaseIconRail` paints a done step `bg-primary text-primary-foreground` (violet) while `StepDot` in the same wizard paints done as `TONES.confirmed` (green).

**Retired board.** `RetiredBoardV3` replaces the entire board with a summary card in BOTH contexts, so the phase icon rail and every wizard become unreachable once setup completes.

**Icon.** `SettingsPage`'s nav gives both `how-it-works` and `get-running` the `Rocket` icon, adjacent in the same group. `Rocket` is also the sidebar identity for Get running (`src/components/layout/navItems.ts:35`), so Rocket stays with Get running.

---

### Task 1: Wizard body responds to its own width

**Files:**
- Modify: `package.json`, `package-lock.json` (add `@tailwindcss/container-queries`)
- Modify: `tailwind.config.ts:159` (register the plugin)
- Modify: `src/components/getRunning/v3/WizardShell.tsx` (root gets `@container`; body grid + aside get container variants)
- Test: `src/components/getRunning/v3/WizardShell.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the wizard root carries the class `@container`; the body grid carries `@2xl:grid-cols-[minmax(180px,216px)_minmax(0,1fr)]` and `@5xl:grid-cols-[minmax(180px,216px)_minmax(0,1fr)_minmax(240px,268px)]`; the guide `<aside>` carries `@2xl:col-span-2 @5xl:col-span-1`. Later tasks do not depend on these names.

- [ ] **Step 1: Write the failing test**

Add to `src/components/getRunning/v3/WizardShell.test.tsx`:

```tsx
it("keys its body layout off the wizard's own width, not the viewport", () => {
  const { container } = renderShell();           // existing helper in this file
  const root = container.querySelector("[data-testid='wizard-shell']");
  expect(root?.className).toContain("@container");

  const grid = container.querySelector("nav[aria-label='Steps']")?.parentElement;
  // No viewport-keyed `lg:` column template survives: at viewport 1024 the wizard is
  // only ~708px wide, which is what crushed the editor column to 222px.
  expect(grid?.className).not.toMatch(/\blg:grid-cols-/);
  expect(grid?.className).toContain("@2xl:grid-cols-");
  expect(grid?.className).toContain("@5xl:grid-cols-");
});

it("drops the guide below the editor at the two-column size", () => {
  const { container } = renderShell();
  const aside = container.querySelector("aside");
  expect(aside?.className).toContain("@2xl:col-span-2");
  expect(aside?.className).toContain("@5xl:col-span-1");
});
```

If `renderShell` does not exist in that file, write it from the existing tests' render call and reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/WizardShell.test.tsx`
Expected: FAIL, `@container` not found in root className.

- [ ] **Step 3: Install and register the plugin**

```bash
npm install -D @tailwindcss/container-queries
```

In `tailwind.config.ts`, add the import beside the existing `animate`/`typography` imports and register it:

```ts
import containerQueries from "@tailwindcss/container-queries";
// ...
plugins: [animate, typography, containerQueries],
```

- [ ] **Step 4: Rework the shell layout**

In `src/components/getRunning/v3/WizardShell.tsx`:

Root element gains `@container` and a testid:

```tsx
<div
  data-testid="wizard-shell"
  className="@container flex w-full flex-col overflow-hidden rounded-l border border-border bg-card shadow-elev2"
>
```

Replace the body grid's className. Delete the old `lg:` comment block and write:

```tsx
{/* The wizard is roughly 316px narrower than the viewport (sidebar + page padding),
    so a viewport breakpoint lies about how much room this grid actually has: at
    viewport 1024 the three fixed/fluid columns resolved to 216px / 222px / 268px and
    the read-only guide came out wider than the editor. These are CONTAINER queries
    against the shell itself, so the same wizard lays out correctly on the page, in
    the narrower Settings mirror, and at any sidebar state.
      < 672px  one column, everything stacked
      >= 672px rail + editor, guide drops full width underneath
      >= 1024px the designed three columns */}
<div className="grid grid-cols-1 items-start gap-0 @2xl:grid-cols-[minmax(180px,216px)_minmax(0,1fr)] @5xl:grid-cols-[minmax(180px,216px)_minmax(0,1fr)_minmax(240px,268px)]">
```

Rail borders switch on the same variants:

```tsx
className="flex flex-col gap-0.5 border-b border-border p-3 @2xl:border-b-0 @2xl:border-r"
```

Guide aside spans both columns in the two-column size and returns to its own column in the three-column size:

```tsx
<aside className="flex flex-col gap-2 border-t border-border p-4 @2xl:col-span-2 @5xl:col-span-1 @5xl:border-t-0 @5xl:border-l">
```

- [ ] **Step 5: Run the test suite**

Run: `npx vitest run src/components/getRunning/v3/`
Expected: PASS. Then `npm run lint` and `npx tsc -p tsconfig.app.json --noEmit`.

- [ ] **Step 6: Verify in the browser**

Start the dev server via the preview tool, open `/get-running`, select the Map step, and at viewport 1024 confirm via `getComputedStyle(grid).gridTemplateColumns` that there are two columns with the editor at ~490px, not three with the editor at 222px. Re-run the `scrollWidth > clientWidth` sweep and confirm it returns an empty array.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts src/components/getRunning/v3/WizardShell.tsx src/components/getRunning/v3/WizardShell.test.tsx
git commit -m "size the get-running wizard against its own width, not the viewport"
```

---

### Task 2: Mapping table stops overflowing and stops printing a dangling period

**Files:**
- Modify: `src/components/settings/airtable/MappingTab.tsx:47-60` (header sentence + counter), `:63` (grid template)
- Modify: `src/i18n/locales/en/settingsAirtable.json`, `src/i18n/locales/de/settingsAirtable.json` (new `mappingTab2.headerNoTable`)
- Test: `src/components/settings/airtable/MappingTab.test.tsx` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `mappingTab2.headerNoTable`, a complete sentence used when `tableName` is empty. No other task reads it.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MappingTab } from "./MappingTab";

const base = {
  tableName: "", fields: [], fieldMap: {}, onSetField: () => {},
  mapped: 0, total: 9, optionNames: [], unboundFields: [],
  onAddAllCustom: () => {}, canWrite: true,
};

it("never prints a dangling period when no table is selected", () => {
  render(<MappingTab {...base} />);
  expect(document.body.textContent).not.toContain("in .");
});

it("names the table when there is one", () => {
  render(<MappingTab {...base} tableName="Shows" />);
  expect(screen.getByText("Shows")).toBeInTheDocument();
});
```

Match the real prop names by reading `MappingTab`'s signature first; the object above is the shape as of this plan.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/airtable/MappingTab.test.tsx`
Expected: FAIL on the first assertion, "in ." is present.

- [ ] **Step 3: Fix the sentence and the grid**

Add to both locale files under `mappingTab2`:

```json
"headerNoTable": "Every ShowFlow field reads from one column in your table. Catalog links are keyed on Program and Sub program."
```

DE:

```json
"headerNoTable": "Jedes ShowFlow Feld liest aus genau einer Spalte deiner Tabelle. Katalog Verknüpfungen laufen über Programm und Unterprogramm."
```

In `MappingTab.tsx`, replace the header paragraph:

```tsx
<p className="mt-1 text-control text-muted-foreground">
  {tableName ? (
    <>
      {t('mappingTab2.headerPrefix')}{' '}
      <strong className="font-medium text-foreground">{tableName}</strong>
      {t('mappingTab2.headerSuffix')}
    </>
  ) : (
    // With no table picked the interpolated name is empty and the prefix/suffix pair
    // renders "... in ." Say the same thing without naming a table instead.
    t('mappingTab2.headerNoTable')
  )}
</p>
```

Let the header wrap rather than overflow, and let the counter shrink:

```tsx
<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5 border-b border-border">
  <div className="min-w-0">
```

Give the two-column body a label column that cannot squeeze the control column to nothing:

```tsx
{/* The label column takes what it needs down to 120px and the control column keeps
    the rest, so a narrow host (the get-running wizard at its two-column size) shows
    "Not mapped" rather than "No...". */}
<div className="grid grid-cols-[minmax(120px,0.9fr)_minmax(0,1.1fr)]">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/airtable/ src/components/getRunning/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/airtable/ src/i18n/locales/en/settingsAirtable.json src/i18n/locales/de/settingsAirtable.json
git commit -m "stop the field mapping header printing an empty table name"
```

---

### Task 3: The shell owns the step heading and the footer action

**Files:**
- Modify: `src/components/getRunning/v3/WizardFooterContext.ts` (context value becomes an object)
- Create: `src/components/getRunning/v3/WizardFooterAction.tsx`
- Modify: `src/components/getRunning/v3/WizardShell.tsx` (render heading + default Continue)
- Modify: `src/components/getRunning/v3/steps/{SourceStep,ConnectStep,MapStep,CitiesStep,ProductionsStep,SkillsStep,FeeStep,DocumentStep}.tsx` (drop own heading, use `WizardFooterAction`)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` (`body.<key>.heading`/`sub` for the eight missing steps; `wizard.continue`)
- Test: `src/components/getRunning/v3/WizardShell.test.tsx`, `src/components/getRunning/v3/stepRegistryV3.test.tsx`

**Interfaces:**
- Consumes: Task 1's `WizardShell` markup.
- Produces:
  - `WizardFooterSlot = { el: HTMLDivElement | null; register: (has: boolean) => void }`, the new `WizardFooterContext` value (was `HTMLDivElement | null`).
  - `<WizardFooterAction>{node}</WizardFooterAction>`: portals `node` into the shell footer and tells the shell to suppress its default Continue. Renders `node` inline when there is no slot.
  - `body.<stepKey>.heading` and `body.<stepKey>.sub` exist for all 16 step keys.

- [ ] **Step 1: Write the failing test**

In `WizardShell.test.tsx`:

```tsx
it("titles every step from the shell, including bodies that render no heading", () => {
  const { container } = renderShell({ activeKey: "team" });  // a reused body, no heading of its own
  expect(screen.getByRole("heading", { name: /invite your production team/i })).toBeInTheDocument();
});

it("offers a Continue in the footer when the body portals no action of its own", () => {
  renderShell({ activeKey: "team" });
  const footer = screen.getByTestId("wizard-footer");
  expect(within(footer).getByRole("button", { name: /continue/i })).toBeInTheDocument();
});

it("suppresses its own Continue when the body portals one", () => {
  renderShell({ activeKey: "team", children: <WizardFooterAction><button>Save timing</button></WizardFooterAction> });
  const footer = screen.getByTestId("wizard-footer");
  expect(within(footer).getByRole("button", { name: "Save timing" })).toBeInTheDocument();
  expect(within(footer).queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/WizardShell.test.tsx`
Expected: FAIL, no heading rendered for `team`.

- [ ] **Step 3: Widen the footer context**

`src/components/getRunning/v3/WizardFooterContext.ts`:

```ts
import { createContext } from "react";

export interface WizardFooterSlot {
  /** The footer's portal target, null until the footer has mounted. */
  el: HTMLDivElement | null;
  /** A body calls this true on mount and false on unmount so the shell knows whether to
   *  render its own generic Continue. Without it the shell cannot tell an empty slot from
   *  one a portal is about to fill, and every step would show two primary buttons. */
  register: (has: boolean) => void;
}

export const WizardFooterContext = createContext<WizardFooterSlot | null>(null);
```

- [ ] **Step 4: Add the action wrapper**

Create `src/components/getRunning/v3/WizardFooterAction.tsx`:

```tsx
import { useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WizardFooterContext } from "./WizardFooterContext";

/**
 * A step body's own primary action, rendered in the wizard footer beside "Finish later".
 * Replaces the `footerSlot ? createPortal(btn, footerSlot) : btn` idiom that eight step
 * bodies each carried a copy of, and additionally tells the shell to stand its generic
 * Continue down so the footer never shows two primary buttons.
 */
export function WizardFooterAction({ children }: { children: ReactNode }): JSX.Element {
  const slot = useContext(WizardFooterContext);
  const register = slot?.register;
  useEffect(() => {
    register?.(true);
    return () => register?.(false);
  }, [register]);
  return slot?.el ? createPortal(children, slot.el) : <>{children}</>;
}
```

- [ ] **Step 5: Render heading and default Continue in the shell**

`WizardShell` gains an `onNext` prop (the board passes `handleStepDone`) and this state:

```tsx
const [hasBodyAction, setHasBodyAction] = useState(false);
const register = useCallback((has: boolean) => setHasBodyAction(has), []);
const footerValue = useMemo(() => ({ el: footerSlotEl, register }), [footerSlotEl, register]);
```

The middle column renders the heading above `children`:

```tsx
<div className="min-w-0 p-4">
  {activeStep && (
    <div className="mb-4 space-y-1">
      <h2 className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
        {t(`body.${activeStep.key}.heading`)}
      </h2>
      <p className="text-xs text-muted-foreground">{t(`body.${activeStep.key}.sub`)}</p>
    </div>
  )}
  <WizardFooterContext.Provider value={footerValue}>{children}</WizardFooterContext.Provider>
</div>
```

The footer gains `data-testid="wizard-footer"` and the conditional default:

```tsx
<div ref={setFooterSlotEl} className="flex items-center gap-2" />
{!hasBodyAction && (
  <Button type="button" size="sm" onClick={onNext}>
    {t("wizard.continue")}
  </Button>
)}
```

`hasBodyAction` must reset when the open step changes, so a body that portals nothing does not inherit the previous body's registration. Reset it in the same effect that already watches `activeKey`, or key the middle column on `activeStep.key`.

- [ ] **Step 6: Strip the eight bodies**

In each of `SourceStep`, `ConnectStep`, `MapStep`, `CitiesStep`, `ProductionsStep`, `SkillsStep`, `FeeStep`, `DocumentStep`:

- Delete the `<div className="space-y-1">` heading block that renders `body.<key>.heading` / `body.<key>.sub`. `ProductionsStep` keeps its header row for the Add buttons; only the text block goes.
- Replace `const footerSlot = useContext(WizardFooterContext);` and the trailing `{footerSlot ? createPortal(button, footerSlot) : button}` with `<WizardFooterAction>{button}</WizardFooterAction>`. Drop the now-unused `useContext`/`createPortal` imports.

`ConnectStep` and `MapStep` have a `sheet` heading variant. Their heading is now the shell's, so their variant keys move in Task 4; for this task point the shell at the non-sheet key and let Task 4 make it source-aware.

- [ ] **Step 7: Add the missing copy**

In `src/i18n/locales/en/getRunningV3.json`, add `wizard.continue: "Continue"` and a `heading`/`sub` pair under `body` for `artists`, `coverage`, `flow`, `timing`, `team`, `letterhead`, `terms`, `countersign`. Use the step's existing rail title as the heading and its rail hint as the starting point for the sub, then tighten. Example:

```json
"team": { "heading": "Invite your production team", "sub": "Producers can take bookings off your plate once asks start landing." },
"timing": { "heading": "Confirm the ask timing", "sub": "When asks go out, and how long artists have to answer." }
```

Mirror every key into `src/i18n/locales/de/getRunningV3.json`, Du form, TERMS vocabulary, no dashes.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/components/getRunning/ src/i18n/`
Expected: PASS, including `keyParity.test.ts` and `copyLint.test.ts`.

- [ ] **Step 9: Verify in the browser**

Click all 16 steps and confirm each opens with a heading, a sub line, and exactly one primary button in the footer.

- [ ] **Step 10: Commit**

```bash
git add src/components/getRunning/v3 src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "give every get-running step a heading and one footer action"
```

---

### Task 4: Connect and Map tell the truth about the chosen source

**Files:**
- Modify: `src/components/getRunning/v3/stepRegistryV3.tsx` (resolve a source-aware heading key)
- Modify: `src/components/getRunning/v3/WizardShell.tsx` (accept an optional heading override)
- Modify: `src/components/getRunning/v3/steps/ConnectStep.tsx` (no-source branch)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`
- Test: `src/components/getRunning/v3/steps/ConnectStep.test.tsx`

**Interfaces:**
- Consumes: Task 3's shell-owned heading.
- Produces: `WizardShell` accepts `headingKey?: string` and `subKey?: string`, defaulting to `body.<activeStep.key>.heading` / `.sub`. `GetRunningBoardV3` passes what `stepHeadingKeys(step.key, source)` returns.

- [ ] **Step 1: Write the failing test**

```tsx
it("does not title itself Connect Airtable before a source is chosen", async () => {
  renderStep({ source: null });
  expect(screen.queryByText(/connect airtable/i)).not.toBeInTheDocument();
  expect(screen.getByText(/pick where your dates come from first/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/steps/ConnectStep.test.tsx`
Expected: FAIL, "Connect Airtable" is present.

- [ ] **Step 3: Implement**

Add a small resolver next to the registry:

```tsx
/** The connect and map steps read differently per source, and the heading now lives on the
 *  shell, which cannot see the org's source. Resolve the key here, where the registry
 *  already holds `orgId` and can read `useDatesSource`. */
export function stepHeadingKeys(key: GetRunningStepKey, source: DatesSource | null): { headingKey: string; subKey: string } {
  if ((key === "connect" || key === "map") && source === "sheet") {
    return { headingKey: `body.${key}.sheet.heading`, subKey: `body.${key}.sheet.sub` };
  }
  if (key === "connect" && source == null) {
    return { headingKey: "body.connect.none.heading", subKey: "body.connect.none.sub" };
  }
  return { headingKey: `body.${key}.heading`, subKey: `body.${key}.sub` };
}
```

New EN copy:

```json
"none": { "heading": "Connect your dates source", "sub": "Pick where your dates come from first, then come back and connect it." }
```

DE:

```json
"none": { "heading": "Verbinde deine Datenquelle", "sub": "Wähle zuerst, woher deine Termine kommen, dann verbinde die Quelle hier." }
```

In `ConnectStep`, the `else` branch (neither airtable nor sheet) currently renders `body.connect.manual` ("By hand needs no connection..."). Split it: render `body.connect.manual` only when `source === "manual"`, and a new `body.connect.pickSourceFirst` when `source == null`.

Gate `map`: when the source is Airtable and `!connected`, `MapStep` renders a short "Connect Airtable first" note with a button that selects the `connect` step, instead of nine unfillable rows. `MapStep` already receives `onDone`; add an `onGoToStep?: (key: GetRunningStepKey) => void` prop wired from the registry to the board's `setSelectedStep`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/getRunning/v3/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3 src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "make the connect and map steps read to their chosen source"
```

---

### Task 5: Coverage stops repeating itself, guides stop promising Airtable, empty states stop shouting

**Files:**
- Modify: `src/components/getRunning/v3/stepRegistryV3.tsx` (coverage composition)
- Modify: `src/components/getRunning/panels/LadderPanelBody.tsx:309-316`, `src/components/getRunning/panels/EligibilityPanelBody.tsx:335-339` (accept `showUnlocks`)
- Modify: `src/components/getRunning/v3/steps/ProductionsStep.tsx` (empty state size, drop the duplicate CTA)
- Modify: `src/components/getRunning/v3/WizardShell.tsx` (guide points list becomes source-aware for `cities`)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`
- Test: `src/components/getRunning/v3/stepRegistryV3.test.tsx`, `src/components/getRunning/v3/steps/ProductionsStep.test.tsx`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: `LadderPanelBody` and `EligibilityPanelBody` accept `showUnlocks?: boolean` (default `true`, so v1's `TaskPanel` and the setup rails keep today's behaviour untouched).

- [ ] **Step 1: Write the failing test**

```tsx
it("shows one unlocks callout on the merged coverage step, not two", () => {
  renderStepBody({ key: "coverage" });
  expect(screen.getAllByText(/what this unlocks/i)).toHaveLength(1);
});

it("lists the org's casts once on the coverage step", () => {
  renderStepBody({ key: "coverage", casts: ["Reserve Pool", "Winter Ensemble"] });
  expect(screen.getAllByText("Winter Ensemble")).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx`
Expected: FAIL, length 2.

- [ ] **Step 3: Implement**

- Add `showUnlocks = true` to both panel bodies and wrap their `<UnlocksNote>` in `{showUnlocks && ...}`.
- In the registry's `coverage` case, pass `showUnlocks={false}` to `LadderPanelBody` so only the trailing `EligibilityPanelBody` carries the callout, and give the pair a visible seam so the second card does not read as a repeat of the first: a `<Separator />` plus a small `<Eyebrow>` label above each half from new keys `body.coverage.rankingLabel` and `body.coverage.perProductionLabel`.
- The duplicated cast list is the two bodies each rendering `CastRosterList`. Pass `showCastList={false}` to the second one for the same reason, using the same default-true prop shape.
- `ProductionsStep`: change the empty state to `size="inline"` and, when `list.length === 0`, hide the header's "Add a production" button (keep "Add a date") so the CTA appears once.
- `WizardShell`'s guide renders `guide.<key>.points`. For `cities`, the Airtable bullet is a lie for a manual or sheet org. Move that bullet to `guide.cities.pointsAirtable` and have the shell pick the list by source, using the same `source` value Task 4 threads through.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/getRunning/ src/i18n/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "stop the coverage step repeating its cast list and callout"
```

---

### Task 6: Help center accepts a deep link

**Files:**
- Modify: `src/pages/HelpPage.tsx`
- Modify: `src/lib/help/filter.ts` (add `findItem`)
- Test: `src/pages/HelpPage.test.tsx`, `src/lib/help/filter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `findItem(id: string): HelpItem | null` in `src/lib/help/filter.ts`.
  - `/help?item=<id>` selects that item's role tab, expands it, and scrolls it into view.
  - `/help?q=<text>` prefills the search box.
  - An unknown `?item=` falls back to a plain `/help` render, never an error screen.

- [ ] **Step 1: Write the failing test**

```tsx
it("opens the answer named by ?item=", () => {
  renderWithProviders(<HelpPage />, { route: "/help?item=A3.11" });
  expect(screen.getByRole("button", { name: /a date has no city/i })).toHaveAttribute("aria-expanded", "true");
});

it("switches to the item's role tab", () => {
  renderWithProviders(<HelpPage />, { route: "/help?item=P3.1" });
  expect(screen.getByRole("tab", { name: /production team/i })).toHaveAttribute("aria-selected", "true");
});

it("prefills the search from ?q=", () => {
  renderWithProviders(<HelpPage />, { route: "/help?q=letterhead" });
  expect(screen.getByRole("searchbox")).toHaveValue("letterhead");
});

it("renders normally for an unknown ?item=", () => {
  renderWithProviders(<HelpPage />, { route: "/help?item=NOPE" });
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/HelpPage.test.tsx`
Expected: FAIL, `aria-expanded` is "false".

- [ ] **Step 3: Implement**

In `filter.ts`:

```ts
/** One item by its stable id, or null. The id is what `/help?item=` carries, so an
 *  unknown value must resolve to null rather than throw: a stale link is a normal
 *  outcome, not an error. */
export function findItem(id: string): HelpItem | null {
  return HELP_ITEMS.find((i) => i.id === id) ?? null;
}
```

In `HelpPage`, read `useSearchParams()` once and seed state from it. Use the same "adjust state during render" idiom the file already uses for org changes, keyed on the param value so a later in-app link that only changes the query string still lands:

```tsx
const [params] = useSearchParams();
const itemParam = params.get("item");
const qParam = params.get("q") ?? "";
const target = itemParam ? findItem(itemParam) : null;

const [appliedParam, setAppliedParam] = useState<string | null>(null);
const paramKey = `${itemParam ?? ""}|${qParam}`;
if (appliedParam !== paramKey) {
  setAppliedParam(paramKey);
  if (target) { setRole(target.role); setOpenMap({ [target.id]: true }); }
  if (qParam) setQuery(qParam);
}
```

Scroll the opened row into view once it has rendered. `HelpItemRow` needs an anchor for that: give its root `id={`help-${item.id}`}` and, in a `useEffect` keyed on `appliedParam`, call `document.getElementById(...)?.scrollIntoView({ block: "center" })`.

Confirm the search input actually carries `role="searchbox"` (an `<input type="search">`); if `HelpFilters` renders a plain text input, assert on its label instead and leave the markup alone.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/HelpPage.test.tsx src/lib/help/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HelpPage.tsx src/pages/HelpPage.test.tsx src/lib/help/
git commit -m "let the help center open a single answer from a link"
```

---

### Task 7: The missing help answers

**Files:**
- Modify: `src/lib/help/items.ts` (add 5 admin items)
- Test: `src/lib/help/items.test.ts` (existing invariants cover shape; add an id-uniqueness assertion if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: ids `A3.13` (field mapping), `A3.14` (letterhead), `A3.15` (terms), `A3.16` (contract document and numbering), `A3.17` (how contracts get signed). Task 8 maps steps onto these ids.

- [ ] **Step 1: Write the failing test**

```ts
it("answers every get-running step the wizard links to", () => {
  for (const id of ["A3.13", "A3.14", "A3.15", "A3.16", "A3.17"]) {
    expect(HELP_ITEMS.find((i) => i.id === id)).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/help/items.test.ts`
Expected: FAIL, undefined.

- [ ] **Step 3: Write the five answers**

Append to the ADMIN block of `HELP_ITEMS`, matching the existing record shape exactly (`id, role, stage, status, surface, updated, q, a`). Use `stage: 3`, `status: 'new'`, `updated: '2026-08-24'`. Surfaces name the real screen, e.g. `'Get running board, Map your fields step'`. Questions in the voice the file already uses, for example:

- A3.13: "Which Airtable columns do I have to map, and what happens if I skip one?"
- A3.14: "What goes on the letterhead, and where does it show up?"
- A3.15: "Where do the contract terms come from, and can I write my own?"
- A3.16: "How are contract numbers built, and can I change the layout?"
- A3.17: "Does the artist sign in the app, or somewhere else?"

Every answer must describe behaviour that exists in this repo. Read the corresponding step body before writing the answer. EN and DE, Du form, no dashes.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/help/ src/i18n/`
Expected: PASS, including `copyLint.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/help/items.ts src/lib/help/items.test.ts
git commit -m "answer the five setup steps the help center had no entry for"
```

---

### Task 8: "Read more" points at documentation

**Files:**
- Create: `src/lib/getRunning/stepHelp.ts`
- Create: `src/lib/getRunning/stepHelp.test.ts`
- Modify: `src/components/getRunning/v3/WizardShell.tsx` (guide links)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` (`guide.<key>.settingsLink`)
- Test: `src/components/getRunning/v3/WizardShell.test.tsx`

**Interfaces:**
- Consumes: Task 6's `?item=`/`?q=` support and Task 7's new ids.
- Produces: `stepHelpLink(key: GetRunningStepKey): string`, always a `/help?...` URL. Backed by `STEP_HELP: Record<GetRunningStepKey, { item: string } | { q: string }>`.

- [ ] **Step 1: Write the failing test**

`src/lib/getRunning/stepHelp.test.ts`:

```ts
import { STEP_FEATURE } from "./stepFeature";
import { stepHelpLink, STEP_HELP } from "./stepHelp";
import { HELP_ITEMS } from "@/lib/help/items";
import type { GetRunningStepKey } from "./steps";

const KEYS = Object.keys(STEP_FEATURE) as GetRunningStepKey[];

it("covers every step", () => {
  for (const k of KEYS) expect(STEP_HELP[k]).toBeDefined();
});

it("never links at a help item that does not exist", () => {
  for (const k of KEYS) {
    const e = STEP_HELP[k];
    if ("item" in e) expect(HELP_ITEMS.some((i) => i.id === e.item)).toBe(true);
  }
});

it("always resolves inside the help center", () => {
  for (const k of KEYS) expect(stepHelpLink(k)).toMatch(/^\/help\?/);
});
```

And in `WizardShell.test.tsx`:

```tsx
it("sends Read more to the help center, not to the settings page", () => {
  renderShell({ activeKey: "connect" });
  expect(screen.getByRole("link", { name: /read more about the airtable connection/i }))
    .toHaveAttribute("href", expect.stringContaining("/help?"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/getRunning/stepHelp.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { ROUTES } from "@/config/app.config";
import type { GetRunningStepKey } from "./steps";

/** Where a step's "Read more" actually reads. Distinct from STEP_FEATURE, which is where
 *  the setting LIVES: a step points at both, and conflating them is what sent
 *  "Read more about the Airtable connection" to /dates. `item` deep links a single answer;
 *  `q` prefills the help search for a topic with no single answer of its own. */
export const STEP_HELP: Record<GetRunningStepKey, { item: string } | { q: string }> = {
  source: { item: "A3.8" },
  connect: { item: "A4.2" },
  map: { item: "A3.13" },
  cities: { item: "A3.11" },
  productions: { item: "A3.10" },
  artists: { item: "A3.2" },
  skills: { item: "A3.10" },
  coverage: { item: "A3.1" },
  flow: { item: "A3.5" },
  timing: { item: "A3.3" },
  team: { item: "A4.3" },
  letterhead: { item: "A3.14" },
  fee: { item: "A3.9" },
  terms: { item: "A3.15" },
  document: { item: "A3.16" },
  countersign: { item: "A3.17" },
};

export function stepHelpLink(key: GetRunningStepKey): string {
  const entry = STEP_HELP[key];
  const param = "item" in entry ? `item=${encodeURIComponent(entry.item)}` : `q=${encodeURIComponent(entry.q)}`;
  return `${ROUTES.HELP}?${param}`;
}
```

In `WizardShell`, the "Read more" link's `to` becomes `stepHelpLink(activeStep.key)`. The old `stepFeatureLink` target is still useful, so keep it as a THIRD link labelled from a new `guide.<key>.settingsLink` key ("Open Airtable settings", "Open booking settings", ...). Drop the now-redundant generic "Help center" link only if the deep link makes it noise; keep it, since a reader who wants the whole FAQ still needs it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/getRunning/ src/components/getRunning/ src/i18n/`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Open the Connect step, click "Read more about the Airtable connection", and confirm the Help page opens with that single answer expanded and scrolled into view.

- [ ] **Step 6: Commit**

```bash
git add src/lib/getRunning/stepHelp.ts src/lib/getRunning/stepHelp.test.ts src/components/getRunning/v3 src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "point the wizard Read more links at real help answers"
```

---

### Task 9: The phase icon rail uses the status tones

**Files:**
- Modify: `src/components/getRunning/v3/board/PhaseIconRail.tsx:88-95`
- Test: `src/components/getRunning/v3/board/board.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing test**

```tsx
it("paints a done step the same green the step dots use", () => {
  render(<PhaseIconRail phase={phaseWithOneDoneStep} onOpenStep={() => {}} />);
  const icon = screen.getByTitle("Choose where your dates come from");
  expect(icon.className).toContain(TONES.confirmed.bg);
  expect(icon.className).not.toContain("bg-primary");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/board/board.test.tsx`
Expected: FAIL, className contains `bg-primary`.

- [ ] **Step 3: Implement**

```tsx
const iconClassName = cn(
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-s border",
  // Same TONES vocabulary as the wizard's StepDot two inches away: green is done,
  // amber is blocking-and-outstanding, a plain outline is pending. The rail used to
  // paint done in accent violet, which read as "selected", not "finished".
  step.done && `border-transparent ${TONES.confirmed.bg} ${TONES.confirmed.fg}`,
  !step.done && blocking && `border-transparent ${TONES.waiting.bg} ${TONES.waiting.fg}`,
  !step.done && !blocking && "border-border bg-transparent text-muted-foreground",
  locked && "cursor-not-allowed opacity-60",
);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/getRunning/v3/`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

On `/get-running` in an org with finished steps, confirm the rail icons are green where the step dots are green.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/board/
git commit -m "colour the phase icon rail from TONES so done reads green"
```

---

### Task 10: The Settings board stays live after the standalone page retires

**Files:**
- Modify: `src/components/getRunning/v3/GetRunningBoardV3.tsx` (the `model.complete` branch)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` (`retired.settingsBody`)
- Test: `src/components/getRunning/v3/GetRunningBoardV3.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 9.
- Produces: nothing other tasks read.

**Decision:** the owner's call. `context === "page"` keeps today's behaviour exactly: a finished board retires to the summary card and the sidebar item can be hidden. `context === "settings"` never retires: Settings is the durable home, so it renders the full rail and every wizard, with the retired summary as a header above them rather than instead of them.

- [ ] **Step 1: Write the failing test**

```tsx
it("still retires the standalone page when everything is done", () => {
  renderBoard({ context: "page", model: completeModel });
  expect(screen.getByTestId("get-running-v3-retired")).toBeInTheDocument();
  expect(screen.queryByTestId("all-steps-card")).not.toBeInTheDocument();
});

it("keeps the rail and the wizards reachable in Settings when everything is done", () => {
  renderBoard({ context: "settings", model: completeModel });
  expect(screen.getByTestId("all-steps-card")).toBeInTheDocument();
  expect(screen.getByTestId("phase-icon-rail-get_dates")).toBeInTheDocument();
});

it("still says the setup is finished in Settings", () => {
  renderBoard({ context: "settings", model: completeModel });
  expect(screen.getByTestId("get-running-v3-retired")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/GetRunningBoardV3.test.tsx`
Expected: FAIL, `all-steps-card` absent in the settings case.

- [ ] **Step 3: Implement**

Replace the early return:

```tsx
if (model.complete) {
  return (
    <div className={context === "page" ? "flex flex-col gap-5 p-6" : "flex flex-col gap-5"}>
      <RetiredBoardV3 model={model} orgId={orgId} context={context} />
    </div>
  );
}
```

with an early return ONLY for the page context. In the settings context, fall through to the normal board and render `<RetiredBoardV3 …/>` in place of the hero and still-shut cards, above the "All N steps" rail. `RetiredBoardV3` already omits its "Manage in Settings" button when `context === "settings"`; give it a settings-context body line (`retired.settingsBody`) that says the setup is finished and every step can still be reopened here, so the card is not just a page-context leftover.

Hoist the hero/still-shut render into a `const showProgressCards = !model.complete;` guard so the finished settings board does not tell a finished org what is still shut.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/getRunning/ src/i18n/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/GetRunningBoardV3.tsx src/components/getRunning/v3/GetRunningBoardV3.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "keep the settings get-running board live once the page retires"
```

---

### Task 11: "How this org works" gets its own icon

**Files:**
- Modify: `src/pages/SettingsPage.tsx:21` (import), `:289` (nav entry)
- Test: `src/pages/SettingsPage.test.tsx` (create a focused test if the file does not exist)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```tsx
it("does not give two settings tabs the same icon", () => {
  renderWithProviders(<SettingsPage />, { role: "admin" });
  const howItWorks = screen.getByRole("tab", { name: /how this org works/i });
  const getRunning = screen.getByRole("tab", { name: /get running/i });
  const iconClass = (el: HTMLElement) => el.querySelector("svg")?.getAttribute("class") ?? "";
  expect(iconClass(howItWorks)).not.toBe(iconClass(getRunning));
});
```

Lucide stamps its component name into the class (`lucide-rocket`, `lucide-compass`), so comparing the svg class is a real assertion, not a tautology.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL, both are `lucide-rocket`.

- [ ] **Step 3: Implement**

Add `Compass` to the lucide import on line 21 and change the nav entry:

```tsx
// Rocket is Get running's identity, in this list and in the sidebar
// (src/components/layout/navItems.ts). This tab is the read-only reference for how the
// org is currently configured, so it gets its own mark.
{ value: "how-it-works", label: t('nav.items.howItWorks'), icon: Compass, show: isAdmin || isProducer },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/pages/ && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "give How this org works its own icon"
```

---

### Task 12: Full verification

- [ ] **Step 1: Run the whole gate**

```bash
npm run verify:fast
```

Expected: lint, all three typecheck projects, build, unit tests with coverage, and the Deno suite all pass.

- [ ] **Step 2: Walk the wizard in the browser**

At viewport 1024, 1280 and 1440, and at the mobile preset, open every one of the 16 steps and confirm: a heading and sub line, exactly one footer primary action, no element where `scrollWidth > clientWidth`, "Read more" landing on an expanded help answer, and green rail icons for done steps. Check the same inside Settings, Get running, where the board is narrower.

- [ ] **Step 3: Update the changelog**

Add the user-facing bullets to `public/changelog.md` under the current version, then regenerate:

```bash
deno run --allow-read --allow-write scripts/changelog-to-json.ts
```

Nothing about the super-admin v3 toggle goes in the changelog.

- [ ] **Step 4: Commit**

```bash
git add public/changelog.md public/changelog.json
git commit -m "note the get-running wizard polish in the changelog"
```
