import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Why this file exists (PR #191 -> #200, "types.ts cannot be regenerated"):
//
// PostgREST's type generator models EVERY RPC argument as non-nullable. It has
// no way to express `CALLED ON NULL INPUT`, so a function that legitimately
// accepts NULL still generates `p_foo: string`, never `p_foo: string | null`.
//
// PR #191 worked around that by hand-editing the two
// `create_hire_order_with_dates` args in the GENERATED file to `| null`. That
// silently made src/integrations/supabase/types.ts un-regenerable: any clean
// `supabase gen types` wipes the edit and breaks
// supabase/functions/generate-hire-orders/index.ts, which passes NULL for both
// (a NULL fee means "no fee entered"; a NULL creator means the cron/trigger
// auto-draft path, which has no JWT). PR #200 then had to hand-edit the file a
// SECOND time to add one column rather than regenerate, which an auto-review
// flagged against the CLAUDE.md rule "never edit src/integrations/supabase/types.ts".
//
// The verified facts behind the fix: the live function is `proisstrict = false`
// and both target columns are nullable with no CHECK constraint
// (`hire_orders.created_by`'s FK is even ON DELETE SET NULL). So the SQL is
// correct and the generated types are merely lossy. Nullability now lives in a
// HAND-maintained file, supabase/functions/_shared/rows.ts, which is where the
// codebase already documents this exact type-gen limitation for
// `resolve_show_assignments`.
//
// This is invisible until someone regenerates, which is rare enough that the
// breakage outlives the memory of why. Hence a test.
describe("generated supabase types stay generator-faithful", () => {
  const GENERATED = [
    "src/integrations/supabase/types.ts",
    // The mirror is produced from the file above by `npm run sync:mirrors`, so
    // a hand-edit that reached it would also survive here.
    "supabase/functions/_shared/database.types.ts",
  ];

  it.each(GENERATED)("%s widens no RPC argument to `| null`", (file) => {
    // A nullable RPC ARG cannot come out of the generator, so any occurrence is
    // a hand-edit. Nullable Returns fields are legitimate (they are row shapes),
    // which is why this inspects Args blocks only.
    expect(nullableRpcArgs(readFileSync(file, "utf8"))).toEqual([]);
  });

  it.each(GENERATED)("%s types the hire-order RPC args as the DB reports them", (file) => {
    // The specific regression. If these ever read `| null` again, the fix was
    // applied to the generated file instead of to rows.ts.
    const args = readFileSync(file, "utf8").match(
      /create_hire_order_with_dates: \{\s*Args: \{([^}]*)\}/,
    );
    expect(args, "create_hire_order_with_dates missing from generated types")
      .not.toBeNull();
    expect(args![1]).toContain("p_created_by: string\n");
    expect(args![1]).toContain("p_fee_amount: number\n");
  });
});

/** Every `name: type | null` line that sits inside a Functions `Args: {` block. */
function nullableRpcArgs(source: string): string[] {
  const offenders: string[] = [];
  let argsIndent: number | null = null;

  for (const line of functionsSection(source).split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (argsIndent !== null && indent <= argsIndent && line.trim() === "}") {
      argsIndent = null;
      continue;
    }
    if (argsIndent === null) {
      if (/^\s*Args: \{\s*$/.test(line)) argsIndent = indent;
      continue;
    }
    if (line.includes("| null")) offenders.push(line.trim());
  }
  return offenders;
}

/** The `public` schema's Functions block, where RPC signatures are declared. */
function functionsSection(source: string): string {
  const start = source.indexOf("    Functions: {", source.indexOf("  public: {"));
  const end = source.indexOf("\n    Enums: {", start);
  if (start === -1 || end === -1) {
    throw new Error("could not locate the public Functions block");
  }
  return source.slice(start, end);
}
