import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CastDialog } from './CastDialog';
import { CastMembersSheet } from './CastMembersSheet';
import { Users } from 'lucide-react';
import type { Cast } from '@/types';

export function CastsSection() {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin') || hasRole('producer');
  const [activeCast, setActiveCast] = useState<Cast | null>(null);

  const { data: casts } = useQuery({
    queryKey: ['casts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('casts').select('*').order('name');
      if (error) throw error;
      return data as Cast[];
    },
  });

  const { data: counts } = useQuery({
    queryKey: ['cast-members-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cast_members').select('cast_id');
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach(r => { map[r.cast_id] = (map[r.cast_id] ?? 0) + 1; });
      return map;
    },
  });

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Users className="h-5 w-5" /> Casts
        </CardTitle>
        <CastDialog />
      </CardHeader>
      <CardContent>
        {(casts?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No casts yet. Create one to group artists for show eligibility.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {casts!.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCast(c)}
                className="text-left p-3 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {counts?.[c.id] ?? 0} member{(counts?.[c.id] ?? 0) === 1 ? '' : 's'}
                </p>
                {c.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <CastMembersSheet
        cast={activeCast}
        open={!!activeCast}
        onOpenChange={(o) => { if (!o) setActiveCast(null); }}
      />
    </Card>
  );
}
