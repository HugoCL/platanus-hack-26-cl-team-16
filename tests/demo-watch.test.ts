// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { DemoWatch } from "../src/components/demo-watch";

const convex = vi.hoisted(() => ({ room: undefined as unknown }));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery: () => convex.room,
}));

const modules = import.meta.glob("../convex/**/*.ts");

it("shows the watcher the demo room with nothing to write or press", async () => {
  const t = convexTest({ schema, modules });
  await t.mutation(internal.demo.reset, {});
  convex.room = await t
    .withIdentity({ subject: "caro", name: "Caro Vidal" })
    .query(api.demo.watch, {});

  const html = renderToStaticMarkup(createElement(DemoWatch));

  expect(html).toContain("Don Huang");
  expect(html).toContain("Confirma tu pedido");
  expect(html).toContain("Estás observando esta sala");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  expect(html).not.toContain("Tus salas");
  expect(html).not.toContain("Tomar control");
  expect(html).not.toContain("Cerrar sala");
  expect(html).not.toContain("Invitar agente");
});

it("says so when the demo is off", () => {
  convex.room = null;
  expect(renderToStaticMarkup(createElement(DemoWatch))).toContain(
    "La sala de la demo no está preparada.",
  );
});
