# Admin People Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the Admin panel's Invites and Members tabs into one searchable "People" pane with an invite bar, bulk-invite modal, live duplicate detection, and a unified pending/members directory.

**Architecture:** A new `src/components/admin/people/` folder holds an orchestrator `PeopleTab` that owns both queries (org invitations + org members) and a shared search string, composing an `InviteBar` (with live duplicate detection and a bulk-invite trigger), a `BulkInviteDialog`, a `PendingSection`/`InviteRow`, and a `MembersSection`/`MemberRow`. All matching/filter/parse logic lives in pure, unit-tested helpers (`peopleMatch.ts`). No backend, RPC, RLS, edge-function, or entitlement changes — everything reuses existing data-access functions and hooks.

**Tech Stack:** React 18 + TypeScript, @tanstack/react-query v5, shadcn/ui (Radix), sonner toasts, Vitest + jsdom + @testing-library/react.

## Global Constraints

- **Semantic tokens only** — `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-warning`/`text-warning` etc. Never hardcode `bg-white`/`text-black`. Accent numbered stops (`accent-50`–`900`) do NOT support `/opacity` modifiers.
- **`any` is banned** (lint `--max-warnings 0`). Use explicit interfaces; for Supabase joins cast once with `as unknown as Row[]` at the query boundary only.
- **Tests import the real module** — never re-implement production logic in a test. Co-locate `*.test.ts(x)` beside the file.
- **Test harness** — component/hook tests use `renderWithProviders` from `@/test/renderWithProviders` and fixtures from `@/test/fixtures`; follow the existing `MembersTab.test.tsx` mocking style (`vi.mock` for `@/integrations/supabase/client`, `@/features/auth/AuthContext`, and the hooks). Never hand-roll a raw supabase client mock chain.
- **No em/en dashes in user-facing copy** — use period, comma, colon, middot, or arrows.
- **Query keys** — invitations use `['org-invitations', orgId]`; members use `['members', orgId]` (via `useOrgMembers`). Invalidate `['org-invitations']` (prefix) after invite mutations.
- **Naming** — components `PascalCase.tsx` (named exports, except pages), helpers `camelCase.ts`. Files that change together live together (the `people/` folder).
- **Verify before done** — `npm run lint`, `npx vitest run src/components/admin`, and `npx tsc -p tsconfig.app.json --noEmit` must all pass.

---

## File structure

- Create `src/components/admin/people/peopleMatch.ts` — pure helpers: `isValidEmail`, `parseEmails`, `matchContact`, `filterPeople`.
- Create `src/components/admin/people/peopleMatch.test.ts` — unit tests for the above.
- Create `src/components/admin/people/InviteRow.tsx` — one pending-invite row (copy link / resend / revoke + `Pending` pill).
- Create `src/components/admin/people/MemberRow.tsx` — one member row (role popover, remove dialog, `Active` pill).
- Create `src/components/admin/people/MemberRow.test.tsx` — rebased member coverage.
- Create `src/components/admin/people/InviteBar.tsx` — inline invite + live duplicate detection + bulk trigger.
- Create `src/components/admin/people/InviteBar.test.tsx` — duplicate-detection state tests.
- Create `src/components/admin/people/BulkInviteDialog.tsx` — bulk-invite modal.
- Create `src/components/admin/people/PeopleTab.tsx` — orchestrator (queries + search + composition).
- Modify `src/pages/AdminPage.tsx` — replace the `invites`/`members` tabs with one `people` tab; normalize deep links.
- Delete `src/components/admin/InvitesTab.tsx`, `src/components/admin/MembersTab.tsx`, `src/components/admin/MembersTab.test.tsx` (coverage moves to `MemberRow.test.tsx`).
- Modify `public/changelog.md` + regenerate `public/changelog.json`.

---

### Task 1: Pure helpers (`peopleMatch.ts`)

**Files:**
- Create: `src/components/admin/people/peopleMatch.ts`
- Test: `src/components/admin/people/peopleMatch.test.ts`

