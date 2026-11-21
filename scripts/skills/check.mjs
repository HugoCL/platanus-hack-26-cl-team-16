#!/usr/bin/env node
// Validates .agents/skills against sources.json and skills-lock.json.
// `--write` regenerates docs/skills.md; without it a stale docs/skills.md is an error.
//
// Beyond the manifest and lock bookkeeping it checks content:
//   - no symlink anywhere under .agents/ (lstat, links are never followed);
//   - every lock entry that records installMode has installMode "copy";
//   - every vendored skill folder hashes to its computedHash in skills-lock.json, with the exact
//     algorithm of the pinned skills CLI v1.9.0 (see hashSkillDir in lib.mjs), so a hand edit of a
//     vendored file fails with the skill name. The hash does not cover files named metadata.json
//     (rejected here: the installer never copies one), .DS_Store, or the directories .git,
//     __pycache__ and __pypackages__. Collections with `stripFrontmatter` are recorded by
//     sync.mjs with the hash of the stripped folder plus `strippedFrontmatter`; check verifies
//     that hash, that the keys are really gone and that the lock matches the manifest;
//   - every extra file (.agents/agents/*, .agents/docs/harness/*) and every non-first-party
//     licenses/<id>.txt hashes to the sha256 recorded under `extras` and `licenses` in
//     skills-lock.json, and nothing else lives under .agents/ (outside .agents/skills/, whose
//     folders the skill hashes cover) or in licenses/;
//   - a collection whose `source` URL pins a 40-hex commit has every lock entry at that commit;
//   - no skill name is owned by two collections (lib.ownership);
//   - first-party skills (collections with `local: true`) are only validated for frontmatter: the
//     name matches the folder and the description is not empty. They are not in the lock.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  DOCS_PATH,
  filesAt,
  findSymlinks,
  hashFile,
  hashSkillDir,
  isExtraPath,
  lockEntriesFor,
  ownership,
  parseFrontmatter,
  parseSource,
  pinnedCommit,
  ROOT,
  readLock,
  readManifest,
  SKILLS_DIR,
} from "./lib.mjs";

const write = process.argv.includes("--write");
const manifest = readManifest();
const lock = readLock();
const errors = [];
const error = (message) => errors.push(message);

const dirs = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR)
      .filter((name) => lstatSync(join(SKILLS_DIR, name)).isDirectory())
      .sort()
  : [];

if (existsSync(SKILLS_DIR)) {
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (
      !entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      entry.name !== ".DS_Store"
    )
      error(
        `.agents/skills/${entry.name}: a file where only skill folders belong`,
      );
  }
}

for (const link of findSymlinks(join(ROOT, ".agents"))) {
  error(`.agents/${link}: symlinks are not allowed, copy the files instead`);
}

const { owners: collectionOf, duplicates } = ownership(manifest, lock);

const skills = [];
const seenNames = new Map();
for (const dir of dirs) {
  const skillFile = join(SKILLS_DIR, dir, "SKILL.md");
  if (!existsSync(skillFile)) {
    error(`${dir}: no SKILL.md`);
    continue;
  }
  const fields = parseFrontmatter(readFileSync(skillFile, "utf8"));
  if (!fields) {
    error(`${dir}: SKILL.md has no frontmatter`);
    continue;
  }
  const { name, description } = fields;
  if (!name) error(`${dir}: frontmatter name is empty`);
  if (!description) error(`${dir}: frontmatter description is empty`);
  if (name && name !== dir)
    error(`${dir}: frontmatter name "${name}" differs from the directory name`);
  if (name) {
    if (seenNames.has(name))
      error(`${dir}: name "${name}" duplicates ${seenNames.get(name)}`);
    seenNames.set(name, dir);
  }
  if (collectionOf.get(dir)?.local) {
    if (lock.skills[dir])
      error(`${dir}: first-party skill must not be in skills-lock.json`);
  } else if (!lock.skills[dir]) {
    error(`${dir}: not in skills-lock.json`);
  }
  skills.push({ dir, name: name || dir, description: description || "" });
}
for (const [name, entry] of Object.entries(lock.skills)) {
  if (!dirs.includes(name)) {
    error(`${name}: in skills-lock.json but missing on disk`);
    continue;
  }
  if (entry.installMode !== undefined && entry.installMode !== "copy")
    error(
      `${name}: skills-lock.json records installMode "${entry.installMode}", expected "copy"`,
    );
  const skillDir = join(SKILLS_DIR, name);
  for (const file of filesAt(SKILLS_DIR, name))
    if (file.endsWith("/metadata.json"))
      error(
        `.agents/skills/${file}: metadata.json is not part of a vendored skill (the installer never copies one). Remove it`,
      );
  let actual = null;
  try {
    actual = hashSkillDir(skillDir);
  } catch (e) {
    error(`${name}: cannot hash the skill folder (${e.message})`);
  }
  if (actual && actual !== entry.computedHash)
    error(
      `${name}: content differs from computedHash in skills-lock.json (a vendored file was edited or is missing). Restore it, or run: pnpm skills:sync`,
    );
  const skillFile = join(skillDir, "SKILL.md");
  const stripped = entry.strippedFrontmatter ?? [];
  if (existsSync(skillFile) && stripped.length) {
    const fields = parseFrontmatter(readFileSync(skillFile, "utf8")) ?? {};
    for (const key of stripped)
      if (key in fields)
        error(`${name}: frontmatter key "${key}" should have been stripped`);
  }
}

