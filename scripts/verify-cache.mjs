#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const command = process.argv[2];
const mode = process.argv[3];

if (!new Set(["check", "record", "clear"]).has(command) || !new Set(["fast", "full"]).has(mode)) {
  console.error("usage: verify-cache.mjs check|record|clear fast|full");
  process.exit(2);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

const repoRoot = git(["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
const gitCachePath = git(["rev-parse", "--git-path", "showflow-verify-cache"], {
  cwd: repoRoot,
});
const cacheDir = isAbsolute(gitCachePath) ? gitCachePath : resolve(repoRoot, gitCachePath);

function fingerprint() {
  const paths = git(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot },
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => path !== ".claude/worktrees" && !path.startsWith(".claude/worktrees/"))
    .sort();
  const hash = createHash("sha256");

  for (const path of paths) {
    const absolute = join(repoRoot, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    if (stat.isFile()) {
      const executable = stat.mode & 0o111 ? "x" : "-";
      hash.update(`file:${executable}:${Buffer.byteLength(path)}:${path}:`);
      hash.update(readFileSync(absolute));
    } else if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute);
      hash.update(`link:${Buffer.byteLength(path)}:${path}:${Buffer.byteLength(target)}:${target}`);
    } else if (stat.isDirectory()) {
      // Git reports an embedded repository as one directory entry. Its checked
      // out commit is the content boundary relevant to this checkout.
      let head = "unborn";
      try {
        head = git(["-C", absolute, "rev-parse", "HEAD"], { cwd: repoRoot });
      } catch {
        // An ordinary empty directory has no source content to fingerprint.
        continue;
      }
      hash.update(`gitlink:${Buffer.byteLength(path)}:${path}:${head}`);
    }
  }

  return hash.digest("hex");
}

function stampPath(stampMode) {
  return join(cacheDir, stampMode);
}

function clearStamps() {
  // A failed fast layer also invalidates any earlier full-suite success for the
  // same snapshot, so starting either mode clears both levels conservatively.
  rmSync(stampPath("fast"), { force: true });
  rmSync(stampPath("full"), { force: true });
}

if (command === "clear") {
  clearStamps();
  process.exit(0);
}

const current = fingerprint();

if (command === "check") {
  let recorded = "";
  try {
    recorded = readFileSync(stampPath(mode), "utf8").trim();
  } catch {
    // A missing stamp is an ordinary cache miss.
  }

  if (recorded === current) {
    console.error(`verify-cache: ${mode} verification already passed for ${current}`);
    process.exit(0);
  }

  console.error(`verify-cache: no matching ${mode} verification for ${current}`);
  process.exit(1);
}

mkdirSync(cacheDir, { recursive: true });
const modesToRecord = mode === "full" ? ["fast", "full"] : ["fast"];
for (const stampMode of modesToRecord) {
  const destination = stampPath(stampMode);
  const temporary = `${destination}.tmp-${process.pid}`;
  writeFileSync(temporary, `${current}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
}
console.error(`verify-cache: recorded ${mode} verification for ${current}`);
