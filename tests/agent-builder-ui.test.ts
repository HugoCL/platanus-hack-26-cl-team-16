import { ConvexError } from "convex/values";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  AgentBuilderAccess,
  builderError,
} from "../src/components/agent-builder-access";
import { AgentBuilderList } from "../src/components/agent-builder-list";
import { AgentBuilderNew } from "../src/components/agent-builder-new";

const state = vi.hoisted(() => ({
  loaded: true,
  signedIn: false,
  authenticated: false,
  agents: [] as unknown[],
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: state.loaded, isSignedIn: state.signedIn }),
  SignInButton: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isLoading: false,
    isAuthenticated: state.authenticated,
  }),
  useQuery: () => state.agents,
  useMutation: () => vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeEach(() => {
  Object.assign(state, {
    loaded: true,
    signedIn: false,
    authenticated: false,
    agents: [],
  });
});

it("explains agents and asks signed-out people to sign in, without showing private forms", () => {
  for (const page of [AgentBuilderList, AgentBuilderNew]) {
    const html = renderToStaticMarkup(createElement(page));
    expect(html).toContain("Un ayudante que responde por ti");
    expect(html).toContain("Iniciar sesión");
    expect(html).not.toContain("Crear y continuar");
    expect(html).not.toContain("system prompt");
  }
});
it("handles a connecting or unverifiable account without rendering private content", () => {
  state.loaded = false;
  expect(
    renderToStaticMarkup(createElement(AgentBuilderAccess, null, "private")),
  ).toContain("Cargando tu cuenta");
  Object.assign(state, { loaded: true, signedIn: true });
  const html = renderToStaticMarkup(
    createElement(AgentBuilderAccess, null, "private"),
  );
  expect(html).toContain("No pudimos verificar tu cuenta");
  expect(html).not.toContain("private");
});
it("offers a clear first-agent action and labeled creation fields to authenticated people", () => {
  Object.assign(state, { signedIn: true, authenticated: true });
  const list = renderToStaticMarkup(createElement(AgentBuilderList));
  expect(list).toContain("Crear mi primer agente");
  expect(list).toContain('href="/agents/new"');
  const form = renderToStaticMarkup(createElement(AgentBuilderNew));
  expect(form).toContain("Nombre de tu agente");
  expect(form).toContain("¿Qué hace tu agente?");
  expect(form).toContain("Crear y continuar");
});
it("keeps errors friendly and Spanish", () => {
  expect(
    builderError(
      new ConvexError({
        kind: "InvalidArgument",
        message: "Agrega una fuente lista o instrucciones antes de publicar.",
      }),
    ),
  ).toContain("Agrega una fuente");
  expect(
    builderError(
      new ConvexError({ kind: "RateLimited", message: "Rate limit exceeded" }),
    ),
  ).toContain("Espera un momento");
  expect(builderError(new Error("Network error"))).toContain("No pudimos");
  expect(
    builderError(new ConvexError({ message: "Unauthorized" })),
  ).not.toContain("Unauthorized");
});
