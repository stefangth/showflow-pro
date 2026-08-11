import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useMyProfile";
import { useFeature } from "@/hooks/useEntitlements";
import { updateMyPassword } from "@/data/profiles";
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

const passwordSchema = z
  .object({
    current: z.string().min(1, "Required"),
    next: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
type PasswordValues = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateMyProfile();
  const navigate = useNavigate();
  const hireOrdersEnabled = useFeature("hire_orders");

  const identity = useForm<IdentityValues>({ resolver: zodResolver(identitySchema), values: { display_name: profile?.display_name ?? "", phone: profile?.phone ?? "" } });

  const password = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current: "", next: "", confirm: "" } });

  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) => updateMyPassword(supabase, { email: user?.email ?? "", currentPassword: v.current, newPassword: v.next }),
    onSuccess: () => { toast.success("Password changed"); password.reset(); },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => { document.title = "Profile · ShowFlow"; }, []);

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
      toast.success("Your data has been downloaded");
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
      toast.success("Your account has been deleted");
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
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1">Your account details and password</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Details</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <form
              onSubmit={identity.handleSubmit((v) =>
                updateProfile.mutate(
                  { display_name: v.display_name || null, phone: v.phone || null },
                  { onSuccess: () => toast.success("Profile saved"), onError: (e) => toast.error((e as Error).message) },
                ),
              )}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={user?.email ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Display name</Label>
                <Input id="display_name" {...identity.register("display_name")} />
                {identity.formState.errors.display_name && <p className="text-xs text-destructive">{identity.formState.errors.display_name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...identity.register("phone")} />
                {identity.formState.errors.phone && <p className="text-xs text-destructive">{identity.formState.errors.phone.message}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                Admins and producers in your organization can see the contact details on your artist record so they can reach you about bookings.
              </p>
              <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? "Saving…" : "Save"}</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">Change password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={password.handleSubmit((v) => changePassword.mutate(v))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input id="current" type="password" {...password.register("current")} />
              {password.formState.errors.current && <p className="text-xs text-destructive">{password.formState.errors.current.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next">New password</Label>
              <Input id="next" type="password" {...password.register("next")} />
              {password.formState.errors.next && <p className="text-xs text-destructive">{password.formState.errors.next.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type="password" {...password.register("confirm")} />
              {password.formState.errors.confirm && <p className="text-xs text-destructive">{password.formState.errors.confirm.message}</p>}
            </div>
            <Button type="submit" disabled={changePassword.isPending}>{changePassword.isPending ? "Changing…" : "Change password"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how you hear about each kind of update. Critical account emails are always sent.
          </p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-3 items-center">
            <div />
            <span className="text-xs uppercase text-muted-foreground text-center">Email</span>
            <span className="text-xs uppercase text-muted-foreground text-center">In-app</span>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <Fragment key={c.key}>
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                {NOTIFICATION_CHANNELS.map((chan) => (
                  <div key={chan} className="flex justify-center">
                    <Switch
                      aria-label={`${c.label} ${chan === "in_app" ? "in-app" : "email"}`}
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
        <CardHeader><CardTitle className="font-display">Your data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a copy of your personal data (profile, talent records, bookings, availability,
            messages, and notifications) as a JSON file.
          </p>
          <Button variant="outline" onClick={downloadMyData} disabled={exporting}>
            {exporting ? "Preparing…" : "Download my data"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="font-display text-destructive">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account. Your account and profile details are removed. Your shared booking history, including any open offers, is kept but de-identified. This cannot be undone.
            {hireOrdersEnabled ? " Signed hire orders you already agreed to are kept for the organization's records." : ""}
          </p>
          <AlertDialog onOpenChange={(o) => { if (!o) { setConfirmText(""); setDeleting(false); } }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes your account and personal data. Type <strong>DELETE</strong> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input placeholder="DELETE" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText !== "DELETE" || deleting}
                  onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
