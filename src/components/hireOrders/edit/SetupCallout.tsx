import type { Blocker } from "@/lib/hireOrders/preflight";
import { BlockerList } from "@/components/hireOrders/BlockerList";

/**
 * Org-level gaps, called out over the live document preview.
 *
 * Only org-scoped blockers appear here: the order's own fields are already on screen in
 * the left column, with their own provenance chips, so repeating them would be noise.
 * The point is the gap you can SEE on the document but cannot fix from the form.
 *
 * Renders nothing when there is nothing org-level to say, so it never occupies space on
 * a configured org.
 */
export function SetupCallout({ orgId, blockers }: { orgId: string | null; blockers: Blocker[] }) {
  const orgBlockers = blockers.filter((b) => b.scope === "org");
  if (orgBlockers.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 p-3">
      <p className="text-sm font-semibold text-accent-700">
        {orgBlockers.some((b) => b.key === "missing_letterhead")
          ? "The header on this document is empty"
          : "The back page of this document is empty"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Set it once here and every future order carries it. This is not specific to this order.
      </p>
      <div className="mt-3">
        <BlockerList orgId={orgId} blockers={orgBlockers} idPrefix="callout" onFixOrderField={() => {}} />
      </div>
    </div>
  );
}
