// @vitest-environment node
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { TABLE_COLUMNS, COMPUTED_LABELS } from './columnRegistries';

describe('columnRegistries / RPC allowlist sync', () => {
  it('every non-_computed table in TABLE_COLUMNS appears in the get_column_descriptions allowlist', () => {
    // Anchor to this file so the path is correct regardless of cwd.
    const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'supabase', 'migrations');

    // Find the last migration (alphabetical = chronological by timestamp prefix)
    // that defines get_column_descriptions. Using the last one handles
    // CREATE OR REPLACE — a superseding migration wins over earlier ones.
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let authoritative: string | null = null;
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      if (sql.includes('get_column_descriptions')) {
        authoritative = sql;
      }
    }

    expect(
      authoritative,
      'no migration defines get_column_descriptions — add one or check the migrations directory'
    ).not.toBeNull();

    const tables = Object.keys(TABLE_COLUMNS).filter(t => t !== '_computed');
    for (const table of tables) {
      expect(
        authoritative,
        `table '${table}' missing from get_column_descriptions allowlist`
      ).toContain(`'${table}'`);
    }
  });
});

describe('COMPUTED_LABELS / TABLE_COLUMNS._computed sync', () => {
  it('every _computed column in TABLE_COLUMNS has a label in COMPUTED_LABELS', () => {
    for (const col of TABLE_COLUMNS._computed ?? []) {
      const key = `_computed.${col}`;
      expect(
        key in COMPUTED_LABELS,
        `COMPUTED_LABELS is missing an entry for "${key}" — add it to columnRegistries.ts`
      ).toBe(true);
    }
  });
});
