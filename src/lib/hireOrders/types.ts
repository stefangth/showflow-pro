// Hire order pure-logic types + field key registry.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same
// resolveFields + orderNo + money + validate logic in one file (the two
// runtimes cannot share an import). Change both files in the same commit.
//
// The types themselves live in ./pdf/docTypes.ts (dual-homed for the PDF
// renderer's browser preview) and are re-exported here so every existing
// `@/lib/hireOrders/types` import keeps resolving unchanged.

export * from "./pdf/docTypes.ts";
