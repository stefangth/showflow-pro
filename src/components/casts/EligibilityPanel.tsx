import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Cast, City } from '@/types';

interface Props {
  showId: string;
}

export function EligibilityPanel({ showId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });

  const { data: casts } = useQuery({
    queryKey: ['casts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('casts').select('*').order('name');
      if (error) throw error;
      return data as Cast[];
    },
  });

  const { data: eligibility } = useQuery({
    queryKey: ['show-cast-eligibility', showId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_cast_eligibility')
        .select('id, city_id, cast_id')
        .eq('show_id', showId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const byCity = useMemo(() => {
    const map = new Map<string, { castIds: Set<string>; rowIds: Map<string, string> }>();
    eligibility?.forEach(e => {
      const entry = map.get(e.city_id) ?? { castIds: new Set(), rowIds: new Map() };
      entry.castIds.add(e.cast_id);
      entry.rowIds.set(e.cast_id, e.id);
      map.set(e.city_id, entry);
    });
    return map;
  }, [eligibility]);

  const toggleCast = useMutation({
    mutationFn: async ({ cityId, castId, on }: { cityId: string; castId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('show_cast_eligibility')
          .insert({ show_id: showId, city_id: cityId, cast_id: castId });
        if (error) throw error;
      } else {
        const rowId = byCity.get(cityId)?.rowIds.get(castId);
        if (!rowId) return;
        const { error } = await supabase.from('show_cast_eligibility').delete().eq('id', rowId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['show-cast-eligibility', showId] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg flex items-center gap-2">
          <Layers className="h-5 w-5" /> Cast Eligibility
        </CardTitle>
        <CardDescription>
          Pick eligible casts per city. New dates synced from Airtable inherit this — override per date below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(cities ?? []).map(city => {
          const entry = byCity.get(city.id);
          const selectedCount = entry?.castIds.size ?? 0;
          return (
            <div key={city.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">{city.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedCount === 0 ? 'No casts assigned' : `${selectedCount} cast${selectedCount === 1 ? '' : 's'} eligible`}
                </p>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="min-w-[200px] justify-between">
                    <span className="truncate">
                      {selectedCount === 0
                        ? 'Select casts…'
                        : Array.from(entry!.castIds).map(id => casts?.find(c => c.id === id)?.name).filter(Boolean).join(', ')}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-1" align="end">
                  <div className="max-h-64 overflow-y-auto">
                    {(casts ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground p-2">No casts created yet.</p>
                    )}
                    {(casts ?? []).map(cast => {
                      const on = entry?.castIds.has(cast.id) ?? false;
                      return (
                        <button
                          key={cast.id}
                          onClick={() => toggleCast.mutate({ cityId: city.id, castId: cast.id, on: !on })}
                          className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left"
                        >
                          <Check className={cn('h-4 w-4 mr-2', on ? 'opacity-100' : 'opacity-0')} />
                          {cast.name}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
        {(cities ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Add cities first in Settings → Casts & Cities.</p>
        )}
        {(eligibility?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            <span className="text-xs text-muted-foreground">Active:</span>
            {Array.from(byCity.entries()).map(([cityId, entry]) => (
              <Badge key={cityId} variant="secondary" className="text-xs">
                {cities?.find(c => c.id === cityId)?.name}: {entry.castIds.size}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
