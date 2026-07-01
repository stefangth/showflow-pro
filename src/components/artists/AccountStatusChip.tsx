import { ACCOUNT_STATE_META, type AccountState } from "@/lib/artistAccount";

/** Quiet dot + label account-status chip (shared vocabulary; semantic tokens). */
export function AccountStatusChip({ state }: { state: AccountState }) {
  const meta = ACCOUNT_STATE_META[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
