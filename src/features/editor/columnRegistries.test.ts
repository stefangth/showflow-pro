import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { TABLE_COLUMNS } from './columnRegistries';

describe('columnRegistries / RPC allowlist sync', () => {
  it('every non-_computed table in TABLE_COLUMNS appears in the get_column_descriptions allowlist', () => {
    const migrationPath = resolve(
      process.cwd(),
      'supabase/migrations/20260517170000_add_column_descriptions_rpc.sql'
    );
    const sql = readFileSync(migrationPath, 'utf8');

    const tables = Object.keys(TABLE_COLUMNS).filter(t => t !== '_computed');
    for (const table of tables) {
      expect(sql, `table '${table}' missing from get_column_descriptions allowlist`).toContain(`'${table}'`);
    }
  });
});
