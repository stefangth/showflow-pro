import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchPlatformAdmins, addPlatformAdmin, removePlatformAdmin } from "@/data/platform";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function PlatformAdminsTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [toRemove, setToRemove] = useState<{ user_id: string; email: string } | null>(null);
  const { data: admins, isLoading, isError, error } = useQuery({ queryKey: ["platform", "admins"], queryFn: () => fetchPlatformAdmins(supabase) });

  const add = useMutation({
    mutationFn: (e: string) => addPlatformAdmin(supabase, e),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "admins"] }); setEmail(""); toast.success("Platform admin added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (uid: string) => removePlatformAdmin(supabase, uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "admins"] }); toast.success("Platform admin removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Platform admins</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); if (email.trim()) add.mutate(email.trim()); }}>
          <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={add.isPending}>Add</Button>
        </form>
        {isLoading && <Skeleton className="h-10 w-full" />}
        {isError && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        <div className="space-y-2">
          {(admins ?? []).map((a) => (
            <div key={a.user_id} className="flex items-center justify-between p-3 rounded-card border border-border text-sm">
              <span className="truncate">{a.email}</span>
              <Button size="sm" variant="destructive" disabled={a.user_id === user?.id}
                onClick={() => setToRemove({ user_id: a.user_id, email: a.email })}>
                {a.user_id === user?.id ? "You" : "Remove"}
              </Button>
            </div>
          ))}
        </div>
        <AlertDialog open={toRemove !== null} onOpenChange={(o) => !o && setToRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove platform admin?</AlertDialogTitle>
              <AlertDialogDescription>{toRemove?.email} will lose access to the platform console.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (toRemove) remove.mutate(toRemove.user_id); setToRemove(null); }}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
