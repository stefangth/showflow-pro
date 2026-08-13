import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UNSUPPORTED_ROOT_LOCKFILES = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

export function findUnsupportedRootLockfiles(rootDir) {
  return UNSUPPORTED_ROOT_LOCKFILES.filter((filename) =>
    existsSync(join(rootDir, filename)),
  );
}

export function runPackageManagerCheck(
  rootDir,
  io = { out: console.log, error: console.error },
) {
  const unsupported = findUnsupportedRootLockfiles(rootDir);
  if (unsupported.length === 0) {
    io.out("package-manager policy: npm lockfile only");
    return 0;
  }

  io.error(
    `Unsupported root lockfile(s): ${unsupported.join(", ")}. ` +
      "Use npm install for dependency changes and commit package-lock.json.",
  );
  return 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = join(dirname(scriptPath), "..");
  process.exitCode = runPackageManagerCheck(repoRoot);
}
