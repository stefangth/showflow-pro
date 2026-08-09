// src/components/admin/people/peopleMatch.ts
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";
import type { AppRole } from "@/config/app.config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function parseEmails(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
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

/** Case-insensitive email substring filter for a list of invitations (empty query = passthrough). */
export function filterInvitesByEmail(query: string, invites: Invitation[]): Invitation[] {
  const q = query.trim().toLowerCase();
  if (!q) return invites;
  return invites.filter((i) => i.email.toLowerCase().includes(q));
}

export interface Person {
  /** Lowercased email — the identity key. */
  emailKey: string;
  /** Display-case email (from the member row if present, else the invite). */
  email: string;
  status: "active" | "invited";
  userId: string | null;
  displayName: string | null;
  roles: AppRole[];
  lastSignInAt: string | null;
  /** The pending invitation, when the person is invited. */
  invitation: Invitation | null;
}

/**
 * Merge members and pending invitations into one row-per-person directory. A person is
 * `invited` when a pending invite exists for their email (even if a membership row already
 * exists at invite time), else `active`. Roles come from the membership when present, else
 * the invite's single role. Sorted invited-first, then by email.
 */
export function buildPeople(members: OrgMember[], pendingInvites: Invitation[]): Person[] {
  const byEmail = new Map<string, Person>();

  for (const m of members) {
    const key = (m.email ?? "").toLowerCase();
    if (!key) continue;
    byEmail.set(key, {
      emailKey: key,
      email: m.email ?? key,
      status: "active",
      userId: m.user_id,
      displayName: m.display_name,
      roles: m.roles,
      lastSignInAt: m.last_sign_in_at,
      invitation: null,
    });
  }

  for (const inv of pendingInvites) {
    const key = inv.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.status = "invited";
      existing.invitation = inv;
    } else {
      byEmail.set(key, {
        emailKey: key,
        email: inv.email,
        status: "invited",
        userId: null,
        displayName: null,
        roles: [inv.role],
        lastSignInAt: null,
        invitation: inv,
      });
    }
  }

  return Array.from(byEmail.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === "invited" ? -1 : 1;
    return a.emailKey.localeCompare(b.emailKey);
  });
}

/** Case-insensitive filter over a Person list (display name or email). Empty query = passthrough. */
export function filterPeopleList(query: string, people: Person[]): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter(
    (p) => (p.displayName ?? "").toLowerCase().includes(q) || p.emailKey.includes(q),
  );
}
