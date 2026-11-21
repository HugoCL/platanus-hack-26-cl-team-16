/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { SEED_AGENTS } from "../shared/seed-data";
import DirectoryList from "../src/components/directory/directory-list";

const modules = import.meta.glob("../convex/**/*.ts");

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
  expect(html).toContain("Clínica Providencia Salud");
  expect(html).toContain("Providencia · Hospedado");
  expect(html).toContain("Sin reclamar · pre-armado");
  expect(html).toContain('href="/directory/cafe-los-dominicos"');
});