**Interfaces:**
- Consumes: `OrgMember` from `@/data/members`, `Invitation` from `@/data/invitations`.
- Produces:
  - `isValidEmail(email: string): boolean`
  - `parseEmails(text: string): string[]` — split on comma/newline/whitespace, trim, drop empties, dedupe case-insensitively (keep first-seen original casing).
  - `matchContact(email: string, members: OrgMember[], invites: Invitation[]): 'member' | 'pending' | 'none'` — case-insensitive; only `status === 'pending'` invites count as `pending`.
  - `filterPeople(query: string, members: OrgMember[], invites: Invitation[]): { members: OrgMember[]; invites: Invitation[] }` — empty/whitespace query returns inputs unchanged; members match on `display_name` OR `email` (null-safe), invites match on `email`; case-insensitive substring.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/admin/people/peopleMatch.test.ts
import { describe, it, expect } from "vitest";
import { isValidEmail, parseEmails, matchContact, filterPeople } from "./peopleMatch";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

const member = (o: Partial<OrgMember> = {}): OrgMember => ({
  user_id: "u1", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null, ...o,
});
const invite = (o: Partial<Invitation> = {}): Invitation => ({
  id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending",
  token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", ...o,
});

describe("isValidEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("parseEmails", () => {
  it("splits on comma/newline/space, trims, dedupes case-insensitively", () => {
    expect(parseEmails("a@x.com, b@x.com\nA@X.com  c@x.com")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(parseEmails("   ")).toEqual([]);
  });
});

describe("matchContact", () => {
  it("finds a member case-insensitively", () => {
    expect(matchContact("BOB@x.com", [member()], [])).toBe("member");
  });
  it("finds a pending invite but ignores non-pending", () => {
    expect(matchContact("kim@x.com", [], [invite()])).toBe("pending");
    expect(matchContact("kim@x.com", [], [invite({ status: "revoked" })])).toBe("none");
  });
  it("returns none when nothing matches", () => {
    expect(matchContact("new@x.com", [member()], [invite()])).toBe("none");
  });
});

