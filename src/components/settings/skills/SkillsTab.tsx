import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconTooltip } from '@/components/common/IconTooltip';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import {
  useSkillCatalog,
  useCreateSkill,
  useRenameSkill,
  useArchiveSkill,
  useRestoreSkill,
  useDeleteSkill,
  type SkillCatalogRow,
} from '@/hooks/useSkills';
import { cn } from '@/lib/utils';
import { toErrorMessage } from '@/lib/errors';

/** Human "Required by" copy for the catalog table. Archived always wins (a skill
 *  hidden from every picker is not meaningfully "required" any more, even if a
 *  past production still references it); otherwise prefer the show-level count
 *  over the date-level one, since a production requirement is the more durable
 *  fact. Mirrors the retiring SkillsCard's copy exactly, so this is a re-skin,
 *  not a behavior change. */
function requiredByLabel(row: SkillCatalogRow): string {
  if (row.archivedAt !== null) return 'Hidden from pickers';
  if (row.requiredByCount > 0) {
    return `${row.requiredByCount} production${row.requiredByCount === 1 ? '' : 's'}`;
  }
  if (row.requiredByDateCount > 0) {
    return `${row.requiredByDateCount} upcoming date${row.requiredByDateCount === 1 ? '' : 's'}`;
  }
  return 'Not required yet';
}

/**
 * Settings → Skills (standalone tab, P2-4 redesign). Promotes the skills catalog
 * that used to live embedded in Settings → Casts & Cities (SkillsCard) into its
 * own page: eyebrow + title header, a search + "New skill" toolbar, and a table
 * of every skill with its usage counts. Behavior is unchanged from SkillsCard
 * (same hooks, same gating, same delete-when-unused rule) — only the shell and
 * the create/rename interactions (now dialogs instead of an inline row) differ.
 *
 * `orgId` is accepted for the standalone-tab contract (mirrors CastsCoverageTab /
 * RolesRightsTab) even though the underlying useSkills hooks read `currentOrg`
 * from AuthContext directly; it also lets the tab render nothing before an org
 * is resolved, matching every other org-scoped Settings tab.
 */
