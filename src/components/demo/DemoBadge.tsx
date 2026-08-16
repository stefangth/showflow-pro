import { Badge } from "@/components/ui/badge";
import { useDemo } from "@/features/demo/DemoContext";

/** A small "DEMO" pill in the sidebar user card, visible only inside a demo org. */
export function DemoBadge() {
  const { isDemoOrg } = useDemo();
  if (!isDemoOrg) return null;
  return (
    <Badge variant="outline" className="mt-2 border-primary text-primary">
      DEMO
    </Badge>
  );
}