for (const duplicate of duplicates)
  error(`skill name owned by two collections: ${duplicate}`);
for (const collection of manifest) {
  const owned = lockEntriesFor(lock, collection).map(([name]) => name);
  const pinned = pinnedCommit(collection);
  if (pinned) {
    for (const name of owned)
      if (lock.skills[name].commit !== pinned)
        error(
          `${name}: sources.json pins ${collection.id} to ${pinned} but skills-lock.json has ${lock.skills[name].commit}. Run: pnpm skills:sync ${collection.id}`,
        );
  }
  const wanted = [...(collection.stripFrontmatter ?? [])].sort().join(",");
  for (const name of owned) {
    const recorded = [...(lock.skills[name].strippedFrontmatter ?? [])]
      .sort()
      .join(",");
    if (recorded !== wanted)
      error(
        `${name}: stripFrontmatter in sources.json ("${wanted}") differs from the lock ("${recorded}"). Run: pnpm skills:sync ${collection.id}`,
      );
  }
  if (Array.isArray(collection.skills)) {
    for (const name of collection.skills) {
      if (!dirs.includes(name))
        error(`${collection.id}: manifest skill "${name}" is missing on disk`);
    }
  } else if (owned.length === 0) {
    error(
      `${collection.id}: manifest asks for every skill but none are installed`,
    );
  }
  const licensePath = join(ROOT, "licenses", `${collection.id}.txt`);
  if (!existsSync(licensePath) || statSync(licensePath).size === 0)
    error(
      `${collection.id}: licenses/${collection.id}.txt is missing or empty`,
    );
  if (!collection.local && existsSync(licensePath)) {
    const recorded = lock.licenses?.[collection.id];
    if (!recorded)
      error(
        `licenses/${collection.id}.txt: no hash in skills-lock.json. Run: pnpm skills:sync ${collection.id}`,
      );
    else if (hashFile(licensePath) !== recorded)
      error(
        `licenses/${collection.id}.txt: content differs from the hash in skills-lock.json (edited by hand?). Restore it, or run: pnpm skills:sync ${collection.id}`,
      );
  }
  for (const extra of collection.extras ?? []) {
    if (filesAt(ROOT, extra.to).length === 0)
      error(`${collection.id}: extra ${extra.to} is missing`);
  }
}

// Extras: every file is in the lock with the right hash, and nothing else is under .agents/
// outside .agents/skills/ (stray files inside skill folders fail that skill's hash).
const extraHashes = lock.extras ?? {};
const extraRoots = manifest.flatMap((c) => (c.extras ?? []).map((e) => e.to));
for (const path of filesAt(ROOT, ".agents")) {
  if (path.startsWith(".agents/skills/") || isExtraPath(manifest, path))
    continue;
  if (!(path in extraHashes))
    error(
      `${path}: not owned by any collection (stray file). Remove it, or declare it as an extra in sources.json and run: pnpm skills:sync`,
    );
}
for (const [path, recorded] of Object.entries(extraHashes)) {
  const full = join(ROOT, path);
  if (!isExtraPath(manifest, path))
    error(`${path}: in skills-lock.json extras but no collection declares it`);
  else if (!existsSync(full))
    error(`${path}: in skills-lock.json extras but missing on disk`);
  else if (hashFile(full) !== recorded)
    error(
      `${path}: content differs from the hash in skills-lock.json (edited by hand?). Restore it, or run: pnpm skills:sync`,
    );
}
for (const path of extraRoots.flatMap((to) => filesAt(ROOT, to))) {
  if (!(path in extraHashes))
    error(
      `${path}: extra file has no hash in skills-lock.json. Run: pnpm skills:sync`,
    );
}
const licenseIds = new Set(manifest.map((c) => c.id));
const licenseFiles = existsSync(join(ROOT, "licenses"))
  ? readdirSync(join(ROOT, "licenses"))
  : [];
