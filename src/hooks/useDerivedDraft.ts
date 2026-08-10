import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/**
 * An editable draft that is a VIEW of a server value rather than a copy of it.
 *
 * The pattern this replaces — `useState(DEFAULT)` plus a seed-once effect
 * guarded by a ref — has a window in it. The effect lands a commit AFTER the
 * one where the query data arrived, so a form gated only on `isLoading` renders
 * fully interactive with the DEFAULT still in state, and a Save clicked there
 * persists that default over the org's real stored settings. The window is one
 * commit wide, which is why it never reproduces by hand: it is real, and it is
 * how `{}` reached `hire_order_theme` in the template editor.
 *
 * The same ref is also why such a form never re-seeds when the active org
 * changes underneath it, so the previous org's values sit over the new org's
 * settings, ready to be saved into them.
 *
 * Deriving removes both: `null` edits mean untouched, so the draft simply IS
 * the server value, from the first render it exists. The guarantee the ref was
 * there for survives — once edited, the draft pins to the edit and no later
 * refetch can clobber work in progress.
 *
 * The setter takes a value or an updater function, so `setForm((f) => ({ ...f,
 * x }))` call sites keep working unchanged; the updater composes against the
 * derived draft, never against the marker underneath it.
 *
 * @param serverValue the loaded value, `undefined` until the query resolves
 * @param fallback    what to show when there is nothing loaded yet
 * @returns `[draft, setDraft, isEdited]`
 */
export function useDerivedDraft<T>(
  serverValue: T | undefined,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [edits, setEdits] = useState<{ value: T } | null>(null);
  const draft = edits ? edits.value : serverValue ?? fallback;

  // Boxed in `{ value }` so a T that is itself a function is stored rather than
  // mistaken for an updater, and so `null` unambiguously means untouched even
  // when T is nullable.
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setEdits((prev) => {
        const base = prev ? prev.value : serverValue ?? fallback;
        return { value: typeof next === "function" ? (next as (p: T) => T)(base) : next };
      }),
    [serverValue, fallback],
  );

  return [draft, setDraft, edits !== null];
}