describe("filterPeople", () => {
  it("passes through on empty query", () => {
    const r = filterPeople("  ", [member()], [invite()]);
    expect(r.members).toHaveLength(1);
    expect(r.invites).toHaveLength(1);
  });
  it("matches members by name or email, invites by email; null-safe", () => {
    const m2 = member({ user_id: "u2", email: null, display_name: "Zoe" });
    expect(filterPeople("zoe", [member(), m2], []).members).toHaveLength(1);
    expect(filterPeople("kim", [member()], [invite()]).invites).toHaveLength(1);
    expect(filterPeople("bob", [member()], [invite()]).members).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/people/peopleMatch.test.ts`
Expected: FAIL (cannot find module `./peopleMatch`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/admin/people/peopleMatch.ts
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function parseEmails(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export function matchContact(
  email: string,
  members: OrgMember[],
  invites: Invitation[],
): "member" | "pending" | "none" {
  const needle = email.trim().toLowerCase();
  if (!needle) return "none";
  if (members.some((m) => (m.email ?? "").toLowerCase() === needle)) return "member";
  if (invites.some((i) => i.status === "pending" && i.email.toLowerCase() === needle)) return "pending";
  return "none";
}

export function filterPeople(
  query: string,
  members: OrgMember[],
  invites: Invitation[],
): { members: OrgMember[]; invites: Invitation[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { members, invites };
  return {
    members: members.filter(
      (m) => (m.display_name ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
    ),
    invites: invites.filter((i) => i.email.toLowerCase().includes(q)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/people/peopleMatch.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/people/peopleMatch.ts src/components/admin/people/peopleMatch.test.ts
git commit -m "add people-pane pure helpers (match/filter/parse)"
```

---

### Task 2: `InviteRow` (pending-invite row)

**Files:**
- Create: `src/components/admin/people/InviteRow.tsx`

**Interfaces:**
- Consumes: `Invitation` from `@/data/invitations`; `acceptInviteUrl` from `@/data/invitations`.
- Produces:
  - `interface InviteRowProps { invite: Invitation; onCopyLink: (token: string) => void; onResend: (id: string) => void; onRevoke: (id: string) => void; }`
  - `export function InviteRow(props: InviteRowProps): JSX.Element`

Extracted verbatim from the current `InvitesTab` row markup, plus a `Pending` state pill. Only pending invites are rendered by the parent, so the row always shows the action buttons (copy/resend/revoke).

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/admin/people/InviteRow.tsx
import { Copy, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import type { Invitation } from "@/data/invitations";

export interface InviteRowProps {
  invite: Invitation;
  onCopyLink: (token: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}

/** One pending org invitation, with copy-link / resend / revoke actions. */
export function InviteRow({ invite, onCopyLink, onResend, onRevoke }: InviteRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{invite.email}</p>
        <p className="text-xs text-muted-foreground capitalize">{invite.role}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-xs border-warning text-warning">Pending</Badge>
        <IconTooltip label="Copy invite link">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopyLink(invite.token)} aria-label="Copy invite link">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="Resend invitation">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onResend(invite.id)} aria-label="Resend invitation">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="Revoke invitation">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onRevoke(invite.id)} aria-label="Revoke invitation">
            <X className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (no errors referencing `InviteRow`). If `border-warning`/`text-warning` are not defined tokens, substitute the existing warning token used elsewhere (grep `text-warning` / `--warning` in `src/index.css`; if absent use `text-amber-600 dark:text-amber-400` is NOT allowed — instead use `bg-secondary text-secondary-foreground`). Prefer a real semantic warning token.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/people/InviteRow.tsx
git commit -m "add InviteRow (pending invite row) for people pane"
```

---

### Task 3: `MemberRow` (member row) + rebased tests

**Files:**
- Create: `src/components/admin/people/MemberRow.tsx`
- Create: `src/components/admin/people/MemberRow.test.tsx`

**Interfaces:**
- Consumes: `OrgMember` from `@/data/members`; `AppRole` from `@/config/app.config`.
- Produces:
  - `interface MemberRowProps { member: OrgMember; isSelf: boolean; onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void; setRolePending: boolean; onRequestRemove: (t: { user_id: string; email: string | null }) => void; }`
  - `export function MemberRow(props: MemberRowProps): JSX.Element`

Row markup lifted from `MembersTab` (role badges, `Active` pill, role popover, remove button). The remove **confirmation dialog** stays in the parent (`MembersSection`/`PeopleTab`) so a single dialog serves all rows; the row only calls `onRequestRemove`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/people/MemberRow.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MemberRow } from "./MemberRow";
import type { OrgMember } from "@/data/members";

const bob: OrgMember = { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null };

describe("MemberRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the member, an Active pill, and 'never signed in'", () => {
    renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={vi.fn()} />,
    );
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/never signed in/i)).toBeInTheDocument();
  });

  it("toggles a role through the popover", async () => {
    const onSetRole = vi.fn();
    renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={onSetRole} setRolePending={false} onRequestRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit roles for bob@x.com/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^admin$/i }));
    await waitFor(() => expect(onSetRole).toHaveBeenCalledWith({ userId: "bob-2", role: "admin", action: "add" }));
  });

  it("requests removal for another member and shows 'You' for self", () => {
    const onRequestRemove = vi.fn();
    const { rerender } = renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={onRequestRemove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(onRequestRemove).toHaveBeenCalledWith({ user_id: "bob-2", email: "bob@x.com" });
    rerender(<MemberRow member={bob} isSelf={true} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={onRequestRemove} />);
    expect(screen.getByText(/^you$/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/people/MemberRow.test.tsx`
Expected: FAIL (cannot find module `./MemberRow`).

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/admin/people/MemberRow.tsx
import { format } from "date-fns";
import { Check, Settings as SettingsIcon } from "lucide-react";
import type { AppRole } from "@/config/app.config";
import type { OrgMember } from "@/data/members";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ALL_ROLES: AppRole[] = ["admin", "producer", "artist"];

export interface MemberRowProps {
  member: OrgMember;
  isSelf: boolean;
  onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void;
  setRolePending: boolean;
  onRequestRemove: (t: { user_id: string; email: string | null }) => void;
}

/** One org member: role badges, Active pill, role editor popover, remove trigger. */
export function MemberRow({ member: m, isSelf, onSetRole, setRolePending, onRequestRemove }: MemberRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{m.display_name || m.email}</p>
        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
        <p className="text-xs text-muted-foreground">
          {m.last_sign_in_at ? `Last seen ${format(new Date(m.last_sign_in_at), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="secondary" className="text-xs">Active</Badge>
        {m.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs capitalize">{r}</Badge>)}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${m.email}`}>
              <SettingsIcon className="h-3 w-3 mr-1" />Roles
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            {ALL_ROLES.map((r) => {
              const has = m.roles.includes(r);
              return (
                <button
                  key={r}
                  disabled={setRolePending}
                  onClick={() => onSetRole({ userId: m.user_id, role: r, action: has ? "remove" : "add" })}
                  className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left capitalize disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                  {r}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
        <Button
          size="sm" variant="ghost" className="h-7 px-2 text-xs"
          disabled={isSelf}
          onClick={() => onRequestRemove({ user_id: m.user_id, email: m.email })}
        >
          {isSelf ? "You" : "Remove"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/people/MemberRow.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/people/MemberRow.tsx src/components/admin/people/MemberRow.test.tsx
git commit -m "add MemberRow with rebased member-management coverage"
```

---

### Task 4: `BulkInviteDialog` (bulk-invite modal)

**Files:**
- Create: `src/components/admin/people/BulkInviteDialog.tsx`

**Interfaces:**
- Consumes: `OrgMember`, `Invitation`, `createInvitation` from `@/data/invitations`, `useAuth`, `useQueryClient`; helpers `parseEmails`, `isValidEmail`, `matchContact` from `./peopleMatch`; `AppRole`.
- Produces:
  - `interface BulkInviteDialogProps { open: boolean; onOpenChange: (o: boolean) => void; members: OrgMember[]; invites: Invitation[]; }`
  - `export function BulkInviteDialog(props: BulkInviteDialogProps): JSX.Element`

Behavior: textarea + single role select. Live per-address classification preview (`invalid` / `member` / `pending` / `ok`) computed from `parseEmails` + `isValidEmail` + `matchContact`. On submit, loop `createInvitation` over the `ok` addresses (each wrapped in try/catch so one failure does not abort the batch), tally successes/failures, invalidate `['org-invitations']`, toast a summary with no em-dashes, and close.

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/admin/people/BulkInviteDialog.tsx
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { createInvitation, type Invitation } from "@/data/invitations";
import type { OrgMember } from "@/data/members";
import type { AppRole } from "@/config/app.config";
import { parseEmails, isValidEmail, matchContact } from "./peopleMatch";
import {
  Dialog, DialogContent, Dialogheader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface BulkInviteDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: OrgMember[];
  invites: Invitation[];
}

type Kind = "invalid" | "member" | "pending" | "ok";

/** Paste multiple emails, pick one role, invite the clean ones; skips are reported. */
export function BulkInviteDialog({ open, onOpenChange, members, invites }: BulkInviteDialogProps) {
  const { currentOrg } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [role, setRole] = useState<AppRole>("artist");
  const [sending, setSending] = useState(false);

  const rows = useMemo(() => {
    return parseEmails(text).map((email) => {
      let kind: Kind = "ok";
      if (!isValidEmail(email)) kind = "invalid";
      else kind = matchContact(email, members, invites) === "member"
        ? "member"
        : matchContact(email, members, invites) === "pending"
          ? "pending"
          : "ok";
      return { email, kind };
    });
  }, [text, members, invites]);

  const okCount = rows.filter((r) => r.kind === "ok").length;

  const submit = async () => {
    if (!currentOrg || okCount === 0) return;
    setSending(true);
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.kind !== "ok") continue;
      try {
        await createInvitation(supabase, { orgId: currentOrg.id, email: r.email, role });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    const skipped = rows.length - okCount;
    setSending(false);
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
    const parts = [`${sent} invited`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (failed > 0) toast.error(parts.join(" · "));
    else toast.success(parts.join(" · "));
    setText("");
    onOpenChange(false);
  };

  const badgeFor = (kind: Kind) =>
    kind === "ok" ? null : (
      <Badge variant="outline" className="text-xs capitalize">
        {kind === "member" ? "already a member" : kind === "pending" ? "already invited" : "invalid"}
      </Badge>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Bulk invite</DialogTitle>
          <DialogDescription>Paste emails separated by commas, spaces, or new lines.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={5}
            placeholder={"alex@email.com\nsam@email.com"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="producer">Producer</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
            </SelectContent>
          </Select>
          {rows.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
              {rows.map((r) => (
                <div key={r.email} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{r.email}</span>
                  {badgeFor(r.kind)}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={sending || okCount === 0}>
            {sending ? "Inviting…" : `Invite ${okCount || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Fix the import casing and verify typecheck**

The shadcn dialog exports are `DialogHeader` (PascalCase). Correct the import line to:
`import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";`
Confirm `@/components/ui/textarea` exists (`ls src/components/ui/textarea.tsx`); if the export differs, match it.

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (no errors in `BulkInviteDialog.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/people/BulkInviteDialog.tsx
git commit -m "add BulkInviteDialog with per-address skip reporting"
```

---

### Task 5: `InviteBar` (inline invite + live duplicate detection) + tests

**Files:**
- Create: `src/components/admin/people/InviteBar.tsx`
- Create: `src/components/admin/people/InviteBar.test.tsx`

**Interfaces:**
- Consumes: `OrgMember`, `Invitation`, `createInvitation`, `resendInvitation` from `@/data/invitations`, `useAuth`, `useMutation`/`useQueryClient`, helpers `isValidEmail`, `matchContact`.
- Produces:
  - `interface InviteBarProps { members: OrgMember[]; invites: Invitation[]; onOpenBulk: () => void; }`
  - `export function InviteBar(props: InviteBarProps): JSX.Element`

Behavior: email input + role select + Invite button + a "Bulk invite" ghost button (calls `onOpenBulk`). When the typed email is valid, compute `matchContact`:
- `member` → hint "Already a member", Invite disabled.
- `pending` → hint "Already invited" with an inline **Resend** button (finds the matching pending invite id, calls `resendInvitation`).
- `none` → Invite enabled.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/people/InviteBar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
const resendInvitation = vi.fn(() => Promise.resolve());
const createInvitation = vi.fn(() => Promise.resolve());
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  resendInvitation: (...a: unknown[]) => resendInvitation(...a),
  createInvitation: (...a: unknown[]) => createInvitation(...a),
}));

import { InviteBar } from "./InviteBar";

const members: OrgMember[] = [{ user_id: "u1", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null }];
const invites: Invitation[] = [{ id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }];

describe("InviteBar duplicate detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Invite and warns when the email is already a member", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "bob@x.com" } });
    expect(screen.getByText(/already a member/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^invite$/i })).toBeDisabled();
  });

  it("offers Resend when the email is already invited (pending)", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "kim@x.com" } });
    expect(screen.getByText(/already invited/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(resendInvitation).toHaveBeenCalled();
  });

  it("enables Invite for a fresh address", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "new@x.com" } });
    expect(screen.getByRole("button", { name: /^invite$/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/people/InviteBar.test.tsx`
Expected: FAIL (cannot find module `./InviteBar`).

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/admin/people/InviteBar.tsx
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { createInvitation, resendInvitation, type Invitation } from "@/data/invitations";
import type { OrgMember } from "@/data/members";
import type { AppRole } from "@/config/app.config";
import { isValidEmail, matchContact } from "./peopleMatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface InviteBarProps {
  members: OrgMember[];
  invites: Invitation[];
  onOpenBulk: () => void;
}

/** Inline single invite with live duplicate detection + a bulk-invite entry point. */
export function InviteBar({ members, invites, onOpenBulk }: InviteBarProps) {
  const { currentOrg } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("artist");

  const trimmed = email.trim();
  const match = useMemo(
    () => (isValidEmail(trimmed) ? matchContact(trimmed, members, invites) : "none"),
    [trimmed, members, invites],
  );
  const pendingInvite = match === "pending"
    ? invites.find((i) => i.status === "pending" && i.email.toLowerCase() === trimmed.toLowerCase())
    : undefined;

  const create = useMutation({
    mutationFn: () => createInvitation(supabase, { orgId: currentOrg!.id, email: trimmed, role }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["org-invitations"] });
      toast.success("Invitation sent");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Could not send invitation"),
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e?.message ?? "Could not resend invitation"),
  });

  const canInvite = !!currentOrg && isValidEmail(trimmed) && match === "none" && !create.isPending;

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!currentOrg) return;
          if (!isValidEmail(trimmed)) { toast.error("Enter a valid email address"); return; }
          if (match !== "none") return;
          create.mutate();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <Input type="email" placeholder="invitee@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="producer">Producer</SelectItem>
            <SelectItem value="artist">Artist</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!canInvite}>Invite</Button>
        <Button type="button" variant="ghost" onClick={onOpenBulk}>
          <UserPlus className="h-4 w-4 mr-1" />Bulk invite
        </Button>
      </form>
      {match === "member" && (
        <p className="text-xs text-muted-foreground">Already a member of this organization.</p>
      )}
      {match === "pending" && pendingInvite && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          Already invited (pending).
          <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => resend.mutate(pendingInvite.id)}>
            Resend
          </Button>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/people/InviteBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/people/InviteBar.tsx src/components/admin/people/InviteBar.test.tsx
git commit -m "add InviteBar with live duplicate detection + bulk trigger"
```

---

### Task 6: `PeopleTab` orchestrator (queries, search, sections, remove dialog) + test

**Files:**
- Create: `src/components/admin/people/PeopleTab.tsx`
- Create: `src/components/admin/people/PeopleTab.test.tsx`

**Interfaces:**
- Consumes: `useAuth`; `useQuery` + `fetchOrgInvitations`, `revokeInvitation`, `resendInvitation`, `acceptInviteUrl`; `useOrgMembers`, `useRemoveOrgMember`, `useSetOrgMemberRole`; `filterPeople`; `InviteBar`, `BulkInviteDialog`, `PendingSection` (inline), `MemberRow`.
- Produces: `export function PeopleTab(): JSX.Element`

Behavior: owns the invitations query (`['org-invitations', orgId]`) and members via `useOrgMembers`; a single `search` string; renders `InviteBar`, a Card "Search people" input, a Pending section (only when `pendingInvites.length > 0` before filtering AND has matches after), and a Members section. Hosts the single remove-confirmation `AlertDialog` (lifted from `MembersTab`) and the copy/resend/revoke handlers for invites. Only `status === 'pending'` invites appear in the Pending section.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/admin/people/PeopleTab.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({ data: [
    { user_id: "admin-1", email: "me@x.com", display_name: "Me", roles: ["admin"], last_sign_in_at: "2026-06-01T10:00:00Z" },
    { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null },
  ], isLoading: false, isError: false, error: null }),
  useRemoveOrgMember: () => ({ mutate: vi.fn(), isPending: false }),
  useSetOrgMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  fetchOrgInvitations: () => Promise.resolve([
    { id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
  ]),
}));

import { PeopleTab } from "./PeopleTab";

describe("PeopleTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows members and pending invites, and filters both via one search", async () => {
    renderWithProviders(<PeopleTab />);
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(await screen.findByText("kim@x.com")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search people/i), { target: { value: "kim" } });
    expect(screen.queryByText("bob@x.com")).not.toBeInTheDocument();
    expect(screen.getByText("kim@x.com")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/people/PeopleTab.test.tsx`
Expected: FAIL (cannot find module `./PeopleTab`).

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/admin/people/PeopleTab.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  fetchOrgInvitations, revokeInvitation, resendInvitation, acceptInviteUrl,
} from "@/data/invitations";
import { useOrgMembers, useRemoveOrgMember, useSetOrgMemberRole } from "@/hooks/useOrgMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { filterPeople } from "./peopleMatch";
import { InviteBar } from "./InviteBar";
import { BulkInviteDialog } from "./BulkInviteDialog";
import { InviteRow } from "./InviteRow";
import { MemberRow } from "./MemberRow";

/** One searchable people directory: invite bar on top, pending + members below. */
export function PeopleTab() {
  const { currentOrg, user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [target, setTarget] = useState<{ user_id: string; email: string | null } | null>(null);

  const { data: invites } = useQuery({
    queryKey: ["org-invitations", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchOrgInvitations(supabase, currentOrg!.id),
  });
  const { data: members, isLoading, isError, error } = useOrgMembers(currentOrg?.id);
  const remove = useRemoveOrgMember(currentOrg?.id ?? "");
  const setRole = useSetOrgMemberRole(currentOrg?.id ?? "");

  const allMembers = members ?? [];
  const allInvites = invites ?? [];
  const pendingInvites = allInvites.filter((i) => i.status === "pending");
  const filtered = filterPeople(search, allMembers, pendingInvites);
  const hasSearch = search.trim().length > 0;

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-invitations"] }); toast.success("Invitation revoked"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not revoke invitation"),
  });
  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e?.message ?? "Could not resend invitation"),
  });
  const copyLink = async (token: string) => {
    try { await navigator.clipboard?.writeText(acceptInviteUrl(token)); toast.success("Invite link copied"); }
    catch { toast.error("Could not copy link"); }
  };

  const showPending = filtered.invites.length > 0;
  const showMembers = filtered.members.length > 0;
  const nothing = hasSearch && !showPending && !showMembers;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="font-display">Invite people</CardTitle></CardHeader>
        <CardContent>
          <InviteBar members={allMembers} invites={pendingInvites} onOpenBulk={() => setBulkOpen(true)} />
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading && <Skeleton className="h-10 w-full" />}
      {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}

      {showPending && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Pending invitations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.invites.map((inv) => (
              <InviteRow key={inv.id} invite={inv} onCopyLink={copyLink} onResend={(id) => resend.mutate(id)} onRevoke={(id) => revoke.mutate(id)} />
            ))}
          </CardContent>
        </Card>
      )}

      {showMembers && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Members</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.members.map((m) => (
              <MemberRow
                key={m.user_id}
                member={m}
                isSelf={m.user_id === user?.id}
                setRolePending={setRole.isPending}
                onSetRole={(vars) => setRole.mutate(vars, {
                  onSuccess: () => toast.success("Role updated"),
                  onError: (e) => toast.error((e as Error).message),
                })}
                onRequestRemove={setTarget}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {nothing && <p className="text-sm text-muted-foreground text-center py-6">No people match "{search.trim()}".</p>}
      {!hasSearch && allMembers.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>
      )}

      <BulkInviteDialog open={bulkOpen} onOpenChange={setBulkOpen} members={allMembers} invites={pendingInvites} />

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.email} will lose access to this organization. Their bookings and artist profile are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!target) return;
              remove.mutate(target.user_id, {
                onSuccess: () => toast.success("Member removed"),
                onError: (e) => toast.error((e as Error).message),
              });
              setTarget(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/people/PeopleTab.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/people/PeopleTab.tsx src/components/admin/people/PeopleTab.test.tsx
git commit -m "add PeopleTab orchestrator (search, sections, remove dialog)"
```

---

### Task 7: Wire `PeopleTab` into `AdminPage`; remove old tabs; normalize deep links

**Files:**
- Modify: `src/pages/AdminPage.tsx`
- Delete: `src/components/admin/InvitesTab.tsx`, `src/components/admin/MembersTab.tsx`, `src/components/admin/MembersTab.test.tsx`

**Interfaces:**
- Consumes: `PeopleTab` from `@/components/admin/people/PeopleTab`.

- [ ] **Step 1: Edit `AdminPage.tsx`**

Replace the imports:
```tsx
// remove:
import { InvitesTab } from '@/components/admin/InvitesTab';
import { MembersTab } from '@/components/admin/MembersTab';
// add:
import { PeopleTab } from '@/components/admin/people/PeopleTab';
```

Normalize the initial tab so old `?tab=invites|members` links land on People:
```tsx
const rawTab = params.get('tab') || 'people';
const initialTab = rawTab === 'invites' || rawTab === 'members' ? 'people' : rawTab;
const [tab, setTab] = useState(initialTab);
```

Replace the two `TabsTrigger`s and their `TabsContent`s:
```tsx
<TabsList>
  <TabsTrigger value="people">People</TabsTrigger>
  <TabsTrigger value="audit">Audit Log</TabsTrigger>
  <TabsTrigger value="sync">Sync Status</TabsTrigger>
</TabsList>

<TabsContent value="people" className="mt-4">
  <PeopleTab />
</TabsContent>
```
(Leave the `audit` and `sync` `TabsContent` blocks unchanged.)

- [ ] **Step 2: Delete the old files**

```bash
git rm src/components/admin/InvitesTab.tsx src/components/admin/MembersTab.tsx src/components/admin/MembersTab.test.tsx
```

- [ ] **Step 3: Verify nothing else imports the removed components**

Run: `grep -rn "components/admin/InvitesTab\|components/admin/MembersTab" src`
Expected: no matches. If any exist (e.g. a sidebar or NotificationsList deep link to `?tab=invites`), leave URL strings as-is — they are normalized in Step 1 — but fix any code that imports the deleted modules.

- [ ] **Step 4: Typecheck, lint, and run the admin tests**

Run:
```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run src/components/admin src/pages
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminPage.tsx
git commit -m "converge Invites+Members into People tab on AdminPage"
```

---

### Task 8: Changelog

**Files:**
- Modify: `public/changelog.md`
- Regenerate: `public/changelog.json`

**Interfaces:** none (docs).

- [ ] **Step 1: Add an `### Improved` bullet under the current version block**

Open `public/changelog.md`, find the newest version block (matching `APP_META.VERSION`). If a block for today's date already exists, add to its `### Improved` list; otherwise add the bullet under the current version's `### Improved` section. Bullet (no em-dashes):
```markdown
- **People pane** — Admin now manages invites and members in one searchable directory, with live duplicate detection when inviting and a bulk invite option.
```
Note: the file's existing bullets use the em-dash form `- **Title** — description`; match the surrounding file's punctuation exactly (this is the one place em-dashes already appear by house style; if the file uses a period/colon instead, match that).

- [ ] **Step 2: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` updated; never hand-edit it.

- [ ] **Step 3: Commit**

```bash
git add public/changelog.md public/changelog.json
git commit -m "changelog: People pane"
```

---

## Final verification

- [ ] Run the full fast gate: `npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx vitest run`
- [ ] Confirm the People tab renders, search filters both sections, invite bar warns on dupes, bulk modal reports skips (manual browser check is optional — the local dev stack is prod-backed per repo memory, so keep any browser verification read-only).

---

## Self-review notes

- **Spec coverage:** invite bar + bulk modal (Tasks 4,5), live duplicate detection (Task 5, helper Task 1), one search over both sections (Tasks 1,6), state pills (Tasks 2,3), hidden empty pending section (Task 6 `showPending`), deep-link normalization (Task 7), tab rename to People (Task 7), no backend changes (confirmed — only reused data fns), changelog (Task 8), null-safe email handling (Task 1 `filterPeople`/`matchContact`). All covered.
- **Type consistency:** `OrgMember`/`Invitation` used consistently; `onSetRole` payload `{ userId, role, action }` matches `useSetOrgMemberRole` mutation vars; `matchContact` return union `'member'|'pending'|'none'` used consistently in InviteBar and BulkInviteDialog.
- **Known adjustment points flagged inline:** shadcn `DialogHeader` casing (Task 4 Step 2), warning token existence (Task 2 Step 2). These are verify-and-match steps, not placeholders.
