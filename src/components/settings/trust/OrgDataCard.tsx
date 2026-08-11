import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgDataStats } from "@/hooks/useTrustStats";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useAuth } from "@/features/auth/AuthContext";
import { roleLabel } from "@/config/app.config";
import { DATABASE_REGION } from "@/lib/trust/facts";

/** A tile's value: a loaded string, or the loading/failed state.
 *  A failed count renders as an em-dash rather than a zero — this card exists
 *  to be accurate, and "0 bookings" would be a false statement, not a gap. */
function TileValue({
  isLoading,
  isError,
  value,
}: {
  isLoading: boolean;
  isError: boolean;
  value: string;
}) {
  if (isLoading) return <Skeleton className="h-5 w-24" />;
  // Any state that is not a loaded value degrades to the same honest dash:
  // an explicit error, or a query that never resolved (offline, disabled,
  // paused) and left `value` empty. Neither is a "0", which would be false.
  if (isError || !value) {
    return (
      <span className="font-mono text-sm text-muted-foreground" title="Could not be read just now">
        —
      </span>
    );
  }
  return <span className="font-mono text-sm font-medium tabular-nums">{value}</span>;
}

function Tile({
  label,
  note,
  ...state
}: {
  label: string;
  note: string;
  isLoading: boolean;
  isError: boolean;
  value: string;
}) {
  return (
    // A hairline, not a hint. `bg-muted/50` with no border and no shadow drew
    // no container at all: sampled from the running app across the tile's top
    // edge, the step was card rgb(255,255,255) -> tile rgb(252,251,250) in
    // light and rgb(21,20,25) -> rgb(25,24,29) in dark — 1.03:1 and 1.04:1,
    // three units of grey and nothing else. The public page draws these same
    // four facts as real cards (var(--surface) + 0.5px var(--line) +
    // var(--shadow-1) on the page ground), so the most prominent shared
    // element on the two surfaces was a tile on one and an invisible one on
    // the other. `border-border` is the app's equivalent of `--line`; the fill
    // goes to full `bg-muted` so the edge is not the only thing carrying it.
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <TileValue {...state} />
      {/* `break-words` is load-bearing, not tidiness: the Outside-reach note
       *  carries `supabase/tests/rls/org_isolation.sql`, a single token with no
       *  natural break opportunity. Without it the token overflowed the tile,
       *  the Card and the settings column at every desktop width (measured:
       *  the tab's content column is 772px wide while its subtree reported a
       *  791px scrollWidth), and was clipped at the viewport edge at 1024.
       *  The citation is the whole evidentiary content of that tile, so it has
       *  to survive rather than be shortened. */}
      <div className="break-words text-xs leading-4 text-muted-foreground">{note}</div>
    </div>
  );
}

/** "This organisation's data" — what the active org holds, where it sits, and
 *  who outside it can reach the rows. */
export function OrgDataCard() {
  const { currentOrg, hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const stats = useOrgDataStats();
  // list_org_members is admin-only server-side (see
  // supabase/migrations/20260622164208_list_org_members_last_sign_in.sql), so
  // a production-team viewer's read is a permanent authorization boundary,
  // not a transient failure. Withhold the org id rather than the viewer's
  // role: firing the RPC anyway would 42501 on every mount and the tile would
  // render the generic "could not be read" dash, misstating why.
  const members = useOrgMembers(isAdmin ? currentOrg?.id : undefined);

  // Counts of role holders, not a partition of the headline. `list_org_members`
  // aggregates a user's roles, so one person can appear in two of these, and
  // the three together are the whole roster only when nobody holds two roles.
  // The note says "Roles held" for exactly that reason: the earlier
  // "N administrators · M production team" read as a breakdown of the headline
  // and silently dropped every artist, so the tile appeared to be concealing
  // members in every organisation that has any.
  const admins = members.data?.filter((m) => m.roles.includes("admin")).length ?? 0;
  const producers = members.data?.filter((m) => m.roles.includes("producer")).length ?? 0;
  const artists = members.data?.filter((m) => m.roles.includes("artist")).length ?? 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">This organisation's data</h3>
          <p className="text-sm text-muted-foreground">
            What {currentOrg?.name ?? "this workspace"} holds today, where it sits, and which other
            organisations on ShowFlow Pro can reach it. None.
          </p>
        </div>
        {/* Two-up is the ceiling here, and `lg:grid-cols-4` was the trap
         *  `VisibilityMatrix.tsx` documents one file over: Tailwind's `lg:` is
         *  a VIEWPORT query, but this tab renders inside the app sidebar plus
         *  the settings nav column, and `SettingsPage`'s cap takes its own
         *  width out of that again, so the tab's content column is far
         *  narrower than the display. Measured live in the running app
         *  (content column / two-up tile width):
         *    768 -> 468 / 207   1024 -> 504 / 225   1280 -> 760 / 353
         *    1440 -> 920 / 433  1920 -> 1028 / 487
         *  A 4-up row therefore had ~107px per tile at 1024, where "OUTSIDE
         *  REACH" wrapped its own label and the citation was cut at the card
         *  edge, and ~211px at the 1920 ceiling. Two-up clears 200px at every
         *  width the tab is shown at. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The region is imported, not retyped. It used to be a JSX literal
           *  ("EU · Ireland") saying the same thing as the public page's KPI
           *  in different words, which meant moving the project would have
           *  left this tab publishing the old region with every check green.
           *  factsSingleSource.test.ts fails if it comes back as a literal. */}
          <Tile
            label="Region"
            value={DATABASE_REGION}
            note="Managed Postgres, encrypted at rest."
            isLoading={false}
            isError={false}
          />
          <Tile
            label="Records"
            value={stats.data ? `${stats.data.bookings.toLocaleString()} bookings` : ""}
            note={
              stats.data
                ? `${stats.data.artists} artists · ${stats.data.productions} productions.`
                : "Bookings, artists, and productions."
            }
            isLoading={stats.isLoading}
            isError={stats.isError}
          />
          <Tile
            label="Members"
            value={!isAdmin ? "Admin only" : members.data ? `${members.data.length} people` : ""}
            note={
              !isAdmin
                ? "Visible to organisation administrators."
                : members.data
                  ? `Roles held: ${admins} ${admins === 1 ? "administrator" : "administrators"} · ${producers} ${roleLabel("producer").toLowerCase()} · ${artists} ${artists === 1 ? "artist" : "artists"}.`
                  : "People with a login to this organisation."
            }
            isLoading={isAdmin && members.isLoading}
            isError={isAdmin && members.isError}
          />
          {/* Two citations, not one, and for the same reason CONTROLS[0] in
           *  facts.ts carries two: org_isolation.sql sets up two orgs and
           *  asserts reads and writes on `shows` and `show_dates` only, so on
           *  its own it cannot support a claim about every row this
           *  organisation holds. org_coverage.sql is what covers the rest —
           *  org_id, RLS and the restrictive org_isolation policy across its
           *  whole tenant-table list, chat_messages and booking_audit_log
           *  included. This tile was the last uncorrected copy of a claim the
           *  Controls card had already been narrowed for, and it is the first
           *  evidence citation an administrator meets in-app. */}
          <Tile
            label="Outside reach"
            value="None"
            note="No other organisation can read a row. supabase/tests/rls/org_isolation.sql proves that for shows and show_dates, and supabase/tests/rls/org_coverage.sql confirms the restrictive policy exists on every tenant table in its list. Both run on every pull request."
            isLoading={false}
            isError={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}
