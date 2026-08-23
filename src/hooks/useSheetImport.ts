import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SheetDateRaw } from "@/lib/sheetImport/mapRows";
import {
  fetchSheetImportSettings, saveSheetImportSettings, fetchSheetHeaders, importSheetDates,
  type SheetImportSettings, type SheetImportResult,
} from "@/data/sheetImport";

const DEFAULT_SETTINGS: SheetImportSettings = { url: "", map: {} };

/**
 * Sheet-import settings + actions for one org: the saved URL/column mapping, a
 * header-loading helper for the mapping UI, and the trigger to run the import via
 * the `import-sheet-dates` edge function. A successful import creates show_dates
 * and may open offer tiers, so it busts both the `show-dates` and `bookings`
 * domains in addition to this hook's own settings key.
 */
export function useSheetImport(orgId: string | null) {
  const qc = useQueryClient();
  const SETTINGS_KEY = ["sheet-import", orgId] as const;

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

  const loadHeaders = (url: string): Promise<string[]> => {
    if (!orgId) return Promise.reject(new Error("No active org"));
    return fetchSheetHeaders(supabase, orgId, url);
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
  });

  return {
    settings: settingsQ.data ?? DEFAULT_SETTINGS,
    isLoading: settingsQ.isLoading,
    saveSettings: (s: SheetImportSettings) => saveSettingsMut.mutate(s),
    saving: saveSettingsMut.isPending,
    loadHeaders,
    runImport: (rows: SheetDateRaw[]) => runImportMut.mutate(rows),
    importing: runImportMut.isPending,
    result: (runImportMut.data as SheetImportResult | undefined) ?? null,
  };
}
