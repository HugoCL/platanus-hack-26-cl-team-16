/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { SEED_AGENTS } from "../shared/seed-data";
import DirectoryList from "../src/components/directory/directory-list";
import {
  type LocatedCard,
  PinButton,
  SelectedCard,
} from "../src/components/directory/map-parts";

const modules = import.meta.glob("../convex/**/*.ts");

it("puts schematic pin stacking on the button and preserves popup classes", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.ensure, {});
  const { agents } = await t.query(api.directory.search, {});
  const categories = await t.query(api.directory.categories, {});
  const pin = agents.filter((card): card is LocatedCard => !!card.location);
  expect(pin.length).toBeGreaterThan(1);
  const selected = pin[0];
  for (const selectedId of [selected.agentId, null, "missing-agent"]) {
    const html = renderToStaticMarkup(
      createElement(PinButton, {
        pin,
        selectedId,
        categories,
        onSelect: () => {},
        className: "!absolute -translate-x-1/2 -translate-y-full",
      }),
    );
    expect(html).toMatch(
      selectedId === selected.agentId
        ? /^<button[^>]*class="z-20 /
        : /^<button[^>]*class="z-10 /,
    );
    expect(html).toContain("!absolute -translate-x-1/2 -translate-y-full");
  }
  const html = renderToStaticMarkup(
    createElement(SelectedCard, {
      pin,
      selected,
      onSelect: () => {},
      className: "pointer-events-auto",
    }),
  );
  expect(html).toMatch(/^<div class="[^"]*pointer-events-auto"/);
  expect(html).toContain(`href="/directory/${selected.slug}"`);
  expect(html).toContain("También en esta dirección");
});

it("5. the web view shows every seed card", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.ensure, {});
  const { agents: cards } = await t.query(api.directory.search, {});
  const categories = await t.query(api.directory.categories, {});

  const html = renderToStaticMarkup(
    createElement(DirectoryList, { cards, categories }),
  );

  expect(html.match(/data-testid="agent-card"/g)).toHaveLength(
    SEED_AGENTS.length,
  );
  for (const { card } of SEED_AGENTS) {
    expect(html).toContain(`data-slug="${card.slug}"`);
    expect(html).toContain(
      renderToStaticMarkup(createElement(Fragment, null, card.purpose)),
    );
  }
  expect(html).toContain('aria-label="Verificada"');
  expect(html).toContain("Providencia · Hospedado");
  expect(html).toContain("Sin reclamar · pre-armado");
  expect(html).toContain('href="/directory/cafe-los-dominicos"');
});
