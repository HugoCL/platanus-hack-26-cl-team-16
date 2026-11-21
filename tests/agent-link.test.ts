import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentLink } from "../src/components/agent-link";

const state = vi.hoisted(() => ({
  signedIn: false,
  info: undefined as unknown,
  roomResults: [] as {
    sessionId: string;
    description: string;
    status: string;
  }[],
  roomStatus: "Exhausted",
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: state.signedIn }),
  SignInButton: ({ children }: { children: unknown }) => children,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: state.signedIn }),
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "directory:categories"
      ? [{ slug: "medicina_general", label: "Medicina general" }]
      : state.info,
  useMutation: () => vi.fn(),
  usePaginatedQuery: () => ({
    results: state.roomResults,
    status: state.roomStatus,
    loadMore: vi.fn(),
  }),
}));
beforeEach(() => {
  state.signedIn = false;
  state.info = undefined;
  state.roomResults = [];
  state.roomStatus = "Exhausted";
});
const render = () =>
  renderToStaticMarkup(createElement(AgentLink, { code: "test-code" }));

it("shows a loading state and an invalid-link message", () => {
  expect(render()).toContain("Cargando agente");
  state.info = null;
  expect(render()).toContain("Link inválido o vencido");
});

it("shows the agent and sign-in action without publishing controls when signed out", () => {
  state.info = {
    agentId: "agent",
    name: "Grok Bot",
    description: "Asistente privado",
    slug: "grok-bot",
    status: "draft",
    linkedToCurrentUser: false,
  };
  const html = render();
  expect(html).toContain("Grok Bot");
  expect(html).toContain("Asistente privado");
  expect(html).toContain("Iniciar sesión");
  expect(html).not.toContain("Vincular a mi cuenta");
  expect(html).not.toContain("Publicar agente");
  expect(html).not.toContain("Salas de tu agente");
});

it("offers linking to a signed-in account", () => {
  state.signedIn = true;
  state.info = {
    agentId: "agent",
    name: "Grok Bot",
    description: "Asistente",
    status: "draft",
    linkedToCurrentUser: false,
  };
  expect(render()).toContain(">Vincular</button>");
  expect(render()).not.toContain("Vincular y publicar");
});

it.each([false, true])(
  "prefills editable publication data with wantsPublic=%s",
  (linked) => {
    state.signedIn = true;
    state.info = {
      agentId: "agent",
      name: "Servicio",
      description: "Descripción preparada",
      purpose: "Propósito preparado",
      category: "medicina_general",
      wantsPublic: true,
      status: "draft",
      linkedToCurrentUser: linked,
    };
    const html = render();
    expect(html).toContain(">Propósito preparado</textarea>");
    expect(html).toContain(">Descripción preparada</textarea>");
    expect(html).toContain('value="medicina_general"');
    expect(html).toContain(linked ? "Publicar agente" : "Vincular y publicar");
    expect(html.includes("Solo vincular")).toBe(!linked);
  },
);

it("offers the directory link and unpublish only for the linked owner", () => {
  state.signedIn = true;
  state.info = {
    agentId: "agent",
    name: "Grok Bot",
    description: "Asistente",
    slug: "grok-bot",
    status: "active",
    linkedToCurrentUser: true,
  };
  const html = render();
  expect(html).toContain("Publicado");
  expect(html).toContain('href="/directory/grok-bot"');
  expect(html).toContain("Dejar de publicar");
  expect(html).toContain("Tu agente todavía no ha abierto salas.");
});

it("shows room links, open/closed status and pagination to the linked owner", () => {
  state.signedIn = true;
  state.info = {
    agentId: "agent",
    name: "Servicio",
    description: "Información",
    slug: "service",
    status: "active",
    linkedToCurrentUser: true,
  };
  state.roomResults = [
    { sessionId: "new", description: "Consulta reciente", status: "closed" },
    { sessionId: "old", description: "Consulta anterior", status: "active" },
  ];
  state.roomStatus = "CanLoadMore";
  const html = render();
  expect(html).toContain('href="/room/new"');
  expect(html).toContain('href="/room/old"');
  expect(html).toContain("Abierta");
  expect(html).toContain("Cerrada");
  expect(html.indexOf("Consulta reciente")).toBeLessThan(
    html.indexOf("Consulta anterior"),
  );
  expect(html).toContain("Ver más salas");
  state.roomStatus = "LoadingFirstPage";
  expect(render()).toContain("Cargando salas…");
});
