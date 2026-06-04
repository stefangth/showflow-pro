import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"request" | "set">(() => {
    const t = typeof window !== "undefined" ? parseRecoveryHash(window.location.hash).type : null;
    return t === "recovery" || t === "invite" ? "set" : "request";
  });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  // A recovery/invite link may resolve the session slightly after mount; flip to set-mode then.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("set");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const form = useForm<SetValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await requestPasswordReset(supabase, email, `${window.location.origin}${ROUTES.RESET_PASSWORD}`);
      toast.success("If that email exists, a reset link is on its way");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onSet = form.handleSubmit(async (v) => {
    try {
      await setNewPassword(supabase, v.password);
      toast.success("Password updated");
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
            {mode === "set" ? "Set a new password" : "Reset your password"}
          </CardTitle>
          <CardDescription>
            {mode === "set" ? "Choose a new password for your account." : `Enter your email and we'll send a reset link for ${APP_META.NAME}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "set" ? (
            <form onSubmit={onSet} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" {...form.register("password")} />
                {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type="password" {...form.register("confirm")} />
                {form.formState.errors.confirm && <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>Set password</Button>
            </form>
          ) : (
            <form onSubmit={onRequest} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <Button type="submit" className="w-full" disabled={sending || !email}>{sending ? "Sending…" : "Send reset link"}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(ROUTES.LOGIN)}>Back to sign in</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
