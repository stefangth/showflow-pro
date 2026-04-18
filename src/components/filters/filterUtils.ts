import type { TimeframeValue } from '@/components/filters/TimeframeFilter';
import type { SortValue } from '@/components/filters/SortControl';

export function inTimeframe(date: Date | null, tf: TimeframeValue): boolean {
  if (!tf.from && !tf.to) return true;
  if (!date) return false;
  if (tf.from && date < tf.from) return false;
  if (tf.to) {
    const end = new Date(tf.to);
    end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
}

export function applySort<T>(items: T[], sort: SortValue, getName: (t: T) => string, getDate: (t: T) => Date | null): T[] {
  const arr = [...items];
  if (sort === 'alpha_asc') return arr.sort((a, b) => getName(a).localeCompare(getName(b)));
  if (sort === 'alpha_desc') return arr.sort((a, b) => getName(b).localeCompare(getName(a)));
  const dir = sort === 'chrono_asc' ? 1 : -1;
  return arr.sort((a, b) => {
    const da = getDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const db = getDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    return (da - db) * dir;
  });
}
