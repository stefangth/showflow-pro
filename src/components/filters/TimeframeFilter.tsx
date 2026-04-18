import { useState } from 'react';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import { addDays, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

export type TimeframeValue = { from: Date | null; to: Date | null; preset?: string };

interface Props {
  value: TimeframeValue;
  onChange: (v: TimeframeValue) => void;
  className?: string;
}

const presets = (): { label: string; key: string; range: () => { from: Date; to: Date } }[] => {
  const today = startOfDay(new Date());
  return [
    { label: 'Today', key: 'today', range: () => ({ from: today, to: today }) },
    { label: 'This week', key: 'week', range: () => ({ from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) }) },
    { label: 'This month', key: 'month', range: () => ({ from: startOfMonth(today), to: endOfMonth(today) }) },
    { label: 'Next 30 days', key: '30d', range: () => ({ from: today, to: addDays(today, 30) }) },
    { label: 'Next 90 days', key: '90d', range: () => ({ from: today, to: addDays(today, 90) }) },
    { label: 'Past', key: 'past', range: () => ({ from: addDays(today, -3650), to: addDays(today, -1) }) },
  ];
};

export function TimeframeFilter({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const list = presets();

  const label = value.preset
    ? list.find(p => p.key === value.preset)?.label
    : value.from && value.to
      ? `${format(value.from, 'MMM d')} – ${format(value.to, 'MMM d')}`
      : 'Any time';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-between min-w-[180px]', className)}>
          <span className="flex items-center gap-2 truncate">
            <CalendarIcon className="h-4 w-4 opacity-60" />
            {label}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 flex" align="start">
        <div className="flex flex-col p-2 border-r min-w-[140px]">
          {list.map(p => (
            <button
              key={p.key}
              onClick={() => { const r = p.range(); onChange({ from: r.from, to: r.to, preset: p.key }); setOpen(false); }}
              className={cn('text-sm text-left px-2 py-1.5 rounded-sm hover:bg-accent', value.preset === p.key && 'bg-accent font-medium')}
            >
              {p.label}
            </button>
          ))}
          <Separator className="my-1" />
          <button
            onClick={() => { onChange({ from: null, to: null }); setOpen(false); }}
            className="text-sm text-left px-2 py-1.5 rounded-sm hover:bg-accent text-muted-foreground"
          >
            Any time
          </button>
        </div>
        <Calendar
          mode="range"
          selected={{ from: value.from ?? undefined, to: value.to ?? undefined }}
          onSelect={(range) => onChange({ from: range?.from ?? null, to: range?.to ?? null, preset: undefined })}
          numberOfMonths={1}
          className={cn('p-3 pointer-events-auto')}
        />
      </PopoverContent>
    </Popover>
  );
}
