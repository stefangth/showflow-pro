import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SqlCaseValue = string | boolean | null;

export interface SqlMigrationSource {
  filename: string;
  sql: string;
}

export interface EffectiveCaseMap {
  mapping: Record<string, SqlCaseValue>;
  fallback: SqlCaseValue;
  sourceFile: string;
}

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
  "supabase/migrations",
);

function stripSqlComments(sql: string): string {
  let output = "";
  let index = 0;
  let quote: "'" | '"' | null = null;
  let blockDepth = 0;
  let lineComment = false;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (blockDepth > 0) {
      if (char === "/" && next === "*") {
        blockDepth += 1;
        output += "  ";
        index += 2;
      } else if (char === "*" && next === "/") {
        blockDepth -= 1;
        output += "  ";
        index += 2;
      } else {
        output += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (char === quote && next === quote) {
        output += next;
        index += 2;
      } else if (char === "\\" && next !== undefined) {
        output += next;
        index += 2;
      } else {
        if (char === quote) quote = null;
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      index += 1;
    } else if (char === "-" && next === "-") {
      lineComment = true;
      output += "  ";
      index += 2;
    } else if (char === "/" && next === "*") {
      blockDepth = 1;
      output += "  ";
      index += 2;
    } else {
      output += char;
      index += 1;
    }
  }

  if (blockDepth > 0) throw new Error("unterminated SQL block comment");
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionBodies(sql: string, functionName: string): string[] {
  const executableSql = stripSqlComments(sql);
  const escapedName = escapeRegExp(functionName);
  const definition = new RegExp(
    `\\bcreate\\s+or\\s+replace\\s+function\\s+(?:public\\s*\\.\\s*)?${escapedName}`
      + `\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s+(\\$[A-Za-z_][A-Za-z0-9_]*\\$|\\$\\$)`
      + `([\\s\\S]*?)\\1\\s*;`,
    "gi",
  );

  return Array.from(executableSql.matchAll(definition), (match) => match[2]);
}

function parseSqlScalar(raw: string): SqlCaseValue {
  const normalized = raw.trim();
  if (/^true$/i.test(normalized)) return true;
  if (/^false$/i.test(normalized)) return false;
  if (/^null$/i.test(normalized)) return null;
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).replace(/''/g, "'");
  }
  throw new Error(`unsupported CASE value: ${raw}`);
}

function parseCaseMap(body: string): Pick<EffectiveCaseMap, "mapping" | "fallback"> {
  const executableBody = stripSqlComments(body);
  const quoted = "'(?:''|[^'])*'";
  const branch = new RegExp(
    `\\bwhen\\s+(?:[A-Za-z_][A-Za-z0-9_]*\\s+in\\s*\\((?<list>${quoted}(?:\\s*,\\s*${quoted})*)\\)|(?<single>${quoted}))`
      + `\\s+then\\s+(?<value>true|false|null|${quoted})`,
    "gi",
  );
  const mapping: Record<string, SqlCaseValue> = {};
  let parsedClauseCount = 0;

  for (const match of executableBody.matchAll(branch)) {
    parsedClauseCount += 1;
    const groups = match.groups ?? {};
    const keyLiterals = groups.list
      ? Array.from(groups.list.matchAll(new RegExp(quoted, "g")), (keyMatch) => keyMatch[0])
      : [groups.single];
    const value = parseSqlScalar(groups.value);

    for (const keyLiteral of keyLiterals) {
      const key = parseSqlScalar(keyLiteral);
      if (typeof key !== "string") throw new Error(`CASE key must be text: ${keyLiteral}`);
      if (Object.prototype.hasOwnProperty.call(mapping, key)) {
        throw new Error(`duplicate CASE key '${key}'`);
      }
      mapping[key] = value;
    }
  }

  const executableWhenCount = executableBody.match(/\bwhen\b/gi)?.length ?? 0;
  if (parsedClauseCount !== executableWhenCount) {
    throw new Error(`unsupported CASE clause: parsed ${parsedClauseCount} of ${executableWhenCount}`);
  }

  const fallbackMatch = executableBody.match(
    new RegExp(`\\belse\\s+(?<fallback>true|false|null|${quoted})\\s+end\\b`, "i"),
  );
  if (!fallbackMatch?.groups?.fallback) throw new Error("missing CASE fallback");

  return {
    mapping,
    fallback: parseSqlScalar(fallbackMatch.groups.fallback),
  };
}

export function parseEffectiveCaseMap(
  migrations: readonly SqlMigrationSource[],
  functionName: string,
): EffectiveCaseMap {
  let effective: EffectiveCaseMap | undefined;

  for (const migration of [...migrations].sort((left, right) =>
    left.filename.localeCompare(right.filename))) {
    for (const body of functionBodies(migration.sql, functionName)) {
      effective = { ...parseCaseMap(body), sourceFile: migration.filename };
    }
  }

  if (!effective) throw new Error(`no executable CREATE OR REPLACE FUNCTION found for ${functionName}`);
  return effective;
}

export function readEffectiveCaseMap(functionName: string): EffectiveCaseMap {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => ({
      filename,
      sql: readFileSync(join(MIGRATIONS_DIR, filename), "utf8"),
    }));

  return parseEffectiveCaseMap(migrations, functionName);
}
