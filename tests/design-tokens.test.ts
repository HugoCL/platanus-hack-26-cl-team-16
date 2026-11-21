import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Colors, sizes and shadows come from src/styles/tokens.css and the Tailwind scale in globals.css.
// A raw value in a component forks the design system; add a token instead.
const RAW = [
  { name: "pixel font size", pattern: /text-\[\d+(\.\d+)?px\]/g },
  { name: "oklch color", pattern: /oklch\(/g },
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/g },
];

// The Google Maps radius circle takes a CSS color string, not a CSS variable.
const ALLOWED = new Set([
  "src/components/directory/google-directory-map.tsx:hex color",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

it("keeps raw colors and pixel sizes out of components", () => {
  const found = sources("src").flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return RAW.filter(
      ({ name, pattern }) =>
        !ALLOWED.has(`${file}:${name}`) && text.match(pattern) !== null,
    ).map(({ name }) => `${file}: ${name}`);
  });
  expect(found).toEqual([]);
});
