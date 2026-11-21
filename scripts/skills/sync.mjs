#!/usr/bin/env node
// Installs every collection in sources.json into .agents/skills with the `skills` CLI,
// pinned to the commit recorded in skills-lock.json. `--update` re-resolves to upstream HEAD.
// A 40-hex commit in a collection's `source` URL overrides both: it is the pin, so changing it in
// sources.json and running `pnpm skills:sync <id>` moves the lock to the new commit.
// `pnpm skills:sync [collection-id ...]` syncs only the named collections.
//
// The CLI is the `skills` devDependency (exact version in package.json), so it is installed under
// the repo's pnpm policy (minimumReleaseAge, trustPolicy). Its resolved bin runs with node from a
// staging directory.
//
// How it works:
//   1. Each collection is installed into its own temporary staging directory (never into the
//      repo), together with its license and extras.
//   2. Name collisions between collections, with first-party skills and with folders nobody owns
//      are detected on the staged result, BEFORE .agents/skills is touched.
//   3. Only then is the staged output applied: skill folders are replaced, skills-lock.json is
//      merged (skills, plus the sha256 of every extra file and license), licenses and extras are
//      copied.
//   4. A full sync (no ids) also prunes skill folders, lock entries and licenses/*.txt that no
//      manifest collection owns. A partial sync only drops skills a synced collection no longer
//      ships upstream. It refuses to run, before any network call or write, when a skill was
//      removed from a collection's explicit `skills` list (its lock entry has no owner any more):
//      that needs a full `pnpm skills:sync`. Duplicate ownership of a skill name fails any sync.
//   5. docs/skills.md is regenerated (`check.mjs --write`), so it is never stale.
//
// Manifest options used here:
//   "local": true            first-party collection. Edited in place, never touched by sync,
//                            not in the lock, no hash check (check.mjs still validates frontmatter).
//   "stripFrontmatter": [k]  after install, these top-level frontmatter keys are removed from every
//                            SKILL.md of the collection. The lock entry then records the hash of the
//                            stripped folder plus "strippedFrontmatter": [k], and check.mjs verifies
//                            that hash and that the keys are really gone. Not enabled on any
//                            collection yet.
// Temporary directories are removed on exit, also when a step fails.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  filesAt,
  hashFile,
  hashSkillDir,
  isExtraPath,
  LOCK_PATH,
  lockEntriesFor,
  ownedNames,
  ownership,
  parseSource,
  pinnedCommit,
  ROOT,
  readLock,
  readManifest,
  SKILLS_DIR,
  stripFrontmatterKeys,
} from "./lib.mjs";

const require = createRequire(import.meta.url);

