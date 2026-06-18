// @vitest-environment node
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { TABLE_COLUMNS, COMPUTED_LABELS, resolveColumnTemplate, customFieldDefToColumnDef, CUSTOM_FIELD_PAGES } from './columnRegistries';
import type { ColumnDef } from './types';

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
      if (sql.includes('CREATE OR REPLACE FUNCTION get_column_descriptions')) {
        authoritative = sql;
      }
    }

    expect(
      authoritative,
      'no migration defines get_column_descriptions — add one or check the migrations directory'
    ).not.toBeNull();

    const arrayLiteral = authoritative!.match(/ANY\s*\(\s*ARRAY\s*\[([^\]]+)\]/s)?.[1] ?? '';
    expect(
      arrayLiteral.length,
      'could not parse table allowlist from get_column_descriptions migration — regex may need updating'
    ).toBeGreaterThan(0);
    const tables = Object.keys(TABLE_COLUMNS).filter(t => t !== '_computed');
    for (const table of tables) {
      expect(
        arrayLiteral,
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

const customCol: ColumnDef = customFieldDefToColumnDef({ key: 'capacity', type: 'number' }, 99);

describe('customFieldDefToColumnDef', () => {
  it('builds a hidden custom column with a custom.<key> id', () => {
    expect(customCol).toEqual({
      id: 'custom.capacity', table: 'custom', column: 'capacity',
      kind: 'custom', customType: 'number', defaultVisible: false, defaultOrder: 99,
    });
  });
});

describe('CUSTOM_FIELD_PAGES', () => {
  it('maps the producer bookings page to show_dates', () => {
    expect(CUSTOM_FIELD_PAGES['bookings-producer']).toBe('show_dates');
    expect(CUSTOM_FIELD_PAGES['availability']).toBeUndefined();
  });
});

describe('resolveColumnTemplate with extraDefs', () => {
  it('includes custom columns (hidden) when no saved template', () => {
    const cols = resolveColumnTemplate('bookings-producer', 'producer', {}, [customCol]);
    const custom = cols.find(c => c.columnId === 'custom.capacity');
    expect(custom).toBeDefined();
    expect(custom!.visible).toBe(false);
  });

  it('keeps a custom column that the saved template enabled', () => {
    const saved = {
      'bookings-producer': {
        producer: [{ columnId: 'custom.capacity', visible: true, order: 0 }],
      },
    };
    const cols = resolveColumnTemplate('bookings-producer', 'producer', saved, [customCol]);
    expect(cols.find(c => c.columnId === 'custom.capacity')!.visible).toBe(true);
  });
});
