import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchArtists } from "@/data/artists";
import { useCreateArtistLite } from "@/hooks/useHireOrders";
import { useCan } from "@/hooks/useCapabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArtistImportDialog } from "@/components/artists/ArtistImportDialog";
import { UnlocksNote } from "./UnlocksNote";

/**
 * The `people` task's in-panel body (screen 02 "values" shape): a roster count, an
 * inline single add-artist form wired straight to `useCreateArtistLite`, and an
 * "Import a sheet" button that opens the EXISTING `ArtistImportDialog` as a controlled
 * overlay. Replaces the old `PeopleStep`, which only linked out to `/artists` + `/admin`
 * (owner decision #1 in `.superpowers/sdd/2026-08-18-get-running-in-panel-editors`:
 * reuse the bulk-import wizard as an overlay rather than rebuild it inline, and drop the
 * link-out entirely — this panel's whole job is to make "add a roster" a task you finish
 * without leaving the board).
 *
 * `canInvite` mirrors ArtistsPage.tsx exactly (`useCan("invite_artists")`), since that is
 * the same dialog instance with the same "also send login invites" option.
 */
export function PeoplePanelBody({
  orgId,
  artistCount,
}: {
  orgId: string | null;
  artistCount: number | null;
}) {
  const { t } = useTranslation("getRunning");
  const add = useCreateArtistLite();
  const canInvite = useCan("invite_artists");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  // Only feeds ArtistImportDialog (which also dedups server-side), so there is no
  // reason to fetch the whole roster's emails until the dialog is actually opened.
  const { data: existingEmails } = useQuery({
    queryKey: ["artists", "emails", orgId],
    enabled: !!orgId && importOpen,
    queryFn: () =>
      fetchArtists(supabase, orgId!).then((rows) =>
        rows.map((a) => a.email).filter((e): e is string => !!e),
      ),
  });

  const trimmedName = name.trim();
  const canSubmit = !!orgId && trimmedName.length > 0 && !add.isPending;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    add.mutate(
      { orgId: orgId!, name: trimmedName, email: email.trim() || null },
      {
        // Stays open on purpose: adding a roster is typically a several-in-a-row
        // task, so only clear the form and let the ["artists"] invalidation from
        // useCreateArtistLite flip the board row to done underneath.
        onSuccess: () => {
          setName("");
          setEmail("");
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {artistCount !== null &&
        (artistCount === 0 ? (
          <Badge variant="neutral">{t("panel.body.people.emptyBadge")}</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="confirmed">
              {t("panel.body.people.activeBadge", { count: artistCount })}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("panel.body.people.rosterLabel", { count: artistCount })}
            </span>
          </div>
        ))}

      <form onSubmit={handleSubmit} className="space-y-2">
        <Label
          htmlFor="people-add-name"
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {t("panel.body.people.addLabel")}
        </Label>
        <Input
          id="people-add-name"
          className="h-8"
          placeholder={t("panel.body.people.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex gap-2">
          <Input
            type="email"
            className="h-8 flex-1"
            placeholder={t("panel.body.people.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {t("panel.body.people.add")}
          </Button>
        </div>
      </form>

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        {t("panel.body.people.or")}
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setImportOpen(true)}
      >
        {t("panel.body.people.importButton")}
      </Button>

      {orgId && (
        <ArtistImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          orgId={orgId}
          existingEmails={existingEmails ?? []}
          canInvite={canInvite}
        />
      )}

      <UnlocksNote>{t("panel.body.people.unlocks")}</UnlocksNote>
    </div>
  );
}
