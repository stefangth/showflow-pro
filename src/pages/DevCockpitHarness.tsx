/**
 * DEV-ONLY visual harness for the Show Date Cockpit. Renders the real cockpit
 * presentational components against the exact Nutcracker/Tour-B seed used by the
 * design prototype (`public/ref/cockpit.html`), so the two can be screenshotted
 * and compared pixel-for-pixel. Never mounted in production — App.tsx gates the
 * route behind `import.meta.env.DEV`, and it uses only mock props (no Supabase).
 *
 * URL params: ?tab=cast|offers|order|chat|setup  ?flow=classic|direct  ?peek=1
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CockpitShell } from "@/components/shows/date/CockpitShell";
import { CockpitPager } from "@/components/shows/date/CockpitPager";
import { CockpitHeader, type CockpitTab } from "@/components/shows/date/CockpitHeader";
import { CockpitRail } from "@/components/shows/date/CockpitRail";
import { CockpitFooter } from "@/components/shows/date/CockpitFooter";
import { CockpitCastList, type CastGroup } from "@/components/shows/date/CockpitCastList";
import { RowPeek } from "@/components/bookings/RowPeek";
import { computeDatePeek } from "@/lib/bookingCockpit";

const noop = () => {};

const CAST_GROUPS: CastGroup[] = [
  {
    key: "main",
    title: "Main cast",
    count: "2 of 4",
    rows: [
      { id: "mk", name: "Marek Kowalczyk", tone: "green", status: "confirmed", meta: "Tier 1 · confirmed 09 Mar" },
      { id: "as", name: "Anja Sørensen", tone: "green", status: "confirmed", meta: "Tier 1 · confirmed 09 Mar" },
      { id: "tb", name: "Tomás Brand", tone: "violet", status: "accepted", meta: "Tier 2 · accepted 11:04", onConfirm: noop },
      { id: "main-open", open: true, meta: "Tier 2 · 3 offers pending", slotActionLabel: "Open next tier", onSlotAction: noop },
    ],
  },
  {
    key: "us",
    title: "Understudies",
    count: "1 of 2",
    rows: [
      { id: "pd", name: "Priya Devi", tone: "amber", status: "confirmed", meta: "Tier 1 · confirmed 09 Mar" },
      { id: "lv", name: "Lena Vogt", tone: "amber", status: "accepted", meta: "Tier 2 · accepted 10:38", onConfirm: noop },
    ],
  },
];

const ACTIVITY = [
  { iso: "2026-03-12T11:04:00", text: "Tomás Brand accepted tier 2" },
  { iso: "2026-03-12T10:38:00", text: "Lena Vogt accepted tier 2" },
  { iso: "2026-03-12T09:12:00", text: "Tier 2 opened — 5 offers sent" },
  { iso: "2026-03-09T00:00:00", text: "Tier 1 closed — 2 confirmed" },
];

function useParam(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export default function DevCockpitHarness() {
  const tab = useParam("tab", "cast") as CockpitTab;
  const flow = useParam("flow", "classic");
  const showPeek = useParam("peek", "0") === "1";
  const classic = flow !== "direct";
  const { t: tBooking } = useTranslation("bookingCopy");

  const peek = useMemo(
    () => computeDatePeek({ counts: { confirmedMain: 2, confirmedUs: 1, acceptedMain: 1, acceptedUs: 1 }, slots: { main_cast: 4, understudies: 2 }, t: tBooking }),
    [tBooking],
  );

  if (showPeek) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-10">
        {/* Hug the RowPeek's own width (320px), mirroring the real app's
            `PopoverContent w-auto` so there is no right-side dead space. */}
        <div className="mx-auto w-fit rounded-[var(--radius-l)] border border-border bg-[var(--surface)] shadow-elev3">
          <RowPeek dateLabel="Thu 12 Mar" peek={peek} canConfirm confirming={false} onConfirm={noop} onOpen={noop} />
        </div>
      </div>
    );
  }

  const header = (
    <>
    <CockpitPager label="Date 3 of 11" onPrev={noop} onNext={noop} prevDisabled={false} nextDisabled={false} />
    <CockpitHeader
      title="Nutcracker · Tour B"
      dateLine="Thursday, 12 March 2026"
      metaLine="14:00 / 19:30 · Volksbühne, Berlin"
      slots={{ main_cast: 4, understudies: 2 }}
      confirmedCount={3}
      acceptedCount={2}
      statusText={classic ? "Tier 2 open · 3 offers expire today 17:00" : "Direct booking · 3 slots still to book"}
      statusTone={classic ? "amber" : "muted"}
      workflowCta={{ kind: "confirm", label: "Confirm 2 accepted" }}
      onWorkflowCta={noop}
      showGenerateHireOrder={false}
      generateDisabled
      onGenerate={noop}
      flowLabel={classic ? "Classic offers" : "Direct booking"}
      onEditFlow={noop}
      tabs={[
        { id: "cast", label: "Cast" },
        { id: "offers", label: classic ? "Offers" : "Book artists" },
        { id: "order", label: "Hire order", badge: "3 LEFT" },
        { id: "chat", label: "Chat", badge: "3" },
        { id: "setup", label: "Setup" },
      ]}
      activeTab={tab}
      onTab={noop}
      overflowActions={[{ label: "Edit date setup", onSelect: noop }]}
    />
    </>
  );

  const rail = (
    <CockpitRail
      times="14:00 / 19:30"
      venue="Volksbühne"
      city="Berlin"
      source="airtable"
      notes={null}
      castChips={[
        { label: "Cast A", kind: "inherited" },
        { label: "Cast C", kind: "override" },
      ]}
      skillChips={["Aerial rig", "Pointe"]}
      upNext={[
        { kind: "digest", tone: "violet", text: "Digest sends daily · 18:00" },
        { kind: "escalate", tone: "neutral", text: "Auto-escalate: off" },
      ]}
      activity={ACTIVITY}
      chatUnread={3}
      chatPreview={'Lena Vogt · "Can I swap to the 19:30 only?"'}
      onOpenChat={noop}
      onEditSetup={noop}
    />
  );

  const footer = (
    <CockpitFooter badgeLabel="3 LEFT" ready={false} detail="Waiting on 3 of 6 slots" ctaLabel="Generate" ctaDisabled onCta={noop} />
  );

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6">
      <div className="mx-auto w-full max-w-[1080px] overflow-hidden rounded-[var(--radius-xl)] border-[0.5px] border-[var(--line)] shadow-elev2">
        <CockpitShell header={header} rail={rail} footer={footer}>
          {tab === "cast" && <CockpitCastList groups={CAST_GROUPS} />}
          {tab === "offers" && (
            <div className="text-sm text-muted-foreground">
              {classic ? "Offers tab (TierTimeline in the live sheet)." : "Book artists tab (EligibilityBookList in the live sheet)."}
            </div>
          )}
          {tab === "order" && <div className="text-sm text-muted-foreground">Hire order tab (HireOrdersCard in the live sheet).</div>}
          {tab === "chat" && <div className="text-sm text-muted-foreground">Chat tab (ChatPanel in the live sheet).</div>}
          {tab === "setup" && <div className="text-sm text-muted-foreground">Setup tab (date configuration in the live sheet).</div>}
        </CockpitShell>
      </div>
    </div>
  );
}
