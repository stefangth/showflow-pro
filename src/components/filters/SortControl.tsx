import { ArrowDownAZ, ArrowUpAZ, ArrowDown01, ArrowUp01 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SortValue = 'alpha_asc' | 'alpha_desc' | 'chrono_asc' | 'chrono_desc';

interface Props<T extends string = SortValue> {
  value: T;
  onChange: (v: T) => void;
  chronoLabel?: string;
  /** Extra sort options appended below the built-ins (e.g. custom sortable fields). */
  extraOptions?: { value: T; label: string }[];
}

export function SortControl<T extends string = SortValue>({ value, onChange, chronoLabel = 'Date', extraOptions = [] }: Props<T>) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={'alpha_asc' as T}><span className="flex items-center gap-2"><ArrowDownAZ className="h-4 w-4" />Name A → Z</span></SelectItem>
        <SelectItem value={'alpha_desc' as T}><span className="flex items-center gap-2"><ArrowUpAZ className="h-4 w-4" />Name Z → A</span></SelectItem>
        <SelectItem value={'chrono_asc' as T}><span className="flex items-center gap-2"><ArrowDown01 className="h-4 w-4" />{chronoLabel} ↑</span></SelectItem>
        <SelectItem value={'chrono_desc' as T}><span className="flex items-center gap-2"><ArrowUp01 className="h-4 w-4" />{chronoLabel} ↓</span></SelectItem>
        {extraOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
