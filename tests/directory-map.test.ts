/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { DirectoryMap } from "../src/components/directory/directory-map";

const viewport = vi.hoisted(() => ({ width: 640, height: 200 }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      react.useState(
        typeof initial === "object" && initial !== null && "width" in initial
          ? viewport
          : initial,
      ),
  };
});

const modules = import.meta.glob("../convex/**/*.ts");

it.each([200, 480])(
  "bounds the popup in a %spx-tall map outside the touch-none drag surface",
  async (height) => {
    viewport.height = height;
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.ensure, {});
    const { agents } = await t.query(api.directory.search, {});
    const selected = agents.find((card) => card.location);
    if (!selected) throw new Error("Missing located card");
    const html = renderToStaticMarkup(
      createElement(DirectoryMap, {
        cards: agents,
        categories: [],
        selectedId: selected.agentId,
        onSelect: () => {},
        origin: null,
        radiusKm: null,
      }),
    );
    const popup = html.match(
      /<div class="[^"]*origin-left[^"]*" style="[^"]*top:([\d.]+)px;max-height:([\d.]+)px"/,
    );
    expect(popup).not.toBeNull();
    const top = Number(popup?.[1]);
    const maxHeight = Number(popup?.[2]);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(maxHeight).toBeGreaterThan(0);
    expect(top + maxHeight).toBe(height - 16);
    expect(popup?.[0]).toContain(
      "overflow-y-auto overscroll-contain [&amp;&gt;*]:shrink-0",
    );
    expect(html).toContain(`</div>${popup?.[0]}`);
    expect(html).toContain(`href="/directory/${selected.slug}"`);
  },
);

it("has no popup for an empty map", () => {
  const html = renderToStaticMarkup(
    createElement(DirectoryMap, {
      cards: [],
      categories: [],
      selectedId: null,
      onSelect: () => {},
      origin: null,
      radiusKm: null,
    }),
  );
  expect(html).not.toContain("origin-left");
  expect(html).not.toContain("Ver ficha");
});
