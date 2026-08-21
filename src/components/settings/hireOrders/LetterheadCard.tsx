import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { uploadAgentSignature, fetchAgentSignatureUrl } from "@/data/hireOrders";
import type { Json } from "@/integrations/supabase/types";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { LETTERHEAD_DEFAULT } from "./defaults";
import { linesFromText, serializeLines } from "@/lib/hireOrders/letterhead";
import { LetterheadFields } from "./fields/LetterheadFields";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function LetterheadCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const { t } = useTranslation("settingsHireOrders");
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    enabled: Boolean(orgId),
  });

  // A view of the stored letterhead, not a copy seeded into state by an effect:
  // Save persists `form` verbatim, and a seeded copy is still the blank default
  // in the commit that opens the `isLoading` gate below. An unrelated refetch
  // still cannot clobber edits in progress -- see useDerivedDraft.
  const [form, setForm] = useDerivedDraft<Letterhead>(data, LETTERHEAD_DEFAULT);
  const [addressText, setAddressText] = useDerivedDraft<string>(
    data ? serializeLines(data.address_lines) : undefined,
    "",
  );

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      const payload: Letterhead = { ...form, address_lines: linesFromText(addressText) };
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(t("letterheadCard.saved"));
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
      toast.success(t("letterheadCard.signatureUploaded"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  function onPickSignatureFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.type !== "image/png") {
      toast.error(t("letterheadCard.pngOnly"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl.startsWith("data:image/png;base64,")) uploadSig.mutate(dataUrl);
      else toast.error(t("letterheadCard.pngOnly"));
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
        <AlertDescription>{t("letterheadCard.loadError")} {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("letterheadCard.title")}</CardTitle>
        <CardDescription>
          {t("letterheadCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LetterheadFields
          value={form}
          addressText={addressText}
          onChange={setForm}
          onAddressTextChange={setAddressText}
          readOnly={readOnly}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ho-agent-name">{t("letterheadCard.agentName")}</Label>
              <Input
                id="ho-agent-name"
                value={form.agent_name ?? ""}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, agent_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-agent-email">{t("letterheadCard.agentEmail")}</Label>
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
            <Label>{t("letterheadCard.agentSignature")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("letterheadCard.agentSignatureHelp")}
            </p>
            {hasSignature && (
              <div className="flex items-center gap-3 rounded-md border border-border p-2 w-fit">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t("letterheadCard.signaturePreviewAlt")}
                    className="h-12 w-auto max-w-[200px] object-contain"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">{t("letterheadCard.signatureOnFile")}</span>
                )}
                {!readOnly && (
                  <Button type="button" variant="destructive" size="sm" onClick={removeSignature}>
                    {t("letterheadCard.remove")}
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
                  aria-label={t("letterheadCard.uploadAria")}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadSig.isPending || !orgId}
                  onClick={() => fileRef.current?.click()}
                >
                  {hasSignature ? t("letterheadCard.replaceSignature") : t("letterheadCard.uploadPng")}
                </Button>
              </>
            )}
          </div>
        </LetterheadFields>
        <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
          {t("letterheadCard.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
