import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const SKILLS_DIR = join(ROOT, ".agents", "skills");
export const LOCK_PATH = join(ROOT, "skills-lock.json");
export const MANIFEST_PATH = join(ROOT, "scripts", "skills", "sources.json");
export const DOCS_PATH = join(ROOT, "docs", "skills.md");

export function readManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const ids = new Set();
  for (const c of manifest) {
    if (ids.has(c.id))
      throw new Error(`sources.json: duplicate collection id "${c.id}"`);
    ids.add(c.id);
    if (c.local && !Array.isArray(c.skills)) {
      throw new Error(
        `sources.json: local collection "${c.id}" needs an explicit skills list`,
      );
    }
  }
  return manifest;
}

export function readLock() {
  if (!existsSync(LOCK_PATH)) return { version: 2, skills: {} };
  return JSON.parse(readFileSync(LOCK_PATH, "utf8"));
}

const SOURCE_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/;

export function parseSource(source) {
  const m = SOURCE_RE.exec(source);
  if (!m) throw new Error(`unsupported source URL: ${source}`);
  const [, owner, repo, ref, subpath] = m;
  return { owner, repo, ref: ref ?? null, subpath: subpath ?? null };
}

export function repoSlug(url) {
  const { owner, repo } = parseSource(url);
  return `${owner}/${repo}`.toLowerCase();
}

// The CLI records the canonical repo name, which can differ from the manifest URL after a
// GitHub rename, so an explicit skill list also matches by name.
export function lockEntriesFor(lock, collection) {
  if (collection.local) return [];
  const slug = repoSlug(collection.upstream);
  // Several collections can come from one repo (pstack and cursor-team-kit are both
  // cursor/plugins), so a "*" collection only owns the entries under its own subpath.
  const { subpath } = parseSource(collection.source);
  return Object.entries(lock.skills).filter(([name, entry]) =>
    Array.isArray(collection.skills)
      ? collection.skills.includes(name)
      : entry.source.toLowerCase() === slug &&
        (!subpath || entry.skillPath?.startsWith(`${subpath}/`)),
  );
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function blockScalar(indicator, lines) {
  const literal = indicator.startsWith("|");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const indent = nonEmpty.length
    ? Math.min(...nonEmpty.map((l) => l.match(/^ */)[0].length))
    : 0;
  const body = lines.map((l) => l.slice(indent));
  if (literal) return body.join("\n").trim();
  const paragraphs = [];
  let current = [];
  for (const line of body) {
    if (line.trim() === "") {
      if (current.length) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n").trim();
}

export function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fields = {};
  let i = 0;
  while (i < lines.length) {
    const key = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!key) {
      i += 1;
      continue;
    }
    const [, name, rest] = key;
    const body = [];
    i += 1;
    while (
      i < lines.length &&
      (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))
    ) {
      body.push(lines[i]);
      i += 1;
    }
    while (body.length && body[body.length - 1].trim() === "") body.pop();
    if (/^[>|][+-]?\d*$/.test(rest.trim())) {
      fields[name] = blockScalar(rest.trim(), body);
    } else if (body.length === 0) {
      fields[name] = unquote(rest);
    } else {
      fields[name] = unquote(
        [rest, ...body.map((l) => l.trim())].join(" ").trim(),
      );
    }
  }
  return fields;
}

// Names of the skills a collection owns: its explicit list plus the lock entries that match its
// upstream. Local collections own only their explicit list.
export function ownedNames(collection, lock) {
  const names = new Set(lockEntriesFor(lock, collection).map(([name]) => name));
  if (Array.isArray(collection.skills))
    for (const name of collection.skills) names.add(name);
  return names;
}

// True when `path` (relative to the repo root) is, or is below, an extra declared by a collection.
export function isExtraPath(manifest, path) {
  return manifest.some((c) =>
    (c.extras ?? []).some((e) => path === e.to || path.startsWith(`${e.to}/`)),
  );
}

// The commit pinned in a collection's `source` (`.../tree/<40-hex sha>/...`), or null for a branch
// or tag. A pinned commit is the source of truth: sync installs it and check compares the lock.
export function pinnedCommit(collection) {
  if (collection.local) return null;
  const { ref } = parseSource(collection.source);
  return ref && /^[0-9a-f]{40}$/.test(ref) ? ref : null;
}

