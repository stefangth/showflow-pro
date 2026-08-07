import { useState } from "react";
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import type { BookingSetupStepKey, BlockKind } from "@/lib/bookings/setupStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SetupStepRow, type SetupStepBlock } from "@/components/setup/SetupStepRow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { FlowStep } from "./FlowStep";
import { SlotsStep } from "./SlotsStep";
import { LadderStep } from "./LadderStep";
import { EligibilityStep } from "./EligibilityStep";
import { TimingStep } from "./TimingStep";
import { RehearsalBlock } from "./RehearsalBlock";
import { BookingProducerWaitingCard } from "./BookingProducerWaitingCard";

const TITLES: Record<BookingSetupStepKey, string> = {
  flow: "Booking flow",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Response window and digests",
};

const HINTS: Record<BookingSetupStepKey, { todo: string; done: string }> = {
  flow: { todo: "Offers, or straight to booked. Everything downstream reads this.", done: "Chosen. Change it any time in Settings." },
  slots: { todo: "A show with no slot count never reads as full.", done: "Set on every show." },
  ladder: { todo: "The order offers go out in, per city.", done: "Every scheduled city has a tier-1 cast." },
  eligibility: { todo: "Which casts can be offered which show in which city.", done: "Every scheduled show and city has a cast." },
  timing: { todo: "How long artists get, and when mail goes out.", done: "Window and digest hours set." },
};

const BLOCK_CHIP: Record<Exclude<BlockKind, null>, SetupStepBlock> = {
  offers: { label: "Blocks offers", tone: "risk" },
  filling: { label: "Blocks filling", tone: "neutral" },
};

/**
 * The bookings setup rail beside the Shows and bookings table. Renders nothing once setup
 * is complete or the viewer hid it (that decision lives in `useBookingSetupRailVisible`,
 * which the page also reads to choose its grid template). Setup happens here, but every
 * panel writes through the same path as its Settings card.
 */
export function BookingSetupRail({ orgId }: { orgId: string | null }) {
  const canEdit = useCan("edit_booking_settings");
  const { status, coverage } = useBookingSetupStatus(orgId);
  const [, dismiss] = useRailDismissed("bookingSetup", orgId);
  const [open, setOpen] = useState<BookingSetupStepKey | null>("flow");

  if (!canEdit) return <BookingProducerWaitingCard steps={status.steps} />;

  const toggle = (key: BookingSetupStepKey) => setOpen((cur) => (cur === key ? null : key));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Set up · {status.doneCount} of {status.totalCount}
            </p>
            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={dismiss}>Hide</Button>
          </div>
          <p className="mt-1.5 font-display text-base font-semibold">Get bookings running</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Dates keep syncing and you can edit them now. These are what the first offer needs.
          </p>
          <div className="mt-3 flex gap-1">
            {status.steps.map((s) => (
              <span key={s.key} className={`h-[3px] w-full rounded-full ${s.done ? "bg-accent-500" : "bg-muted"}`} />
            ))}
          </div>
        </div>
        <div>
          {status.steps.map((s, i) => (
            <SetupStepRow
              key={s.key}
              index={i + 1}
              title={TITLES[s.key]}
              hint={s.done ? HINTS[s.key].done : HINTS[s.key].todo}
              done={s.done}
              block={s.block ? BLOCK_CHIP[s.block] : null}
              expanded={open === s.key}
              onToggle={() => toggle(s.key)}
            >
              {s.key === "flow" && <FlowStep orgId={orgId} onDone={() => setOpen("slots")} />}
              {s.key === "slots" && <SlotsStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "ladder" && <LadderStep coverage={coverage} />}
              {s.key === "eligibility" && <EligibilityStep coverage={coverage} />}
              {s.key === "timing" && <TimingStep orgId={orgId} onDone={() => setOpen(null)} />}
            </SetupStepRow>
          ))}
        </div>
        <RehearsalBlock orgId={orgId} />
      </CardContent>
    </Card>
  );
}