// Entry point of the pinned `skills` devDependency.
function skillsBin() {
  const manifestPath = require.resolve("skills/package.json");
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  return join(
    dirname(manifestPath),
    typeof bin === "string" ? bin : bin.skills,
  );
}
const update = process.argv.includes("--update");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const git = (cwd, args, options = {}) =>
  execFileSync("git", args, {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
const tempDirs = [];
const checkouts = new Map();

function fail(message) {
  throw new Error(message);
}

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// A 40-hex commit in the manifest `source` wins over the lock, so editing it is how a pin moves.
function resolveCommit(repoUrl, ref, lockedCommit, pinned) {
  if (pinned) return pinned;
  if (lockedCommit && !update) return lockedCommit;
  const target = ref ?? "HEAD";
  const out = git(ROOT, ["ls-remote", `${repoUrl}.git`, target], {
    encoding: "utf8",
  });
  const rows = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  const row =
    rows.find(
      ([, name]) => name === target || name === `refs/heads/${target}`,
    ) ?? rows[0];
  if (!row) fail(`cannot resolve ${target} in ${repoUrl}`);
  return row[0];
}

function upstream(repoUrl, commit) {
  const key = `${repoUrl}@${commit}`;
  if (checkouts.has(key)) return checkouts.get(key);
  const dir = tempDir("skills-upstream-");
  git(dir, ["init", "-q"]);
  git(dir, ["fetch", "-q", "--depth", "1", `${repoUrl}.git`, commit]);
  checkouts.set(key, dir);
  return dir;
}

// Copies a file or folder of an upstream commit to `to`, relative to `base`.
function copyUpstreamPath(base, repoUrl, commit, from, to) {
  const dir = upstream(repoUrl, commit);
  const listing = git(dir, ["ls-tree", "-r", "-z", commit, "--", from], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const [meta, path] = row.split("\t");
      return { mode: meta.split(" ")[0], path };
    });
  if (listing.length === 0)
    fail(`${from} not found in ${repoUrl} at ${commit}`);
  const isFile = listing.length === 1 && listing[0].path === from;
  for (const { mode, path } of listing) {
    const target = isFile
      ? join(base, to)
      : join(base, to, relative(from, path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git(dir, ["cat-file", "blob", `${commit}:${path}`]));
    chmodSync(target, mode === "100755" ? 0o755 : 0o644);
  }
}

// Runs the skills CLI with `staging` as the project, so nothing lands in the repo.
function installSkills(collection, commit, staging) {
  const { owner, repo, subpath } = parseSource(collection.source);
  const pinned = `https://github.com/${owner}/${repo}/tree/${commit}${subpath ? `/${subpath}` : ""}`;
  const names = collection.skills === "*" ? ["*"] : collection.skills;
  const result = spawnSync(
    process.execPath,
    [
      skillsBin(),
      "add",
      pinned,
      "--skill",
      ...names,
      "--copy",
      "-a",
      "codex",
      "-y",
    ],
    {
      cwd: staging,
      encoding: "utf8",
      env: {
        ...process.env,
        DISABLE_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        CI: "1",
      },
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    fail(`skills add failed for ${collection.id}`);
  }
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

// Install one collection into a fresh staging dir and return what it produced.
function stage(collection, rootLock) {
  console.log(`sync: ${collection.id}`);
  const { ref } = parseSource(collection.source);
  const locked = lockEntriesFor(rootLock, collection)[0]?.[1].commit;
  const commit = resolveCommit(
    collection.upstream,
    ref,
    locked,
    pinnedCommit(collection),
  );
  const dir = tempDir(`skills-stage-${collection.id}-`);
  installSkills(collection, commit, dir);

  const stagedLock = readJson(join(dir, "skills-lock.json"), {
    version: 2,
    skills: {},
  });
  const entries = Object.fromEntries(lockEntriesFor(stagedLock, collection));
  const names = Object.keys(entries).sort();
  if (Array.isArray(collection.skills)) {
    for (const name of collection.skills) {
      if (!entries[name])
        fail(`${collection.id}: skill "${name}" was not installed`);
    }
  } else if (names.length === 0) {
    fail(`${collection.id}: the skills CLI installed no skills`);
  }
  for (const name of names) {
    if (!existsSync(join(dir, ".agents", "skills", name, "SKILL.md"))) {
      fail(`${collection.id}: staged skill "${name}" has no SKILL.md`);
    }
  }

  const keys = collection.stripFrontmatter ?? [];
  if (keys.length) {
    for (const name of names) {
      const skillDir = join(dir, ".agents", "skills", name);
      const file = join(skillDir, "SKILL.md");
      writeFileSync(
        file,
        stripFrontmatterKeys(readFileSync(file, "utf8"), keys),
      );
      entries[name] = {
        ...entries[name],
        computedHash: hashSkillDir(skillDir),
        strippedFrontmatter: keys,
      };
    }
  }

  const { license } = collection;
  const licenseRel = `licenses/${collection.id}.txt`;
  copyUpstreamPath(
    dir,
    license.repo ?? collection.upstream,
    license.commit ?? commit,
    license.upstreamPath,
    licenseRel,
  );
  const extraHashes = {};
  for (const extra of collection.extras ?? []) {
    copyUpstreamPath(dir, collection.upstream, commit, extra.from, extra.to);
    for (const file of filesAt(dir, extra.to))
      extraHashes[file] = hashFile(join(dir, file));
  }
  return {
    collection,
    dir,
    names,
    entries,
    extraHashes,
    licenseHash: hashFile(join(dir, licenseRel)),
  };
}

// All collision checks run on the staged result, before .agents/skills is modified.
function checkCollisions(staged, manifest, rootLock) {
  const syncing = new Set(staged.map((s) => s.collection.id));
  const { owners } = ownership(manifest, rootLock);
  const produced = new Map();
  for (const { collection, names } of staged) {
    for (const name of names) {
      const other = produced.get(name);
      if (other) {
        fail(
          `name collision on "${name}": produced by both ${other} and ${collection.id}`,
        );
      }
      produced.set(name, collection.id);
      const owner = owners.get(name);
      if (owner?.local) {
        fail(
          `name collision on "${name}": ${collection.id} would overwrite the first-party skill of ${owner.id}`,
        );
      }
      if (owner && owner.id !== collection.id && !syncing.has(owner.id)) {
        fail(
          `name collision on "${name}": ${collection.id} would overwrite the skill of ${owner.id}`,
        );
      }
      const known = rootLock.skills[name];
      if (!owner && existsSync(join(SKILLS_DIR, name)) && !known) {
        fail(
          `name collision on "${name}": a folder outside the lock would be overwritten by ${collection.id}`,
        );
      }
    }
  }
  return produced;
}

function sortedLock(lock) {
  const sorted = (map = {}) =>
    Object.fromEntries(
      Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
    );
  return {
    ...lock,
    skills: sorted(lock.skills),
    extras: sorted(lock.extras),
    licenses: sorted(lock.licenses),
  };
}

function apply(staged, manifest, rootLock, full) {
  const lock = {
    ...rootLock,
    skills: { ...rootLock.skills },
    extras: { ...rootLock.extras },
    licenses: { ...rootLock.licenses },
  };
  const stagedNames = new Set(staged.flatMap((s) => s.names));

  // Skills a synced collection used to own but no longer ships.
  for (const { collection } of staged) {
    for (const [name] of lockEntriesFor(rootLock, collection)) {
      if (!stagedNames.has(name)) {
        console.log(`sync: prune ${name} (no longer in ${collection.id})`);
        rmSync(join(SKILLS_DIR, name), { recursive: true, force: true });
        delete lock.skills[name];
      }
    }
  }

  mkdirSync(SKILLS_DIR, { recursive: true });
  for (const {
    collection,
    dir,
    names,
    entries,
    extraHashes,
    licenseHash,
  } of staged) {
    for (const name of names) {
      const target = join(SKILLS_DIR, name);
      rmSync(target, { recursive: true, force: true });
      cpSync(join(dir, ".agents", "skills", name), target, { recursive: true });
      lock.skills[name] = entries[name];
    }
    mkdirSync(join(ROOT, "licenses"), { recursive: true });
    cpSync(
      join(dir, "licenses", `${collection.id}.txt`),
      join(ROOT, "licenses", `${collection.id}.txt`),
    );
    lock.licenses[collection.id] = licenseHash;
    for (const extra of collection.extras ?? []) {
      const target = join(ROOT, extra.to);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(dir, extra.to), target, { recursive: true });
      for (const path of Object.keys(lock.extras)) {
        if (path === extra.to || path.startsWith(`${extra.to}/`))
          delete lock.extras[path];
      }
    }
    Object.assign(lock.extras, extraHashes);
  }

  if (full) {
    const keep = new Set();
    for (const collection of manifest) {
      for (const name of ownedNames(collection, { skills: {} })) keep.add(name);
    }
    for (const name of stagedNames) keep.add(name);
    for (const name of Object.keys(lock.skills)) {
      if (!stagedNames.has(name)) {
        console.log(`sync: prune lock entry ${name} (no collection owns it)`);
        delete lock.skills[name];
      }
    }
    for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && !keep.has(entry.name)) {
        console.log(
          `sync: prune .agents/skills/${entry.name} (no collection owns it)`,
        );
        rmSync(join(SKILLS_DIR, entry.name), { recursive: true, force: true });
      }
    }
    const ids = new Set(manifest.map((c) => c.id));
    // Extras that were locked but no collection declares any more: delete the file too, or the
    // stray check would fail on it. Only paths under .agents/ outside .agents/skills/ are removed.
    for (const path of Object.keys(lock.extras)) {
      if (isExtraPath(manifest, path)) continue;
      console.log(`sync: prune ${path} (no collection owns it)`);
      if (
        path.startsWith(".agents/") &&
        !path.startsWith(".agents/skills/") &&
        !path.split("/").includes("..")
      )
        rmSync(join(ROOT, path), { force: true });
      delete lock.extras[path];
    }
    for (const id of Object.keys(lock.licenses)) {
      if (!ids.has(id)) delete lock.licenses[id];
    }
    const licenses = join(ROOT, "licenses");
    if (existsSync(licenses)) {
      for (const file of readdirSync(licenses)) {
        if (file.endsWith(".txt") && !ids.has(file.slice(0, -4))) {
          console.log(`sync: prune licenses/${file} (no collection owns it)`);
          rmSync(join(licenses, file), { force: true });
        }
      }
    }
  }

  writeFileSync(LOCK_PATH, `${JSON.stringify(sortedLock(lock), null, 2)}\n`);
}

function main() {
  const manifest = readManifest();
  for (const id of only) {
    if (!manifest.some((c) => c.id === id)) fail(`unknown collection "${id}"`);
  }
  const full = only.length === 0;
  const targets = manifest.filter(
    (c) => !c.local && (full || only.includes(c.id)),
  );
  if (only.length && targets.length === 0) {
    fail(`nothing to sync: ${only.join(", ")} is first-party`);
  }
  const rootLock = readLock();
  const { owners, duplicates } = ownership(manifest, rootLock);
  if (duplicates.length) {
    fail(`skill names owned by two collections: ${duplicates.join("; ")}`);
  }
  if (!full) {
    // A name removed from an explicit `skills` list leaves a lock entry nobody owns. Only a full
    // sync prunes it, so refuse now instead of leaving the tree half updated.
    const orphans = Object.keys(rootLock.skills).filter(
      (name) => !owners.has(name),
    );
    if (orphans.length) {
      fail(
        `${orphans.join(", ")} no longer belong to any collection (removed from a skills list in sources.json?). A partial sync cannot prune them: run a full "pnpm skills:sync" first.`,
      );
    }
  }
  const staged = targets.map((collection) => stage(collection, rootLock));
  checkCollisions(staged, manifest, rootLock);
  apply(staged, manifest, rootLock, full);

  const check = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "skills", "check.mjs"), "--write"],
    { stdio: "inherit" },
  );
  if (check.status !== 0) fail("check.mjs --write reported errors");
}

try {
  main();
} catch (error) {
  console.error(`sync: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}
