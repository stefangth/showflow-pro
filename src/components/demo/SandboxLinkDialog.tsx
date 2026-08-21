import { useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/AuthContext";
import { useCreateSandboxLink, useRevokeSandboxLink, useSandboxLinks } from "@/hooks/useDemo";
import { formatTimestampDMY } from "@/lib/dates";
import type { SandboxLink } from "@/data/demo";

function sandboxUrl(token: string): string {
  return `${window.location.origin}/sandbox/${token}`;
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  } catch {
    // Insecure context or denied clipboard permission: surface it instead of
    // failing silently, so the operator knows the copy did not happen.
    toast.error("Could not copy the link");
  }
}

/** Status of a sandbox link at the current moment: active links can still be
 *  revoked; revoked/expired links are shown as a muted badge instead. */
function linkStatus(link: SandboxLink): "active" | "revoked" | "expired" {
  if (link.revoked_at) return "revoked";
  if (new Date(link.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

/** One row in the sandbox-links list: the URL (or its token), expiry date, and
 *  either Copy + Revoke (active) or a muted status badge (revoked/expired). */
function LinkRow({ link, onRevoke }: { link: SandboxLink; onRevoke: (token: string) => void }) {
  const status = linkStatus(link);
  const url = sandboxUrl(link.token);

  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{url}</p>
        <p className="text-xs text-muted-foreground">Expires {formatTimestampDMY(link.expires_at)}</p>
      </div>
      {status === "active" ? (
        <>
          <Button size="icon" variant="ghost" className="h-7 w-7 px-2" onClick={() => copyLink(url)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onRevoke(link.token)}>
            Revoke
          </Button>
        </>
      ) : (
        <Badge variant="secondary" className="text-muted-foreground">
          {status === "revoked" ? "Revoked" : "Expired"}
        </Badge>
      )}
    </li>
  );
}

/** The sandbox-link dialog: opened from a trigger button in DemoBar, lets an
 *  operator mint a public, read-only, expiring link to hand a prospect (they
 *  view a curated snapshot via the `sandbox-view` edge function, no login), and
 *  manage existing links (copy, revoke). The list query only runs while the
 *  dialog is open, same pattern as DemoOutbox. */
export function SandboxLinkDialog() {
  const { currentOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const orgId = currentOrg?.id;

  const { data: links = [], isLoading } = useSandboxLinks(open ? orgId : undefined);
  const createLink = useCreateSandboxLink();
  const revokeLink = useRevokeSandboxLink();

  const [newUrl, setNewUrl] = useState<string | null>(null);

  const handleCreate = () => {
    if (!orgId) return;
    createLink.mutate(orgId, {
      onSuccess: (data: { token: string; expires_at: string }) => {
        setNewUrl(sandboxUrl(data.token));
      },
      onError: () => toast.error("Could not create a sandbox link"),
    });
  };

  const handleRevoke = (token: string) => {
    if (!orgId) return;
    revokeLink.mutate({ orgId, token }, {
      onError: () => toast.error("Could not revoke the link"),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNewUrl(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> Sandbox link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share a read-only sandbox</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A read-only view your prospect can open for 14 days. No login. It resets when you reset.
        </p>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleCreate} disabled={createLink.isPending || !orgId}>
            {createLink.isPending ? "Creating" : "Create link"}
          </Button>
        </div>

        {newUrl && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-primary/5 px-2 py-1.5">
            <p className="min-w-0 flex-1 truncate font-mono text-xs">{newUrl}</p>
            <Button size="sm" variant="secondary" className="h-7 px-2" onClick={() => copyLink(newUrl)}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sandbox links yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {links.map((link) => (
              <LinkRow key={link.id} link={link} onRevoke={handleRevoke} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
