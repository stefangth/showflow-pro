import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile, useUpdateMyProfile } from "@/hooks/useMyProfile";
import { updateMyPassword } from "@/data/profiles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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

  const identity = useForm<IdentityValues>({ resolver: zodResolver(identitySchema), values: { display_name: profile?.display_name ?? "", phone: profile?.phone ?? "" } });

  const password = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { current: "", next: "", confirm: "" } });

  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) => updateMyPassword(supabase, { email: user?.email ?? "", currentPassword: v.current, newPassword: v.next }),
    onSuccess: () => { toast.success("Password changed"); password.reset(); },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => { document.title = "Profile · Showflow Pro"; }, []);

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
                <Input id="email" value={profile?.email ?? user?.email ?? ""} disabled />
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
    </div>
  );
}
