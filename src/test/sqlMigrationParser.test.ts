import { describe, expect, it } from "vitest";
import { parseEffectiveCaseMap } from "./sqlMigrationParser";

const COMMENTED_CLAUSES_FIXTURE = `
create or replace function public.sample_default(_key text)
returns boolean language sql as $$
  select case _key
    /* when 'block_only' then true */
    -- when 'line_only' then true
    when 'live' then false
    else false
  end;
$$;
`;

const FIRST_DEFINITION_FIXTURE = `
create or replace function public.sample_default(_key text)
returns boolean language sql as $$
  select case _key
    when 'live' then true
    else false
  end;
$$;
`;

const LATER_OVERRIDE_FIXTURE = `
create or replace function public.sample_default(_key text)
returns boolean language sql as $$
  select case _key
    when 'live' then false
    else false
  end;
$$;
`;

describe("SQL migration CASE parser", () => {
  it("excludes CASE clauses that exist only in block or line comments", () => {
    const effective = parseEffectiveCaseMap(
      [{ filename: "20260101000000_initial.sql", sql: COMMENTED_CLAUSES_FIXTURE }],
      "sample_default",
    );

    expect(effective.mapping).toEqual({ live: false });
    expect(effective.fallback).toBe(false);
  });

  it("uses the last executable function replacement in migration filename order", () => {
    const effective = parseEffectiveCaseMap(
      [
        { filename: "20260102000000_override.sql", sql: LATER_OVERRIDE_FIXTURE },
        { filename: "20260101000000_initial.sql", sql: FIRST_DEFINITION_FIXTURE },
      ],
      "sample_default",
    );

    expect(effective.sourceFile).toBe("20260102000000_override.sql");
    expect(effective.mapping).toEqual({ live: false });
    expect(effective.mapping).not.toEqual({ live: true });
  });

  it("rejects duplicate keys across CASE clauses", () => {
    const duplicateFixture = `
      create or replace function public.sample_default(_key text)
      returns boolean language sql as $$
        select case _key
          when 'same' then true
          when 'same' then false
          else false
        end;
      $$;
    `;

    expect(() => parseEffectiveCaseMap(
      [{ filename: "20260101000000_duplicate.sql", sql: duplicateFixture }],
      "sample_default",
    )).toThrow(/duplicate CASE key 'same'/);
  });
});
