import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { uploadAgentSignature, fetchAgentSignatureUrl } from "@/data/hireOrders";
import type { Json } from "@/integrations/supabase/types";
import { LETTERHEAD_DEFAULT } from "./defaults";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The `hire_order_letterhead` app_settings value (spec §2.6). Rendered at the top of
 *  every hire order PDF alongside the "Hiring party" block. */
export interface Letterhead {
  legal_name: string;
  address_lines: string[];
  registration_line: string;
  agent_name?: string;
  agent_email?: string;
  /** Storage path of the org's booking-agent signature PNG (hire-orders bucket),
   *  drawn on the producer line of issued PDFs. Uploaded via the edge action;
   *  persisted here by Save. */
  agent_signature_path?: string | null;
}

/** One address line per row. On SAVE only: trim trailing whitespace per line
 *  (leading indentation + interior blanks preserved), then drop empty lines from
 *  the top and bottom so a stray leading/trailing Enter is not stored. */
function linesFromText(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}
function serializeLines(lines: string[]): string {
  return lines.join("\n");
}

export function LetterheadCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<Letterhead>(LETTERHEAD_DEFAULT);
  const [addressText, setAddressText] = useState<string>("");
  // Seed once when server data first arrives; a later unrelated refetch must not
  // clobber in-progress edits (the save's own refetch already matches the form).
  const seededRef = useRef(false);
  useEffect(() => {
    if (data && !seededRef.current) {
      seededRef.current = true;
      setForm(data);
      setAddressText(serializeLines(data.address_lines));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      const payload: Letterhead = { ...form, address_lines: linesFromText(addressText) };
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Letterhead saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Agent-signature upload: the edge action stores the PNG and returns its path +
  // a signed preview URL; the path lands in `form` and is persisted by Save.
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadSig = useMutation({
    mutationFn: (png: string) => uploadAgentSignature(supabase, { org_id: orgId!, signature_png: png }),
    onSuccess: ({ path, url }) => {
      setForm((f) => ({ ...f, agent_signature_path: path }));
      setSignaturePreviewUrl(url);
      toast.success("Signature uploaded. Save the letterhead to apply.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  function onPickSignatureFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.type !== "image/png") {
      toast.error("Please choose a PNG image");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl.startsWith("data:image/png;base64,")) uploadSig.mutate(dataUrl);
      else toast.error("Please choose a PNG image");
    };
    reader.readAsDataURL(file);
  }
  function removeSignature() {
    // Clears the reference only (persisted on the next Save). The PNG object is
    // intentionally left in storage: the hire-orders bucket has no client delete
    // policy (writes go through the service role), the path is fixed
    // (`<org>/agent-signature.png`) so a later re-upload overwrites it in place, and
    // a single orphaned PNG in the private, org-scoped bucket is harmless. Add a
    // service-role delete to the edge function if storage hygiene ever matters.
    setForm((f) => ({ ...f, agent_signature_path: null }));
    setSignaturePreviewUrl(null);
  }
  const hasSignature = !!(signaturePreviewUrl || form.agent_signature_path);
  // Preview an already-saved signature after a reload: the client can't sign the
  // storage URL itself, so fetch it via the admin edge action. Keyed on the
  // server-side path; superseded by a fresh upload's preview URL when present.
  const savedSignatureUrlQuery = useQuery({
    queryKey: ["hire-orders", "agent-signature-url", orgId, data?.agent_signature_path ?? null],
    enabled: Boolean(orgId && data?.agent_signature_path),
    queryFn: () => fetchAgentSignatureUrl(supabase, orgId!),
  });
  const previewUrl = signaturePreviewUrl ??
    (form.agent_signature_path ? savedSignatureUrlQuery.data ?? null : null);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  // Read failed: render the error INSTEAD of the form. Falling through would show
  // LETTERHEAD_DEFAULT's blank fields as if they were the org's saved values, and a
  // Save from there would overwrite a real stored letterhead with empty strings.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the letterhead settings. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

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
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ho-address">Address</Label>
          <Textarea
            id="ho-address"
            rows={3}
            value={addressText}
            placeholder={"Street and number\nPostal code and city\nCountry"}
            disabled={readOnly}
            onChange={(e) => setAddressText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">One line per row.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ho-registration">Registration line</Label>
          <Input
            id="ho-registration"
            value={form.registration_line}
            placeholder="Registered at Amtsgericht Berlin, HRB 123456"
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, registration_line: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-agent-name">Agent name (optional)</Label>
            <Input
              id="ho-agent-name"
              value={form.agent_name ?? ""}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, agent_name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-agent-email">Agent email (optional)</Label>
            <Input
              id="ho-agent-email"
              type="email"
              value={form.agent_email ?? ""}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, agent_email: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Agent signature (optional)</Label>
          <p className="text-xs text-muted-foreground">
            A PNG of the booking agent's signature, drawn on the producer line of issued hire orders. Save the letterhead to apply.
          </p>
          {hasSignature && (
            <div className="flex items-center gap-3 rounded-md border border-border p-2 w-fit">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Agent signature preview"
                  className="h-12 w-auto max-w-[200px] object-contain"
                />
              ) : (
                <span className="text-sm text-muted-foreground">Signature on file</span>
              )}
              {!readOnly && (
                <Button type="button" variant="ghost" size="sm" onClick={removeSignature}>
                  Remove
                </Button>
              )}
            </div>
          )}
          {!readOnly && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png"
                className="hidden"
                onChange={onPickSignatureFile}
                aria-label="Upload agent signature PNG"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadSig.isPending || !orgId}
                onClick={() => fileRef.current?.click()}
              >
                {hasSignature ? "Replace signature" : "Upload PNG"}
              </Button>
            </>
          )}
        </div>
        <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
          Save letterhead
        </Button>
      </CardContent>
    </Card>
  );
}