for (const file of licenseFiles) {
  if (file === ".DS_Store") continue;
  if (!file.endsWith(".txt") || !licenseIds.has(file.slice(0, -4)))
    error(`licenses/${file}: belongs to no manifest collection`);
}
const nonLocalIds = new Set(manifest.filter((c) => !c.local).map((c) => c.id));
for (const id of Object.keys(lock.licenses ?? {})) {
  if (!nonLocalIds.has(id))
    error(
      `${id}: in skills-lock.json licenses but no such non-first-party collection`,
    );
}
for (const { dir } of skills) {
  if (!collectionOf.has(dir))
    error(`${dir}: belongs to no manifest collection`);
}

function oneLine(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  const short =
    sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence;
  return short.replace(/\|/g, "\\|");
}

function renderDocs() {
  const lines = [
    "# Skills",
    "",
    "Generated by `node scripts/skills/check.mjs --write` from `scripts/skills/sources.json` and `skills-lock.json`. Do not edit by hand.",
    "",
    "Repo skills live in `.agents/skills/<name>/SKILL.md`, which Capy reads. Pick one with `$` followed by the name. Install or refresh them with `pnpm skills:sync`, and validate with `pnpm skills:check`.",
    "",
    "## Collections",
    "",
    "| Collection | Id | Upstream | License | Skills |",
    "| --- | --- | --- | --- | --- |",
  ];
  const countOf = (c) =>
    skills.filter((s) => collectionOf.get(s.dir) === c).length;
  for (const c of manifest) {
    const upstream = c.local
      ? "this repo"
      : `[${parseSource(c.upstream).owner}/${parseSource(c.upstream).repo}](${c.upstream})`;
    lines.push(
      `| ${c.title} | \`${c.id}\` | ${upstream} | ${c.license.spdx} (\`licenses/${c.id}.txt\`) | ${countOf(c)} |`,
    );
  }
  lines.push(
    "",
    "## Skills",
    "",
    "| Invoke | Collection | What it does |",
    "| --- | --- | --- |",
  );
  const order = new Map(manifest.map((c, i) => [c.id, i]));
  const sorted = [...skills].sort((a, b) => {
    const ca = collectionOf.get(a.dir);
    const cb = collectionOf.get(b.dir);
    return order.get(ca?.id) - order.get(cb?.id) || a.dir.localeCompare(b.dir);
  });
  for (const s of sorted) {
    lines.push(
      `| \`$${s.name}\` | ${collectionOf.get(s.dir)?.id ?? ""} | ${oneLine(s.description)} |`,
    );
  }
  lines.push("", "## Limitations", "");
  for (const c of manifest) {
    lines.push(`### ${c.title}`, "");
    const extras = c.extras ?? [];
    if (extras.length) {
      lines.push("Extra files copied alongside the skills:", "");
      for (const e of extras) lines.push(`- \`${e.from}\` to \`${e.to}\``);
      lines.push("");
    }
    if (c.notes?.length)
      lines.push("Selection:", "", ...c.notes.map((n) => `- ${n}`), "");
    lines.push("Limitations:", "");
    if (c.limitations.length === 0) lines.push("None recorded.", "");
    else lines.push(...c.limitations.map((l) => `- ${l}`), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const rendered = renderDocs();
if (write) {
  mkdirSync(dirname(DOCS_PATH), { recursive: true });
  writeFileSync(DOCS_PATH, rendered);
} else if (
  !existsSync(DOCS_PATH) ||
  readFileSync(DOCS_PATH, "utf8") !== rendered
) {
  error(
    "docs/skills.md is stale or missing, run: node scripts/skills/check.mjs --write",
  );
}

if (errors.length) {
  console.error(errors.map((e) => `check: ${e}`).join("\n"));
  process.exit(1);
}
console.log(
  `check: ok, ${skills.length} skills in ${manifest.length} collections`,
);
