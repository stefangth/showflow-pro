import { ArrowDownAZ, ArrowUpAZ, ArrowDown01, ArrowUp01 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SortValue = 'alpha_asc' | 'alpha_desc' | 'chrono_asc' | 'chrono_desc';

interface Props {
  value: SortValue;
  onChange: (v: SortValue) => void;
  chronoLabel?: string;
}

export function SortControl({ value, onChange, chronoLabel = 'Date' }: Props) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortValue)}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="alpha_asc"><span className="flex items-center gap-2"><ArrowDownAZ className="h-4 w-4" />Name A → Z</span></SelectItem>
        <SelectItem value="alpha_desc"><span className="flex items-center gap-2"><ArrowUpAZ className="h-4 w-4" />Name Z → A</span></SelectItem>
        <SelectItem value="chrono_asc"><span className="flex items-center gap-2"><ArrowDown01 className="h-4 w-4" />{chronoLabel} ↑</span></SelectItem>
        <SelectItem value="chrono_desc"><span className="flex items-center gap-2"><ArrowUp01 className="h-4 w-4" />{chronoLabel} ↓</span></SelectItem>
      </SelectContent>
    </Select>
  );
}
