import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StageMark } from "@/components/brand/StageMark";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { supabase } from "@/integrations/supabase/client";
import { fetchSandboxSnapshot } from "@/data/demo";
import { formatDateDMY, formatTimestampDMY } from "@/lib/dates";

/** Cap on visible date rows; the snapshot itself is already capped upstream, this is a
 *  belt-and-braces render limit so a larger-than-expected snapshot never floods the page. */
const MAX_VISIBLE_DATES = 25;

const REASON_COPY: Record<string, { title: string; message: string }> = {
  expired: {
    title: "This link has expired",
    message: "Sandbox links expire after 14 days. Ask your ShowFlow contact for a fresh one.",
  },
  revoked: {
    title: "This link is no longer available",
    message: "It was revoked. Ask your ShowFlow contact for a fresh one.",
  },
  not_found: {
    title: "Link not found",
    message: "This sandbox link does not exist. Check that you copied the full URL.",
  },
};

function TopBar() {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
      <div className="flex items-center gap-2">
        <StageMark variant="mark" size={24} />
        <BrandWordmark />
      </div>
      <Badge variant="accent">Demo, read only</Badge>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

export default function SandboxViewerPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sandbox", token],
    queryFn: () => fetchSandboxSnapshot(supabase, token as string),
    enabled: !!token,
  });

  // Treat a genuine query error, a missing :token (query stays idle), or an
  // explicit ok:false from the edge function all as the same "invalid link"
  // state, so the page never renders as a bare top-bar-and-footer shell.
  // Gate on the ABSENCE of a valid snapshot too: React Query keeps the last
  // successful `data` when a background refetch fails, so isError can be true
  // while a prior ok:true snapshot is still cached — without this guard the
  // error card and the snapshot table would render at the same time.
  const invalidReason =
    !isLoading && !data?.snapshot && (isError || !token || data?.ok === false)
      ? (data && data.ok === false && data.reason) || "not_found"
      : null;

  return (
    <main className="min-h-screen bg-background">
      <TopBar />

      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {isLoading && (
          <div className="space-y-6">
            <Skeleton className="h-8 w-64" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {invalidReason && (
          <div className="flex items-center justify-center py-16">
            <Card className="w-full max-w-md p-8 space-y-4 text-center">
              <div className="flex flex-col items-center gap-3 text-destructive">
                <XCircle className="h-10 w-10" />
                <h1 className="font-display text-xl font-semibold text-foreground">
                  {(REASON_COPY[invalidReason] ?? REASON_COPY.not_found).title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {(REASON_COPY[invalidReason] ?? REASON_COPY.not_found).message}
                </p>
              </div>
            </Card>
          </div>
        )}

        {!isLoading && data?.ok === true && data.snapshot && (
          <>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {data.snapshot.org.label}
              </h1>
              <p className="text-sm text-muted-foreground">
                As of {formatTimestampDMY(data.snapshot.generatedAt)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Upcoming dates" value={String(data.snapshot.kpis.upcomingDates)} />
              <StatCard label="Confirmed bookings" value={String(data.snapshot.kpis.confirmedBookings)} />
              <StatCard label="Fill rate" value={`${data.snapshot.kpis.fillRate}%`} />
              <StatCard label="Hire orders issued" value={String(data.snapshot.kpis.hireOrdersIssued)} />
            </div>

            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Shows</h2>
              <div className="flex flex-wrap gap-2">
                {data.snapshot.shows.map((show, i) => (
                  // Index key: the curated snapshot drops show ids and `showLabel` can
                  // repeat ("Untitled show"), so labels aren't unique; this list is never
                  // reordered or filtered client-side, so the index is stable.
                  <Badge key={i} variant="neutral">
                    {show.label}
                  </Badge>
                ))}
              </div>
            </Card>

            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Dates</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Show</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Filled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.snapshot.dates.slice(0, MAX_VISIBLE_DATES).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{formatDateDMY(d.date)}</TableCell>
                      <TableCell>{d.showLabel}</TableCell>
                      <TableCell>{d.city ?? "N/A"}</TableCell>
                      <TableCell>
                        <Badge variant="neutral">{d.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.filled}/{d.needed}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.snapshot.dates.length > MAX_VISIBLE_DATES && (
                <p className="text-xs text-muted-foreground">
                  +{data.snapshot.dates.length - MAX_VISIBLE_DATES} more
                </p>
              )}
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-4 space-y-3">
                <h2 className="text-sm font-semibold text-foreground">Bookings by status</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.snapshot.bookingsByStatus).map(([status, count]) => (
                    <Badge key={status} variant="neutral">
                      {status}: {count}
                    </Badge>
                  ))}
                </div>
              </Card>

              <Card className="p-4 space-y-3">
                <h2 className="text-sm font-semibold text-foreground">Hire orders</h2>
                <div className="flex flex-wrap gap-2">
                  {data.snapshot.hireOrders.length === 0 && (
                    <p className="text-sm text-muted-foreground">No hire orders yet.</p>
                  )}
                  {data.snapshot.hireOrders.map((order, i) => (
                    <Badge key={`${order.status}-${i}`} variant="neutral">
                      {order.showLabel ?? "Untitled"}: {order.status}
                    </Badge>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}

        <p className="pt-4 text-center text-xs text-muted-foreground">
          This is a read only demo. Links expire after 14 days.
        </p>
      </div>
    </main>
  );
}
