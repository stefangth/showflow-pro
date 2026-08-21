import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestPasswordReset, setNewPassword } from "@/data/profiles";
import { parseRecoveryHash, safeRelativeRedirect, newPasswordSchema } from "@/features/auth/resetPassword";
import { ROUTES, APP_META } from "@/config/app.config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StageMark } from "@/components/brand/StageMark";
import { z } from "zod";

type SetValues = z.infer<typeof newPasswordSchema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"request" | "set">(() => {
    const t = typeof window !== "undefined" ? parseRecoveryHash(window.location.hash).type : null;
    return t === "recovery" || t === "invite" ? "set" : "request";
  });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  // True once the recovery/invite session is established — gates the set-password submit
  // so it cannot run before updateUser has a session to act on.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The link may resolve the session slightly after mount; reflect both the
    // PASSWORD_RECOVERY (reset) and SIGNED_IN (invite) arrivals, plus any existing session.
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setMode("set");
        setReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const form = useForm<SetValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      // Defense-in-depth: if the user reached this page via /reset-password?redirect=…
      // (e.g. an expired invite link), carry that redirect into the recovery link so they
      // land back on /accept-invite after setting a password.
      const redirect = searchParams.get("redirect");
      const redirectTo = `${window.location.origin}${ROUTES.RESET_PASSWORD}${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`;
      await requestPasswordReset(supabase, email, redirectTo);
      toast.success(t("resetPassword.emailSentToast"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onSet = form.handleSubmit(async (v) => {
    try {
      await setNewPassword(supabase, v.password);
      toast.success(t("resetPassword.passwordUpdatedToast"));
      navigate(safeRelativeRedirect(searchParams.get("redirect"), ROUTES.DASHBOARD), { replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
          <CardTitle className="font-display text-2xl font-semibold tracking-tight">
            {mode === "set" ? t("resetPassword.setTitle") : t("resetPassword.requestTitle")}
          </CardTitle>
          <CardDescription>
            {mode === "set" ? t("resetPassword.setDescription") : t("resetPassword.requestDescription", { appName: APP_META.NAME })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "set" ? (
            <form onSubmit={onSet} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("resetPassword.newPasswordLabel")}</Label>
                <Input id="password" type="password" {...form.register("password")} />
                {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">{t("resetPassword.confirmLabel")}</Label>
                <Input id="confirm" type="password" {...form.register("confirm")} />
                {form.formState.errors.confirm && <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={!ready || form.formState.isSubmitting}>{t("resetPassword.setButton")}</Button>
            </form>
          ) : (
            <form onSubmit={onRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("resetPassword.emailLabel")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("resetPassword.emailPlaceholder")} required />
              </div>
              <Button type="submit" className="w-full" disabled={sending || !email}>{sending ? t("resetPassword.sending") : t("resetPassword.sendButton")}</Button>
              <Button type="button" variant="secondary" className="w-full" onClick={() => navigate(ROUTES.LOGIN)}>{t("resetPassword.backToSignIn")}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
