import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SheetDateRaw } from "@/lib/sheetImport/mapRows";
import type { ParsedSheet } from "@/lib/artistImport/parseSheet";
import {
  fetchSheetImportSettings, saveSheetImportSettings, fetchSheetParsed, importSheetDates,
  type SheetImportSettings, type SheetImportResult,
} from "@/data/sheetImport";

const DEFAULT_SETTINGS: SheetImportSettings = { url: "", map: {} };

/**
 * Sheet-import settings + actions for one org: the saved URL/column mapping, a
 * sheet-loading helper for the mapping UI and the import trigger, and the trigger to run
 * the import via the `import-sheet-dates` edge function. A successful import creates
 * show_dates and may open offer tiers, so it busts both the `show-dates` and `bookings`
 * domains in addition to this hook's own settings key.
 *
 * `loadSheet` fetches + parses the sheet once and caches the result in `parsed`
 * (component state, not a query — it's a one-shot action, not a background-refetchable
 * read): the Connect step's "Load columns" action and the Cities step's "Import dates
 * now" action both need the parsed sheet (headers for mapping, rows for `mapSheetRows`),
 * so caching it here means Cities only re-fetches if the mount never loaded it (e.g. the
 * visitor reached Cities directly with a cold hook). `loadHeaders` is a thin
 * headers-only wrapper kept for callers that only care about column names.
 */
export function useSheetImport(orgId: string | null) {
  const qc = useQueryClient();
  const SETTINGS_KEY = ["sheet-import", orgId] as const;
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);

  const settingsQ = useQuery({
    queryKey: SETTINGS_KEY,
    enabled: !!orgId,
    queryFn: () => fetchSheetImportSettings(supabase, orgId),
  });

  const saveSettingsMut = useMutation({
    mutationFn: (settings: SheetImportSettings) => {
      if (!orgId) throw new Error("No active org");
      return saveSheetImportSettings(supabase, orgId, settings);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  /** Fetches and parses the sheet, caching the result so `runImport` (via `mapSheetRows`)
   *  and any other consumer within the same mount don't re-fetch it. */
  const loadSheet = async (url: string): Promise<ParsedSheet> => {
    if (!orgId) return Promise.reject(new Error("No active org"));
    const result = await fetchSheetParsed(supabase, orgId, url);
    setParsed(result);
    return result;
  };

  /** Headers-only view of `loadSheet`, for the mapping UI. */
  const loadHeaders = async (url: string): Promise<string[]> => {
    const result = await loadSheet(url);
    return result.headers;
  };

  const runImportMut = useMutation({
    mutationFn: (rows: SheetDateRaw[]) => {
      if (!orgId) throw new Error("No active org");
      return importSheetDates(supabase, orgId, rows);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      void qc.invalidateQueries({ queryKey: ["show-dates"] });
      void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    // runImport is fired via `mutate` (not awaited) from CitiesStep, so a rejected
    // request has no other path back to the user: without this, the button just flips
    // back to idle and the caller can't tell a failed import from one that never ran.
    onError: () => {
      toast.error("Import failed. Check the sheet link and your access, then try again.");
    },
  });

  return {
    settings: settingsQ.data ?? DEFAULT_SETTINGS,
    isLoading: settingsQ.isLoading,
    saveSettings: (s: SheetImportSettings) => saveSettingsMut.mutate(s),
    saving: saveSettingsMut.isPending,
    loadHeaders,
    loadSheet,
    parsed,
    runImport: (rows: SheetDateRaw[]) => runImportMut.mutate(rows),
    importing: runImportMut.isPending,
    result: (runImportMut.data as SheetImportResult | undefined) ?? null,
    importError: runImportMut.error,
  };
}
