import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Route, Clock, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useMyProfile";
import { useFeature } from "@/hooks/useEntitlements";
import { usePasswordStatus } from "@/hooks/usePasswordStatus";
import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type Lang } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@/lib/notificationCategories";
import { visibleNotificationCategories } from "@/lib/notificationAudience";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotificationPreferences";
import type { NotificationPrefs } from "@/data/notificationPreferences";
import { exportMyData, deleteMyAccount } from "@/data/account";
import { ROUTES, ROLES } from "@/config/app.config";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

const identitySchema = z.object({
  display_name: z.string().max(120, "Too long").optional().or(z.literal("")),
  phone: z.string().max(40, "Too long").optional().or(z.literal("")),
});
type IdentityValues = z.infer<typeof identitySchema>;

/** Uppercase eyebrow header for one settings-row group card (see the four-group layout).
 *  Renders as a real heading (not just a styled span) so the group titles stay in the
 *  page's heading outline and remain reachable via `getByRole('heading', ...)`. */
function GroupHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-well-tint">
      {/* eslint-disable-next-line no-restricted-syntax -- must stay a real <h3> for the heading outline/getByRole('heading'), not the <p>-based Eyebrow */}
      <h3 className="text-eyebrow font-semibold uppercase tracking-[1.2px] text-muted-foreground">{children}</h3>
      {right}
    </div>
  );
}

/** One value row inside a group card: label + hint on the left, a value/control on the right. */
function GroupRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 px-4 py-[13px] border-b border-border last:border-0", className)}>
      {children}
    </div>
  );
}

