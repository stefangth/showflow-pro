import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { changeMyPassword, requestPasswordReauthentication, setMyPassword } from "@/data/profiles";
import { MIN_PASSWORD_LENGTH, newPasswordSchema } from "@/features/auth/resetPassword";
import { invalidatePasswordStatus } from "@/hooks/usePasswordStatus";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PasswordValues = z.infer<typeof newPasswordSchema>;

export interface PasswordSetupFormProps {
  mode: "setup" | "change";
  onSuccess: () => void;
  onCancel?: () => void;
}

function PasswordInput({ id, label, value, onChange, required = false, invalid = false, describedBy }: { id: string; label: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; required?: boolean; invalid?: boolean; describedBy?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} value={value} onChange={onChange} className="pr-10" required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
        <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} onClick={() => setVisible((value) => !value)}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function needsReauthentication(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const authError = error as { code?: string; message?: string };
  return authError.code === "reauthentication_needed" || /reauthentication needed/i.test(authError.message ?? "");
}

export function PasswordSetupForm({ mode, onSuccess, onCancel }: PasswordSetupFormProps) {
  const queryClient = useQueryClient();
  const form = useForm<PasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: "", confirm: "" } });
  const [currentPassword, setCurrentPassword] = useState("");
  const [nonce, setNonce] = useState("");
  const [awaitingNonce, setAwaitingNonce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const password = form.watch("password");
  const passwordError = form.formState.errors.password;
  const confirmError = form.formState.errors.confirm;
  const strength = password.length === 0
    ? "Not entered"
    : password.length < MIN_PASSWORD_LENGTH
      ? `Needs ${MIN_PASSWORD_LENGTH} characters`
      : "Meets requirement";

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      if (awaitingNonce) {
        await changeMyPassword(supabase, { password, nonce });
      } else if (mode === "setup") {
        await setMyPassword(supabase, password);
      } else {
        await changeMyPassword(supabase, { password, currentPassword });
      }
      await invalidatePasswordStatus(queryClient);
      toast.success(mode === "setup" ? "Password added" : "Password changed");
      onSuccess();
    } catch (caught) {
      if (!awaitingNonce && needsReauthentication(caught)) {
        try {
          await requestPasswordReauthentication(supabase);
          setAwaitingNonce(true);
          return;
        } catch (reauthError) {
          const message = reauthError instanceof Error ? reauthError.message : "Could not request a reauthentication code";
          setError(message);
          toast.error(message);
          return;
        }
      }
      const message = caught instanceof Error ? caught.message : "Could not update password";
      setError(message);
      toast.error(message);
    }
  });

  const title = mode === "setup" ? "Set a password" : "Change password";
  const submitLabel = mode === "setup" ? "Set password" : "Change password";
  const pendingLabel = mode === "setup" ? "Setting password…" : "Changing password…";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{mode === "setup" ? "Add password sign-in to your account." : "Choose a new password for your account."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {(passwordError || confirmError) && (
            <p role="alert" aria-live="assertive" className="text-sm font-medium text-destructive">
              Please fix the password fields below.
            </p>
          )}
          {mode === "change" && !awaitingNonce && <PasswordInput id="current-password" label="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />}
          {awaitingNonce && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Check your email for the 6-digit code</p>
              <Label htmlFor="password-nonce">6-digit code</Label>
              <Input id="password-nonce" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={nonce} onChange={(event) => setNonce(event.target.value.replace(/\D/g, ""))} required />
            </div>
          )}
          <PasswordInput id="new-password" label="New password" value={password} onChange={(event) => form.setValue("password", event.target.value, { shouldValidate: form.formState.isSubmitted })} invalid={!!passwordError} describedBy={`password-requirements password-strength${passwordError ? " new-password-error" : ""}`} />
          {passwordError && <p id="new-password-error" className="text-xs text-destructive">{passwordError.message}</p>}
          <div id="password-requirements" aria-live="polite" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Password requirements</p>
            <p>Use at least {MIN_PASSWORD_LENGTH} characters.</p>
            <p id="password-strength"><span className="font-medium text-foreground">Password strength:</span> <span>{strength}</span></p>
          </div>
          <PasswordInput id="confirm-password" label="Confirm new password" value={form.watch("confirm")} onChange={(event) => form.setValue("confirm", event.target.value, { shouldValidate: form.formState.isSubmitted })} invalid={!!confirmError} describedBy={`password-requirements${confirmError ? " confirm-password-error" : ""}`} />
          {confirmError && <p id="confirm-password-error" className="text-xs text-destructive">{confirmError.message}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={form.formState.isSubmitting || (awaitingNonce && nonce.length !== 6)}>{form.formState.isSubmitting ? pendingLabel : submitLabel}</Button>
            {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
