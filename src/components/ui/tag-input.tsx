import { useState } from 'react';
import { Check, ChevronsUpDown, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type TagOption = { id: string; name: string };

interface TagInputProps {
  options: TagOption[];
  value: TagOption[];
  onChange: (next: TagOption[]) => void;
  onCreate?: (name: string) => Promise<TagOption>;
  placeholder?: string;
  disabled?: boolean;
}

export function TagInput({
  options,
  value,
  onChange,
  onCreate,
  placeholder = 'Select…',
  disabled,
}: TagInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedIds = new Set(value.map((v) => v.id));
  const lcQuery = query.trim().toLowerCase();
  const exactMatch = options.some((o) => o.name.toLowerCase() === lcQuery);
  const canCreate = !!onCreate && lcQuery.length > 0 && !exactMatch;

  function toggle(opt: TagOption) {
    if (selectedIds.has(opt.id)) {
      onChange(value.filter((v) => v.id !== opt.id));
    } else {
      onChange([...value, opt]);
    }
  }

  async function handleCreate() {
    if (!onCreate || !lcQuery) return;
    setCreating(true);
    try {
      const created = await onCreate(query.trim());
      onChange([...value, created]);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="text-muted-foreground">{placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search or type to create…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm w-full text-left hover:bg-accent rounded"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create "{query.trim()}"
                  </button>
                ) : (
                  <span className="px-3 py-1.5 text-sm text-muted-foreground">No matches</span>
                )}
              </CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={opt.name}
                    onSelect={() => toggle(opt)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedIds.has(opt.id) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {opt.name}
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem onSelect={handleCreate} disabled={creating}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create "{query.trim()}"
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v.id} variant="secondary" className="gap-1">
              {v.name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                  className="hover:text-destructive"
                  aria-label={`Remove ${v.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