export default function ProfilePage() {
  const { t } = useTranslation("profile");
  const { user, hasRole } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateMyProfile();
  const navigate = useNavigate();
  const hireOrdersEnabled = useFeature("hire_orders");
  const languagePacksEnabled = useFeature("language_packages");
  const { lang, setLang } = useLanguage();

  const isProducerOrAdmin = hasRole(ROLES.ADMIN) || hasRole(ROLES.PRODUCER);
  const isArtistOnly = hasRole(ROLES.ARTIST) && !isProducerOrAdmin;
  const categories = visibleNotificationCategories({ isArtistOnly });

  const { data: artist } = useMyArtist({ enabled: isArtistOnly });
  const blockedDatesCount = useMyBlockedDatesCount(isArtistOnly ? (artist?.id ?? null) : null);
  const blockedCount = blockedDatesCount.data ?? 0;

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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold tracking-tight">{t("page.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("page.subtitle")}</p>
      </div>

      <div className="flex gap-5 items-start">
        <div className={cn("flex-1 min-w-0 space-y-4", !isArtistOnly && "max-w-2xl")}>

          {/* Details */}
          <div className="rounded-[var(--radius-l)] border border-border bg-card overflow-hidden shadow-elev1">
            <GroupHeader>{t("details.title")}</GroupHeader>
            {isLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : (
              <>
                <GroupRow>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t("details.email")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("details.emailHint")}</p>
                  </div>
                  <span className="font-mono text-xs text-foreground">{user?.email ?? ""}</span>
                  <Badge variant="neutral">{t("details.emailFixed")}</Badge>
                </GroupRow>
                <form
                  onSubmit={identity.handleSubmit((v) =>
                    updateProfile.mutate(
                      { display_name: v.display_name || null, phone: v.phone || null },
                      { onSuccess: () => toast.success(t("details.saved")), onError: (e) => toast.error((e as Error).message) },
                    ),
                  )}
                >
                  <GroupRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="display_name" className="text-sm font-medium">{t("details.displayName")}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("details.displayNameHint")}</p>
                    </div>
                    <div className="w-full sm:w-64">
                      <Input id="display_name" {...identity.register("display_name")} />
                      {identity.formState.errors.display_name && <p className="text-xs text-destructive mt-1">{identity.formState.errors.display_name.message}</p>}
                    </div>
                  </GroupRow>
                  <GroupRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="phone" className="text-sm font-medium">{t("details.phone")}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5 text-pretty">{t("details.contactNote")}</p>
                    </div>
                    <div className="w-full sm:w-64">
                      <Input id="phone" {...identity.register("phone")} />
                      {identity.formState.errors.phone && <p className="text-xs text-destructive mt-1">{identity.formState.errors.phone.message}</p>}
                    </div>
                  </GroupRow>
                  <div className="px-4 py-3">
                    <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? t("details.saving") : t("details.save")}</Button>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* Sign-in */}
          <div className="rounded-[var(--radius-l)] border border-border bg-card overflow-hidden shadow-elev1">
            <GroupHeader>{t("security.title")}</GroupHeader>
            <GroupRow>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("security.magicLinks")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("security.magicLinksHint")}</p>
              </div>
              <Badge variant="confirmed">{t("security.active")}</Badge>
            </GroupRow>
            <GroupRow className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("security.password")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("security.passwordHint")}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="neutral">
                  {passwordStatus.isLoading ? t("security.statusChecking") : passwordStatus.isError ? t("security.statusUnavailable") : passwordStatus.data ? t("security.statusSet") : t("security.statusNotSet")}
                </Badge>
                {!editingPassword && !passwordStatus.isLoading && !passwordStatus.isError && (
                  <Button ref={passwordActionRef} type="button" variant="outline" onClick={() => setEditingPassword(true)}>
                    {passwordStatus.data ? t("security.changePassword") : t("security.addPassword")}
                  </Button>
                )}
                {passwordStatus.isError && (
                  <Button type="button" variant="outline" onClick={() => void passwordStatus.refetch()}>{t("security.retry")}</Button>
                )}
              </div>
            </GroupRow>
            {passwordStatus.isError && (
              <p className="px-4 pb-3 text-sm text-destructive">{t("security.statusError")}</p>
            )}
            {editingPassword && (
              <div className="px-4 pb-4">
                <PasswordSetupForm mode={passwordStatus.data ? "change" : "setup"} onSuccess={completePasswordForm} onCancel={closePasswordForm} />
              </div>
            )}
          </div>

          {/* What reaches you */}
          <div className="rounded-[var(--radius-l)] border border-border bg-card overflow-hidden shadow-elev1">
            <GroupHeader
              right={
                <div className="flex flex-1 items-center justify-end gap-4">
                  {/* eslint-disable-next-line no-restricted-syntax -- inline column-header span, not a block-level Eyebrow */}
                  <span className="w-[52px] text-center text-eyebrow font-medium uppercase tracking-wide text-muted-foreground">{t("notifications.columnEmail")}</span>
                  {/* eslint-disable-next-line no-restricted-syntax -- inline column-header span, not a block-level Eyebrow */}
                  <span className="w-[52px] text-center text-eyebrow font-medium uppercase tracking-wide text-muted-foreground">{t("notifications.columnInApp")}</span>
                </div>
              }
            >
              {t("notifications.title")}
            </GroupHeader>
            {categories.map((c) => (
              <GroupRow key={c.key}>
                <div className="min-w-0 flex-1">
                  <p className="text-control font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                {NOTIFICATION_CHANNELS.map((chan) => (
                  <div key={chan} className="w-[52px] flex justify-center">
                    <Switch
                      aria-label={t("notifications.channelAria", { category: c.label, channel: chan === "in_app" ? t("notifications.channelInApp") : t("notifications.channelEmail") })}
                      checked={isOn(c.key, chan)}
                      onCheckedChange={(v) => toggle(c.key, chan, v)}
                    />
                  </div>
                ))}
              </GroupRow>
            ))}
            <p className="px-4 py-[11px] bg-well-tint text-xs text-muted-foreground">{t("audience.footer")}</p>
          </div>

          {/* Your data */}
          <div className="rounded-[var(--radius-l)] border border-border bg-card overflow-hidden shadow-elev1">
            <GroupHeader>{t("data.title")}</GroupHeader>
            <GroupRow>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("data.downloadTitle")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 text-pretty">{t("data.description")}</p>
              </div>
              <Button variant="outline" onClick={downloadMyData} disabled={exporting}>
                {exporting ? t("data.preparing") : t("data.download")}
              </Button>
            </GroupRow>
            <GroupRow>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">{t("data.deleteRow.title")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 text-pretty">
                  {t("data.deleteRow.description")}
                  {hireOrdersEnabled ? ` ${t("delete.hireOrdersNote")}` : ""}
                </p>
              </div>
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
            </GroupRow>
          </div>
        </div>

        {isArtistOnly && (
          <div className="w-[300px] shrink-0 space-y-3">
            <div className="rounded-[var(--radius-l)] border border-border bg-card p-3.5">
              {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking-[1.2px], not the Eyebrow's tracking-[1.6px] */}
              <p className="text-eyebrow font-semibold uppercase tracking-[1.2px] text-muted-foreground">{t("reference.title")}</p>
              <div className="mt-2.5 flex flex-col gap-2.5">
                <Link to={ROUTES.AVAILABILITY} className="flex items-start gap-2 group">
                  <Route className="mt-0.5 h-3.5 w-3.5 text-accent-text shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-control font-medium text-foreground group-hover:underline">{t("reference.bookingRules")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("reference.bookingRulesHint")}</p>
                  </div>
                </Link>
                <Link to={ROUTES.AVAILABILITY} className="flex items-start gap-2 group">
                  <Clock className="mt-0.5 h-3.5 w-3.5 text-accent-text shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-control font-medium text-foreground group-hover:underline">{t("reference.blockedDates")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {blockedCount > 0 ? t("reference.blockedDatesHint", { count: blockedCount }) : t("reference.blockedDatesHintZero")}
                    </p>
                  </div>
                </Link>
                <Link to={ROUTES.CHATS} className="flex items-start gap-2 group">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 text-accent-text shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-control font-medium text-foreground group-hover:underline">{t("reference.office")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("reference.officeHint")}</p>
                  </div>
                </Link>
              </div>
            </div>

            <div className="rounded-[var(--radius-l)] border border-border bg-card p-3.5">
              {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking-[1.2px], not the Eyebrow's tracking-[1.6px] */}
              <p className="text-eyebrow font-semibold uppercase tracking-[1.2px] text-muted-foreground">{t("language.title")}</p>
              {languagePacksEnabled && (
                <div className="mt-2">
                  <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
                    <SelectTrigger aria-label={t("language.title")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_LANGUAGES.map((code) => (
                        <SelectItem key={code} value={code}>{LANGUAGE_LABELS[code]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground text-pretty">{t("language.hint")}</p>
            </div>

            <div className="rounded-[var(--radius-l)] border border-border bg-well-tint p-3.5 text-xs text-muted-foreground text-pretty">
              {t("sidebarNote")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
