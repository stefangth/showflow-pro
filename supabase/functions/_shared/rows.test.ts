import { assertEquals } from "./test-asserts.ts";
import type { CreateHireOrderWithDatesArgs } from "./rows.ts";

// These assertions are really about the TYPE, not the values: `deno test` type-
// checks, so a build of `CreateHireOrderWithDatesArgs` that rejects null stops
// compiling here. That is the point. It guards the fix for the regeneration
// deadlock described in scripts/generatedTypes.test.ts from being "solved" by
// narrowing the call site instead — NULL is the real representation of both
// "no fee entered" and "created by the system", and the live RPC is
// `proisstrict = false`, so it stores both verbatim.
Deno.test("CreateHireOrderWithDatesArgs: fee and creator accept NULL", () => {
  const args: CreateHireOrderWithDatesArgs = {
    p_org: "00000000-0000-0000-0000-000000000001",
    p_order_no: "HO-0001",
    p_artist: "00000000-0000-0000-0000-000000000002",
    p_show_date_ids: ["00000000-0000-0000-0000-000000000003"],
    p_data: {},
    p_fee_amount: null,
    p_fee_currency: "EUR",
    p_terms_variant: "standard",
    p_created_by: null,
  };

  assertEquals(args.p_fee_amount, null);
  assertEquals(args.p_created_by, null);
});

Deno.test("CreateHireOrderWithDatesArgs: non-null values still fit", () => {
  const args: CreateHireOrderWithDatesArgs = {
    p_org: "00000000-0000-0000-0000-000000000001",
    p_order_no: "HO-0002",
    p_artist: "00000000-0000-0000-0000-000000000002",
    p_show_date_ids: ["00000000-0000-0000-0000-000000000003"],
    p_data: {},
    p_fee_amount: 1250.5,
    p_fee_currency: "EUR",
    p_terms_variant: "standard",
    p_created_by: "00000000-0000-0000-0000-000000000004",
  };

  assertEquals(args.p_fee_amount, 1250.5);
  assertEquals(args.p_created_by, "00000000-0000-0000-0000-000000000004");
});
