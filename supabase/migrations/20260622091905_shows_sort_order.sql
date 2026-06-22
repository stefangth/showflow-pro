-- Add a per-show display order for the Productions catalog (drag-reorder).
-- Nullable smallint; ordering uses `sort_order NULLS LAST, program, sub_program`.
alter table public.shows add column sort_order smallint;

-- Stable initial order for existing rows (per org, current alphabetical order).
with ranked as (
  select id, row_number() over (partition by org_id order by program, sub_program) as rn
  from public.shows
)
update public.shows s set sort_order = ranked.rn
from ranked where ranked.id = s.id;
