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
