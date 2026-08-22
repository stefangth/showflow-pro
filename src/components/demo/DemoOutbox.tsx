import { useState } from "react";
import { Mail } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/AuthContext";
import { useCapturedSends } from "@/hooks/useDemo";

/** The demo outbox: a dialog listing every email/PDF the org's send-divert has captured
 *  (newest-first), so a rep can show "the artist just got this" without leaving the demo
 *  and without a real message ever going out. Opened from a trigger button in DemoBar.
 *  The query is scoped to `open` (only firing while the dialog is visible) rather than
 *  running for the lifetime of the org — DemoBar and its children are mounted throughout
 *  a demo session, so an always-on subscription here would poll needlessly. Lists metadata
 *  only (kind/subject/recipient); rendering `preview_html` is deferred to a later task. */
export function DemoOutbox() {
  const { currentOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: sends = [], isLoading } = useCapturedSends(open ? currentOrg?.id ?? null : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Mail className="h-3.5 w-3.5" /> Outbox
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Demo outbox</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : sends.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing sent yet. Emails and PDFs stay inside the demo.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sends.map((s) => (
              <li key={s.id} className="py-2">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line no-restricted-syntax -- badge kind label, not a standard 11px/1.6px eyebrow */}
                  <Badge variant="outline" className="uppercase">
                    {s.kind}
                  </Badge>
                  <span className="text-sm font-medium">{s.subject ?? "(no subject)"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{s.to_label}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
