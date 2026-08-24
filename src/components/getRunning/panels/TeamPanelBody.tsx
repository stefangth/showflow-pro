import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useInvitationMutations } from "@/hooks/useInvitationMutations";
import { roleLabel } from "@/config/app.config";
import { isValidEmail } from "@/components/admin/people/peopleMatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnlocksNote } from "./UnlocksNote";

/** Two-letter initials from a display name (or the local part of an email as a fallback).
 *  Mirrors PersonRow's helper — kept local since this panel needs no other admin/people
 *  UI, and the well below uses fixed accent tones (not the seeded avatar palette) per
 *  the design spec, so there is nothing else to share with that module. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The `team` task's in-panel body (screen 02 "values" shape): the current roster, an
 * email field, and a fixed "Production Team" role, wired straight to the existing
 * `create-invitation` path (`useInvitationMutations`) — no link-out to People. Only
 * ever mounted for an admin viewer: `team.adminOnly` makes `actionableByViewer` false
 * for a producer, so `TaskPanel` renders `WaitsOnPanelBody` instead of this component
 * for anyone else (see TaskPanel.tsx) — this body does not re-check the role itself.
 */
export function TeamPanelBody({ orgId }: { orgId: string | null }) {
  const { t } = useTranslation("getRunning");
  const { data: members } = useOrgMembers(orgId);
  const { create } = useInvitationMutations(orgId);
  const [email, setEmail] = useState("");

  const trimmed = email.trim();
  const canSend = !!orgId && isValidEmail(trimmed) && !create.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    create.mutate(
      { email: trimmed, role: "producer" },
      // Does NOT call onDone: sending an invite only creates a pending
      // org_invitations row, and the `team` task's done condition counts ACCEPTED
      // members (producerCount > 0), so the invite alone doesn't satisfy it yet.
      // Mirrors PeoplePanelBody, which stays open the same way.
      { onSuccess: () => { setEmail(""); } },
    );
  };

  return (
    <div className="space-y-3">
      {(members ?? []).length > 0 && (
        <div className="space-y-1.5 rounded-card bg-well-tint p-2.5">
          {(members ?? []).map((m) => {
            const name = m.display_name || m.email || "";
            return (
              <div key={m.user_id} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-tint text-eyebrow font-semibold text-accent-text">
                  {initials(name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {m.roles[0] ? roleLabel(m.roles[0]) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <Label
          htmlFor="team-invite-email"
          // eslint-disable-next-line no-restricted-syntax -- form <Label>, not a block eyebrow: <Eyebrow> renders a <p> and would drop the htmlFor association
          className="text-eyebrow uppercase tracking-wider text-muted-foreground"
        >
          {t("panel.body.team.emailLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="team-invite-email"
            type="email"
            className="h-8 flex-1"
            placeholder={t("panel.body.team.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <span className="flex shrink-0 items-center rounded-field border border-border bg-well-tint px-2.5 text-xs font-medium text-muted-foreground">
            {roleLabel("producer")}
          </span>
        </div>
        <Button type="submit" size="sm" disabled={!canSend}>
          {t("panel.body.team.send")}
        </Button>
      </form>

      <UnlocksNote>{t("panel.body.team.unlocks")}</UnlocksNote>
    </div>
  );
}
