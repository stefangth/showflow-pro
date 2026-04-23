import { useMemo, useState, type ReactNode } from 'react';
import { format, isSameDay, startOfMonth } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CalendarDays, ListOrdered } from 'lucide-react';

interface Props<T> {
  items: T[];
  getDate: (item: T) => Date | null;
  renderItem: (item: T) => ReactNode;
  emptyMessage?: string;
}

export function EntityCalendar<T>({ items, getDate, renderItem, emptyMessage = 'No items' }: Props<T>) {
  const [mode, setMode] = useState<'month' | 'agenda'>('month');
  const [selected, setSelected] = useState<Date | undefined>(new Date());
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));

  const itemsByDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const d = getDate(item);
      if (!d) continue;
      const key = format(d, 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items, getDate]);

  const datesWithItems = useMemo(
    () => Array.from(itemsByDay.keys()).map(k => new Date(k + 'T00:00:00')),
    [itemsByDay]
  );

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : '';
  const selectedItems = itemsByDay.get(selectedKey) ?? [];

  const agendaGroups = useMemo(() => {
    const sorted = Array.from(itemsByDay.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted;
  }, [itemsByDay]);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-input bg-background p-0.5">
        {(['month', 'agenda'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm transition-colors',
              mode === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m === 'month' ? <CalendarDays className="h-4 w-4" /> : <ListOrdered className="h-4 w-4" />}
            <span className="capitalize">{m}</span>
          </button>
        ))}
      </div>

      {mode === 'month' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
          <Card>
            <CardContent className="p-2">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={setSelected}
                month={month}
                onMonthChange={setMonth}
                modifiers={{ hasItems: datesWithItems }}
                modifiersClassNames={{ hasItems: 'relative font-semibold text-primary after:content-[""] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-1 after:w-1 after:rounded-full after:bg-primary' }}
                className="p-3 pointer-events-auto"
              />
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="font-display text-lg font-semibold">
                {selected ? format(selected, 'EEE, dd/MM/yyyy') : 'Pick a day'}
              </h3>
              <Badge variant="secondary">{selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}</Badge>
            </div>
            {selectedItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">{emptyMessage} on this date.</p>
            ) : (
              <div className="space-y-2">{selectedItems.map((it, i) => <div key={i}>{renderItem(it)}</div>)}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {agendaGroups.length === 0 && <p className="text-muted-foreground text-center py-12">{emptyMessage}</p>}
          {agendaGroups.map(([dateKey, dayItems]) => (
            <div key={dateKey} className="space-y-2">
              <div className="flex items-baseline gap-3 sticky top-0 bg-background py-1 z-10">
                <h4 className="font-display font-semibold">
                  {format(new Date(dateKey + 'T00:00:00'), 'EEE, dd/MM/yyyy')}
                </h4>
                <Badge variant="outline" className="text-xs">{dayItems.length}</Badge>
              </div>
              <div className="space-y-2 pl-1 border-l-2 border-border ml-2">
                {dayItems.map((it, i) => <div key={i} className="ml-3">{renderItem(it)}</div>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
