import { Badge } from "@/components/ui/badge";
import { useDemo } from "@/features/demo/DemoContext";

/** A small "DEMO" pill in the sidebar user card, visible only inside a demo org.
 *  While the demo bar (and the run-of-show rail it shares a flag with) is hidden,
 *  the pill becomes a button that brings them back — otherwise "Hide demo bar" is a
 *  one-way trip that loses the teleprompter until a page reload. */
export function DemoBadge() {
  const { isDemoOrg, isBarHidden, showBar } = useDemo();
  if (!isDemoOrg) return null;

  if (isBarHidden) {
    return (
      <button type="button" onClick={showBar} className="mt-2 inline-flex" aria-label="Show demo controls">
        <Badge variant="outline" className="cursor-pointer border-primary text-primary hover:bg-primary/10">
          DEMO
        </Badge>
      </button>
    );
  }

  return (
    <Badge variant="outline" className="mt-2 border-primary text-primary">
      DEMO
    </Badge>
  );
}
