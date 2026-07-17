import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

/** The `hire_order_letterhead` app_settings value (spec §2.6). Rendered at the top of
 *  every hire order PDF alongside the "Hiring party" block. */
export interface Letterhead {
  legal_name: string;
  address_lines: string[];
  registration_line: string;
  agent_name?: string;
  agent_email?: string;
}

export const LETTERHEAD_DEFAULT: Letterhead = {
  legal_name: "",
  address_lines: [],
  registration_line: "",
  agent_name: "",
  agent_email: "",
};

/** One address line per row; blank rows are dropped on parse. */
function parseLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
function serializeLines(lines: string[]): string {
  return lines.join("\n");
}

export function LetterheadCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<Letterhead>(LETTERHEAD_DEFAULT);
  // Seed once when server data first arrives; a later unrelated refetch must not
  // clobber in-progress edits (the save's own refetch already matches the form).
  const seededRef = useRef(false);
  useEffect(() => {
    if (data && !seededRef.current) {
      seededRef.current = true;
      setForm(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Letterhead saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Letterhead</CardTitle>
        <CardDescription>
          Appears at the top of every hire order PDF alongside the Hiring party block.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ho-legal-name">Legal name</Label>
          <Input
            id="ho-legal-name"
            value={form.legal_name}
            placeholder="Aurora Productions GmbH"
            onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ho-address">Address</Label>
          <Textarea
            id="ho-address"
            rows={3}
            value={serializeLines(form.address_lines)}
            placeholder={"Street and number\nPostal code and city\nCountry"}
            onChange={(e) => setForm((f) => ({ ...f, address_lines: parseLines(e.target.value) }))}
          />
          <p className="text-xs text-muted-foreground">One line per row.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ho-registration">Registration line</Label>
          <Input
            id="ho-registration"
            value={form.registration_line}
            placeholder="Registered at Amtsgericht Berlin, HRB 123456"
            onChange={(e) => setForm((f) => ({ ...f, registration_line: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-agent-name">Agent name (optional)</Label>
            <Input
              id="ho-agent-name"
              value={form.agent_name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, agent_name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-agent-email">Agent email (optional)</Label>
            <Input
              id="ho-agent-email"
              type="email"
              value={form.agent_email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, agent_email: e.target.value }))}
            />
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save letterhead
        </Button>
      </CardContent>
    </Card>
  );
}
