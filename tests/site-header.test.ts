import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SiteHeader } from "../src/components/directory/site-header";

const auth = vi.hoisted(() => ({ state: "signed-out" }));

vi.mock("@clerk/nextjs", () => ({
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    auth.state === when ? children : null,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => createElement("button", { type: "button" }, "Mi cuenta"),
}));
vi.mock("../src/components/toggle-theme", () => ({ ThemeToggle: () => null }));
vi.mock("../src/components/directory/mobile-menu", () => ({
  MobileMenu: () => createElement("button", { type: "button" }, "Abrir menú"),
}));

it.each(["signed-out", "signed-in", "loading"])(
  "keeps landing account controls available without the mobile menu (%s)",
  (state) => {
    auth.state = state;
    const html = renderToStaticMarkup(
      createElement(SiteHeader, { nav: false, themeToggle: false }),
    );
    const mobile = html.match(/<div class="sm:hidden">(.*?)<\/div>/)?.[1];
    expect(mobile).toBeDefined();
    expect(mobile?.includes("Iniciar sesión")).toBe(state === "signed-out");
    expect(mobile?.includes("Mi cuenta")).toBe(state === "signed-in");
    expect(html).not.toContain("Abrir menú");
  },
);

it("keeps mobile sign-in in the menu when navigation is enabled", () => {
  auth.state = "signed-out";
  const html = renderToStaticMarkup(createElement(SiteHeader));
  expect(html).toContain("Abrir menú");
  expect(html).toContain('href="/agents"');
  expect(html).toContain("Mis agentes");
  expect(html).toContain('href="/friends"');
  expect(html).toContain('<div class="sm:hidden"></div>');
});
