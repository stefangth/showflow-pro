import { useState } from "react";
import { useImportTermsTemplates, useOrgTerms, useTermsLibrary } from "@/hooks/useHireOrderSetup";
import { TermsLibraryPicker } from "@/components/settings/hireOrders/fields/TermsLibraryPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The rail's terms panel: pick one or more platform templates and copy them into this
 *  org. An org owns its copy, so a later platform edit never changes terms it is
 *  already issuing. Editing the wording stays in Settings. */
export function TermsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  const importTerms = useImportTermsTemplates(orgId);
  const [picked, setPicked] = useState<string[]>([]);

  if (library.isLoading || terms.isLoading) return <Skeleton className="h-24 w-full" />;
  // The import APPENDS to the org's current terms, so rendering the picker over a
  // failed read is how "add a template" turns into "replace the contract library".
  // useImportTermsTemplates refuses to run in that state too; this is the visible half.
  if (terms.isError || library.isError) {
    const err = (terms.error ?? library.error) as Error;
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the terms library. {err.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Start from a template. You get your own copy, and you can edit the wording or add more variants later in Settings.
      </p>
      <TermsLibraryPicker
        idPrefix="rail-terms"
        library={library.data ?? []}
        selectedIds={picked}
        alreadyHeldIds={(terms.data?.templates ?? []).map((t) => t.id)}
        onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      />
      <Button
        size="sm"
        disabled={picked.length === 0 || importTerms.isPending || !orgId}
        onClick={() => importTerms.mutate({ templateIds: picked }, { onSuccess: () => { setPicked([]); onDone(); } })}
      >
        Add to this organization
      </Button>
    </div>
  );
}