// skill name -> collection, for every collection in the manifest.
export function ownership(manifest, lock) {
  const owners = new Map();
  const duplicates = [];
  for (const collection of manifest) {
    for (const name of ownedNames(collection, lock)) {
      const previous = owners.get(name);
      if (previous && previous.id !== collection.id)
        duplicates.push(`${name}: ${previous.id} and ${collection.id}`);
      else owners.set(name, collection);
    }
  }
  return { owners, duplicates };
}

// --- content hash -------------------------------------------------------------------------
// Same algorithm as the skills CLI v1.9.0 pinned in package.json (src/skill-hash.ts), which records it as
// `computedHash` in skills-lock.json: files sorted by the UTF-8 bytes of their relative path,
// each framed as `path NUL length NUL content`, CRLF turned into LF in files with no NUL byte.
// Skipped like the installer does: files named metadata.json (check.mjs rejects those in vendored
// folders) and directories .git, __pycache__ and __pypackages__; also macOS's .DS_Store. Those
// are the only files and folders a hand edit can change without failing the hash. Symlinks are
// never followed: check.mjs rejects them, and here they throw.
const EXCLUDE_FILES = new Set(["metadata.json", ".DS_Store"]);
const EXCLUDE_DIRS = new Set([".git", "__pycache__", "__pypackages__"]);

function collectFiles(dir, prefix, results) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink at ${full}`);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collectFiles(full, `${prefix}${entry.name}/`, results);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      results.push({
        path: `${prefix}${entry.name}`,
        content: readFileSync(full),
      });
    }
  }
}

function normalizeLineEndings(content) {
  if (content.includes(0) || !content.includes("\r\n")) return content;
  return Buffer.from(
    content.toString("latin1").replaceAll("\r\n", "\n"),
    "latin1",
  );
}

export function hashSkillDir(dir) {
  const files = [];
  collectFiles(dir, "", files);
  const entries = files
    .map((f) => ({
      path: Buffer.from(f.path, "utf8"),
      content: normalizeLineEndings(f.content),
    }))
    .sort((a, b) => Buffer.compare(a.path, b.path));
  const hash = createHash("sha256");
  for (const { path, content } of entries) {
    hash.update(path);
    hash.update("\0");
    hash.update(String(content.length));
    hash.update("\0");
    hash.update(content);
  }
  return hash.digest("hex");
}

// sha256 of one file, with CRLF turned into LF like hashSkillDir does for skill files. Used for
// the extras and licenses recorded in skills-lock.json.
export function hashFile(path) {
  return createHash("sha256")
    .update(normalizeLineEndings(readFileSync(path)))
    .digest("hex");
}

// Every file at or below `rel` (a path relative to `base`), as posix paths relative to `base`,
// sorted. Symlinks are skipped (check.mjs reports them) and so is macOS's .DS_Store.
export function filesAt(base, rel) {
  const abs = join(base, rel);
  const stat = lstatSync(abs, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink()) return [];
  if (stat.isFile()) return rel.endsWith(".DS_Store") ? [] : [rel];
  if (!stat.isDirectory()) return [];
  return readdirSync(abs)
    .sort()
    .flatMap((name) => filesAt(base, `${rel}/${name}`));
}

// Every symlink below `dir`, as paths relative to it (lstat, so links are never followed).
export function findSymlinks(dir, prefix = "") {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (lstatSync(join(dir, entry.name)).isSymbolicLink()) found.push(rel);
    else if (entry.isDirectory())
      found.push(...findSymlinks(join(dir, entry.name), `${rel}/`));
  }
  return found;
}

// Removes the given top-level frontmatter keys (and their indented continuation lines) from a
// SKILL.md text. Returns the text unchanged when there is no frontmatter.
export function stripFrontmatterKeys(text, keys) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return text;
  const lines = m[1].split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const key = /^([A-Za-z0-9_-]+):/.exec(lines[i]);
    if (!key || !keys.includes(key[1])) {
      kept.push(lines[i]);
      continue;
    }
    // drop the key line, then continuation lines: indented, or blank followed by indented
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      const following = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (
        /^[ \t]/.test(next) ||
        (next.trim() === "" &&
          following !== undefined &&
          /^[ \t]/.test(following))
      )
        i += 1;
      else break;
    }
  }
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const eol = m[0].includes("\r\n") ? "\r\n" : "\n";
  const head = `---${eol}${kept.join(eol)}${eol}---`;
  // Keep the newline that closed the original block, whatever it was (\r\n or \n).
  const closing = /\r?\n$/.exec(m[0])?.[0].length ?? 0;
  return head + text.slice(m[0].length - closing);
}
