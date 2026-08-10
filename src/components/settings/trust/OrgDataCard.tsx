import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgDataStats } from "@/hooks/useTrustStats";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useAuth } from "@/features/auth/AuthContext";
import { roleLabel } from "@/config/app.config";

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
  if (isError) {
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
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <TileValue {...state} />
      <div className="text-xs leading-4 text-muted-foreground">{note}</div>
    </div>
  );
}

/** "This organisation's data" — what the active org holds, where it sits, and
 *  who outside it can reach the rows. */
export function OrgDataCard() {
  const { currentOrg } = useAuth();
  const stats = useOrgDataStats();
  const members = useOrgMembers(currentOrg?.id);

  const admins = members.data?.filter((m) => m.roles.includes("admin")).length ?? 0;
  const producers = members.data?.filter((m) => m.roles.includes("producer")).length ?? 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">This organisation's data</h3>
          <p className="text-sm text-muted-foreground">
            What {currentOrg?.name ?? "this workspace"} holds today, where it sits, and who outside
            your organisation can reach it. Nobody.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Region"
            value="EU · Ireland"
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
            value={members.data ? `${members.data.length} people` : ""}
            note={
              members.data
                ? `${admins} ${admins === 1 ? "administrator" : "administrators"} · ${producers} ${roleLabel("producer").toLowerCase()}.`
                : "People with a login to this organisation."
            }
            isLoading={members.isLoading}
            isError={members.isError}
          />
          <Tile
            label="Outside reach"
            value="None"
            note="No other organisation can read a row."
            isLoading={false}
            isError={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}