export function SkillsTab({ orgId }: { orgId: string }) {
  const { hasRole } = useAuth();
  // manage_skills gates every write control (read-only floor: the catalog still
  // renders when it's off). Deleting stays admin-only regardless of the
  // capability, since the skills DELETE RLS policy is admin-only server-side.
  const canManage = useCan('manage_skills');
  const canDelete = hasRole('admin');

  const { data } = useSkillCatalog();
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameRow, setRenameRow] = useState<SkillCatalogRow | null>(null);
  const [renameName, setRenameName] = useState('');

  const createSkill = useCreateSkill();
  const renameSkill = useRenameSkill();
  const archiveSkill = useArchiveSkill();
  const restoreSkill = useRestoreSkill();
  const deleteSkill = useDeleteSkill();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  if (!orgId) return null;

  // Case-insensitive name-collision guard shared by New skill and Rename. Checks the
  // loaded catalog (which includes archived rows) before hitting the DB: the
  // org_id+name unique index would otherwise surface as a raw constraint-violation
  // error, and for an archived match there is a better answer than "failed": restore
  // it instead. Renaming passes its own id as excludeId so re-saving a skill's own
  // name is not treated as a collision. Returns true when it surfaced a toast and the
  // caller should stop.
  const blockOnNameCollision = (name: string, excludeId?: string): boolean => {
    const existing = rows.find(
      (r) => r.id !== excludeId && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!existing) return false;
    toast.error(
      existing.archivedAt !== null
        ? `A skill named "${name}" is archived. Use Restore to bring it back.`
        : `A skill named "${name}" already exists.`,
    );
    return true;
  };

  const closeNewDialog = () => {
    setNewOpen(false);
    setNewName('');
  };
  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (blockOnNameCollision(trimmed)) return;
    try {
      await createSkill.mutateAsync(trimmed);
      toast.success('Skill added');
      closeNewDialog();
    } catch (e) {
      toast.error(toErrorMessage(e, 'Failed to add skill'));
    }
  };

  const openRename = (row: SkillCatalogRow) => {
    setRenameRow(row);
    setRenameName(row.name);
  };
  const closeRename = () => {
    setRenameRow(null);
    setRenameName('');
  };
  const handleSaveRename = () => {
    const trimmed = renameName.trim();
    if (!trimmed || !renameRow) return;
    if (blockOnNameCollision(trimmed, renameRow.id)) return;
    renameSkill.mutate(
      { id: renameRow.id, name: trimmed },
      {
        onSuccess: () => { toast.success('Skill renamed'); closeRename(); },
        onError: (e) => toast.error(toErrorMessage(e, 'Failed to rename skill')),
      },
    );
  };

  const handleArchive = (id: string) => {
    archiveSkill.mutate(id, {
      onSuccess: () => toast.success('Skill archived'),
      onError: (e) => toast.error(toErrorMessage(e, 'Failed to archive skill')),
    });
  };
  const handleRestore = (id: string) => {
    restoreSkill.mutate(id, {
      onSuccess: () => toast.success('Skill restored'),
      onError: (e) => toast.error(toErrorMessage(e, 'Failed to restore skill')),
    });
  };
  const handleDelete = (id: string) => {
    deleteSkill.mutate(id, {
      onSuccess: () => toast.success('Skill deleted'),
      onError: (e) => toast.error(toErrorMessage(e, 'Failed to delete skill')),
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          ORGANIZATION · CATALOG
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Skills gate who can be offered or booked. Productions require them per slot; artists hold them on their profile.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              placeholder="Find a skill"
              aria-label="Find a skill"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Button type="button" disabled={!canManage} onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New skill
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider">Skill</TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider">Artists</TableHead>
                  <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wider">Required by</TableHead>
                  <TableHead className="h-9 text-right text-[11px] font-semibold uppercase tracking-wider"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const isArchived = row.archivedAt !== null;
                  // Both the show-level and date-level required-skill FKs are ON
                  // DELETE RESTRICT, so a delete is only truly safe when both counts
                  // are zero.
                  const isUnused = row.requiredByCount === 0 && row.requiredByDateCount === 0;
                  const blockedTooltip = row.requiredByCount > 0
                    ? `In use by ${row.requiredByCount} productions, archive it instead`
                    : 'Required by upcoming dates, archive it instead';

                  return (
                    <TableRow key={row.id} data-testid={`skill-row-${row.id}`}>
                      <TableCell className="py-2.5">
                        <span className={cn('font-medium', isArchived && 'text-muted-foreground')}>
                          {row.name}
                        </span>
                        {isArchived && <Badge variant="neutral" className="ml-2">Archived</Badge>}
                      </TableCell>
                      <TableCell className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                        {row.artistCount}
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">
                        {requiredByLabel(row)}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        {isArchived ? (
                          // Archived rows offer Restore only, never Rename/Archive/delete
                          // (parity with SkillsCard's design intent).
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => handleRestore(row.id)}
                            className="text-xs font-semibold text-accent-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                          >
                            Restore
                          </button>
                        ) : (
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => openRename(row)}
                              className="text-xs font-semibold text-accent-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={!canManage}
                              onClick={() => handleArchive(row.id)}
                              className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Archive
                            </button>
                            {canDelete && (
                              isUnused ? (
                                <IconTooltip label="Not required by any production, safe to delete">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${row.name}`}
                                    disabled={!canManage || deleteSkill.isPending}
                                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => handleDelete(row.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </IconTooltip>
                              ) : (
                                <IconTooltip label={blockedTooltip}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${row.name}`}
                                    disabled
                                    className="h-7 w-7 text-muted-foreground/50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </IconTooltip>
                              )
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      {rows.length === 0 ? 'No skills yet.' : 'No skills match your search.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs leading-[18px] text-muted-foreground">
            Archiving hides a skill from every picker and keeps it on the artists who hold it. Deleting is only offered while no production requires it. New workspaces are seeded from the platform starter list.
          </p>
        </CardContent>
      </Card>

      <Dialog open={newOpen} onOpenChange={(open) => (open ? setNewOpen(true) : closeNewDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>
              Skills are shared across the organization&apos;s productions and artist profiles.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Skill name"
            aria-label="Skill name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeNewDialog}>Cancel</Button>
            <Button
              type="button"
              disabled={!newName.trim() || createSkill.isPending}
              onClick={() => void handleCreate()}
            >
              Create skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameRow !== null} onOpenChange={(open) => { if (!open) closeRename(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renameRow?.name}</DialogTitle>
            <DialogDescription>This name is shown everywhere the skill appears.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Skill name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(); }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeRename}>Cancel</Button>
            <Button
              type="button"
              disabled={!renameName.trim() || renameSkill.isPending}
              onClick={handleSaveRename}
            >
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
