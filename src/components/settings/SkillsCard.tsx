import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

const ROW_GRID = 'grid grid-cols-[1fr_130px_150px_190px] gap-3';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Settings → Casts & Cities, Skills card. Create / rename / archive / restore /
 * delete-when-unused the org's skill catalog, with per-skill Artists and
 * Required by usage counts. Mounted by CastsCitiesTab (design 1f).
 */
export function SkillsCard({ canEnter }: { canEnter: boolean }) {
  const { hasRole } = useAuth();
  // manage_skills gates every write control (read-only floor: the catalog still
  // renders when it's off). Deleting stays admin-only regardless of the
  // capability, since the skills DELETE RLS policy is admin-only server-side.
  const canManage = useCan('manage_skills');
  const canDelete = hasRole('admin');

  const { data } = useSkillCatalog();
  const rows = data ?? [];

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const createSkill = useCreateSkill();
  const renameSkill = useRenameSkill();
  const archiveSkill = useArchiveSkill();
  const restoreSkill = useRestoreSkill();
  const deleteSkill = useDeleteSkill();

  if (!canEnter) return null;

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await createSkill.mutateAsync(trimmed);
      setNewName('');
      toast.success('Skill added');
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add skill'));
    }
  };

  const startRename = (row: SkillCatalogRow) => {
    setEditingId(row.id);
    setEditingName(row.name);
  };
  const cancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };
  const saveRename = () => {
    const trimmed = editingName.trim();
    if (!trimmed || !editingId) return;
    renameSkill.mutate(
      { id: editingId, name: trimmed },
      {
        onSuccess: () => { toast.success('Skill renamed'); cancelRename(); },
        onError: (e) => toast.error(errorMessage(e, 'Failed to rename skill')),
      },
    );
  };

  const handleArchive = (id: string) => {
    archiveSkill.mutate(id, {
      onSuccess: () => toast.success('Skill archived'),
      onError: (e) => toast.error(errorMessage(e, 'Failed to archive skill')),
    });
  };
  const handleRestore = (id: string) => {
    restoreSkill.mutate(id, {
      onSuccess: () => toast.success('Skill restored'),
      onError: (e) => toast.error(errorMessage(e, 'Failed to restore skill')),
    });
  };
  const handleDelete = (id: string) => {
    deleteSkill.mutate(id, {
      onSuccess: () => toast.success('Skill deleted'),
      onError: (e) => toast.error(errorMessage(e, 'Failed to delete skill')),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Skills</CardTitle>
        <CardDescription>
          Skills gate who can be offered or booked. Productions require them per slot; artists hold them on their profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="New skill name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={!canManage}
          />
          <Button
            type="button"
            disabled={!canManage || !newName.trim() || createSkill.isPending}
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {rows.length > 0 && (
          <div className={cn(ROW_GRID, 'px-2.5')}>
            <p className="text-xs font-medium text-muted-foreground">Skill</p>
            <p className="text-xs font-medium text-muted-foreground">Artists</p>
            <p className="text-xs font-medium text-muted-foreground">Required by</p>
            <p />
          </div>
        )}

        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const isEditing = editingId === row.id;
            const isArchived = row.archivedAt !== null;
            // Trash is offered only on active rows; archived rows show Restore only,
            // per the brief and the design's archived (Puppetry) example.
            const showDeleteTrash = canDelete && !isArchived && row.requiredByCount === 0;
            const showBlockedTrash = canDelete && !isArchived && row.requiredByCount > 0;

            return (
              <div
                key={row.id}
                data-testid={`skill-row-${row.id}`}
                className={cn(
                  ROW_GRID,
                  'items-center rounded-lg border px-2.5 py-2',
                  isEditing
                    ? 'border-primary/40 bg-primary/5'
                    : isArchived
                      ? 'border-border bg-muted/40'
                      : 'border-border bg-background',
                )}
              >
                {isEditing ? (
                  <Input
                    autoFocus
                    className="h-[30px]"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    aria-label={`Rename ${row.name}`}
                  />
                ) : (
                  <div className={cn('flex items-center gap-2 text-sm font-medium', isArchived && 'text-muted-foreground')}>
                    {row.name}
                    {isArchived && <Badge variant="neutral">Archived</Badge>}
                  </div>
                )}

                <p
                  className={cn(
                    'font-mono text-xs tabular-nums',
                    isEditing ? 'text-primary' : isArchived ? 'text-muted-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {row.artistCount} artists
                </p>

                <p
                  className={cn(
                    'text-xs',
                    isEditing ? 'text-primary' : isArchived ? 'text-muted-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {isArchived
                    ? 'Hidden from pickers'
                    : row.requiredByCount > 0
                      ? `${row.requiredByCount} productions`
                      : 'Not required yet'}
                </p>

                <div className="flex justify-end gap-1">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={cancelRename}>Cancel</Button>
                      <Button
                        size="sm"
                        disabled={!editingName.trim() || renameSkill.isPending}
                        onClick={saveRename}
                      >
                        Save name
                      </Button>
                    </>
                  ) : isArchived ? (
                    // Archived rows offer Restore only, never a trash/delete control
                    // (the brief and the design's archived example both specify this).
                    <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => handleRestore(row.id)}>
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => startRename(row)}>
                        Rename
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => handleArchive(row.id)}>
                        Archive
                      </Button>
                      {showBlockedTrash && (
                        <IconTooltip label={`In use by ${row.requiredByCount} productions, archive it instead`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${row.name}`}
                            disabled
                            className="text-muted-foreground/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </IconTooltip>
                      )}
                      {showDeleteTrash && (
                        <IconTooltip label="Not required by any production, safe to delete">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${row.name}`}
                            disabled={!canManage || deleteSkill.isPending}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDelete(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </IconTooltip>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="px-2.5 py-4 text-center text-sm text-muted-foreground">No skills yet.</p>
          )}
        </div>

        <p className="text-xs leading-[18px] text-muted-foreground">
          Archiving hides a skill from every picker and keeps it on the artists who hold it. Deleting is only offered while no production requires it. New workspaces are seeded from the platform starter list.
        </p>
      </CardContent>
    </Card>
  );
}
