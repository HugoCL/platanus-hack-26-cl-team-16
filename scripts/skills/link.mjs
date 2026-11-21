#!/usr/bin/env node
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const remove = process.argv.includes("--remove");
const claude = join(root, ".claude");
const destination = join(claude, "skills");
const source = join(root, ".agents", "skills");
const targetFor = (name) => `../../.agents/skills/${name}`;

for (const directory of [claude, destination]) {
  const entry = lstatSync(directory, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory()) {
    throw new Error(`Expected a real directory at ${directory}`);
  }
  if (!entry) {
    if (remove) process.exit(0);
    mkdirSync(directory);
  }
}

const names = new Set(
  remove
    ? []
    : readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
);

for (const entry of readdirSync(destination, { withFileTypes: true })) {
  const path = join(destination, entry.name);
  const owned =
    entry.isSymbolicLink() && readlinkSync(path) === targetFor(entry.name);
  if (owned && !names.has(entry.name)) unlinkSync(path);
  if (names.delete(entry.name) && !owned) {
    console.warn(`Keeping existing ${path}`);
  }
}

for (const name of names) {
  symlinkSync(targetFor(name), join(destination, name), "dir");
}
