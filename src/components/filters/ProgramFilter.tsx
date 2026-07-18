import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Props {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}

export function ProgramFilter({ options, value, onChange, className }: Props) {
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-between min-w-[160px]', className)}>
          <span className="truncate">
            {value.length === 0 ? 'All programs' : `${value.length} program${value.length > 1 ? 's' : ''}`}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {options.length === 0 && <p className="text-xs text-muted-foreground p-2">No programs available</p>}
        <div className="max-h-64 overflow-y-auto">
          {options.map(opt => {
            const selected = value.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className="flex items-center w-full gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left"
              >
                <div className={cn('h-4 w-4 rounded-sm border flex items-center justify-center', selected ? 'bg-primary border-primary text-primary-foreground' : 'border-input')}>
                  {selected && <Check className="h-3 w-3" />}
                </div>
                <span className="truncate">{opt}</span>
              </button>
            );
          })}
        </div>
        {value.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground w-full text-left px-2 pt-2 mt-1 border-t">
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
