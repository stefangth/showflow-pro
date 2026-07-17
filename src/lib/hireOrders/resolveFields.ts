// Hire order field resolution — merges the four data layers into one snapshot.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same logic
// (the two runtimes cannot share an import). Change both files in the same commit.

import { ORDER_FIELD_KEYS } from "./types";
import type { FieldLayers, FieldSource, OrderData } from "./types";

/** Precedence order, highest first: manual > sheet > showflow > default. */
const LAYER_PRECEDENCE: Array<{ layer: keyof FieldLayers; source: FieldSource }> = [
  { layer: "manual", source: "manual" },
  { layer: "sheet", source: "sheet" },
  { layer: "showflow", source: "showflow" },
  { layer: "defaults", source: "default" },
];

/**
 * Resolve each order field to the highest-precedence layer that has a
 * non-empty value, tagging it with which layer it came from. `undefined`
 * and `""` values are treated as absent and skipped.
 */
export function resolveFields(layers: FieldLayers): OrderData {
  const out: OrderData = {};
  for (const key of ORDER_FIELD_KEYS) {
    for (const { layer, source } of LAYER_PRECEDENCE) {
      const value = layers[layer]?.[key];
      if (value === undefined || value === "") continue;
      out[key] = { value, source };
      break;
    }
  }
  return out;
}
