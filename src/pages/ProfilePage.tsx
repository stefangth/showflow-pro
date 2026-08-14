import { useEffect, useRef, useState, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useMyProfile";
import { useFeature } from "@/hooks/useEntitlements";
import { usePasswordStatus } from "@/hooks/usePasswordStatus";
import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from "@/lib/notificationCategories";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotificationPreferences";
import type { NotificationPrefs } from "@/data/notificationPreferences";
import { exportMyData, deleteMyAccount } from "@/data/account";
import { ROUTES } from "@/config/app.config";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

const identitySchema = z.object({
  display_name: z.string().max(120, "Too long").optional().or(z.literal("")),
  phone: z.string().max(40, "Too long").optional().or(z.literal("")),
});
type IdentityValues = z.infer<typeof identitySchema>;

export default function ProfilePage() {
  const { t } = useTranslation("profile");
  const { user } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateMyProfile();
  const navigate = useNavigate();
  const hireOrdersEnabled = useFeature("hire_orders");

  const identity = useForm<IdentityValues>({ resolver: zodResolver(identitySchema), values: { display_name: profile?.display_name ?? "", phone: profile?.phone ?? "" } });

  const passwordStatus = usePasswordStatus();
  const [editingPassword, setEditingPassword] = useState(false);
  const passwordActionRef = useRef<HTMLButtonElement>(null);
  const closePasswordForm = () => {
    setEditingPassword(false);
    window.setTimeout(() => passwordActionRef.current?.focus(), 0);
  };
  const completePasswordForm = () => {
    closePasswordForm();
  };

  useEffect(() => { document.title = t("page.documentTitle"); }, [t]);

  // Notification preferences
  const { data: notifPrefs } = useNotificationPreferences();
  const updateNotifPrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPrefs = notifPrefs ?? {};
  const isOn = (cat: string, chan: NotificationChannel) =>
    (prefs as Record<string, Record<string, boolean>>)[cat]?.[chan] !== false;
  const toggle = (cat: string, chan: NotificationChannel, value: boolean) => {
    const next: NotificationPrefs = {
      ...prefs,
      [cat]: { ...(prefs as Record<string, Record<string, boolean>>)[cat], [chan]: value },
    };
    updateNotifPrefs.mutate(next, { onError: (e) => toast.error((e as Error).message) });
  };

  // Data export
  const [exporting, setExporting] = useState(false);
  const downloadMyData = async () => {
    setExporting(true);
    try {
      const doc = await exportMyData(supabase);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `showflow-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t("data.downloaded"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // Account deletion
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    if (confirmText !== "DELETE") return; // defense-in-depth beyond the disabled attr
    setDeleting(true);
    try {
      await deleteMyAccount(supabase);
      await supabase.auth.signOut();
      toast.success(t("delete.deleted"));
      navigate(ROUTES.LOGIN);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.subtitle")}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">{t("details.title")}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <form
              onSubmit={identity.handleSubmit((v) =>
                updateProfile.mutate(
                  { display_name: v.display_name || null, phone: v.phone || null },
                  { onSuccess: () => toast.success(t("details.saved")), onError: (e) => toast.error((e as Error).message) },
                ),
              )}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("details.email")}</Label>
                <Input id="email" value={user?.email ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="display_name">{t("details.displayName")}</Label>
                <Input id="display_name" {...identity.register("display_name")} />
                {identity.formState.errors.display_name && <p className="text-xs text-destructive">{identity.formState.errors.display_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("details.phone")}</Label>
                <Input id="phone" {...identity.register("phone")} />
                {identity.formState.errors.phone && <p className="text-xs text-destructive">{identity.formState.errors.phone.message}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("details.contactNote")}
              </p>
              <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? t("details.saving") : t("details.save")}</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">{t("security.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:flex-1">
              <div>
                <p className="text-sm font-medium">{t("security.magicLinks")}</p>
                <p className="text-xs text-muted-foreground">{t("security.magicLinksHint")}</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">{t("security.active")}</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:flex-1">
                <div>
                  <p className="text-sm font-medium">{t("security.password")}</p>
                  <p className="text-xs text-muted-foreground">{t("security.passwordHint")}</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  {passwordStatus.isLoading ? t("security.statusChecking") : passwordStatus.isError ? t("security.statusUnavailable") : passwordStatus.data ? t("security.statusSet") : t("security.statusNotSet")}
                </span>
              </div>
              {!editingPassword && !passwordStatus.isLoading && !passwordStatus.isError && (
                <Button ref={passwordActionRef} type="button" variant="outline" onClick={() => setEditingPassword(true)}>
                  {passwordStatus.data ? t("security.changePassword") : t("security.addPassword")}
                </Button>
              )}
              {passwordStatus.isError && (
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <p className="text-sm text-destructive">{t("security.statusError")}</p>
                  <Button type="button" variant="outline" onClick={() => void passwordStatus.refetch()}>{t("security.retry")}</Button>
                </div>
              )}
            </div>
            {editingPassword && (
              <PasswordSetupForm mode={passwordStatus.data ? "change" : "setup"} onSuccess={completePasswordForm} onCancel={closePasswordForm} />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">{t("notifications.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("notifications.description")}
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-3 items-center">
            <div />
            <span className="text-xs uppercase text-muted-foreground text-center">{t("notifications.columnEmail")}</span>
            <span className="text-xs uppercase text-muted-foreground text-center">{t("notifications.columnInApp")}</span>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <Fragment key={c.key}>
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                {NOTIFICATION_CHANNELS.map((chan) => (
                  <div key={chan} className="flex justify-center">
                    <Switch
                      aria-label={t("notifications.channelAria", { category: c.label, channel: chan === "in_app" ? t("notifications.channelInApp") : t("notifications.channelEmail") })}
                      checked={isOn(c.key, chan)}
                      onCheckedChange={(v) => toggle(c.key, chan, v)}
                    />
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">{t("data.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("data.description")}
          </p>
          <Button variant="outline" onClick={downloadMyData} disabled={exporting}>
            {exporting ? t("data.preparing") : t("data.download")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="font-display text-destructive">{t("delete.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("delete.description")}
            {hireOrdersEnabled ? ` ${t("delete.hireOrdersNote")}` : ""}
          </p>
          <AlertDialog onOpenChange={(o) => { if (!o) { setConfirmText(""); setDeleting(false); } }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">{t("delete.trigger")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete.dialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("delete.confirmBefore")} <strong>DELETE</strong> {t("delete.confirmAfter")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input placeholder="DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText !== "DELETE" || deleting}
                  onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                >
                  {deleting ? t("delete.deleting") : t("delete.confirmAction")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
