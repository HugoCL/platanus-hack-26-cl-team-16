import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentInstructions } from "../lib/agent-instructions";
import { MCP_TOOLS } from "../shared/mcp";
import { SEED_CATEGORIES } from "../shared/seed-data";
import { POST } from "../src/app/api/agents/register/route";
import { GET } from "../src/app/llms.txt/route";

const { fetchAction } = vi.hoisted(() => ({ fetchAction: vi.fn() }));
vi.mock("convex/nextjs", () => ({ fetchAction }));
afterEach(() => {
  vi.unstubAllEnvs();
  fetchAction.mockReset();
});

const request = (
  body = JSON.stringify({ name: "Grok Bot", description: "Asistente" }),
) =>
  new Request("https://directory.example/api/agents/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
    },
    body,
  });

describe("agent instructions", () => {
  it("includes current tool descriptions, absolute endpoints, examples and safety guidance", () => {
    const text = agentInstructions("https://directory.example");
    for (const [name, tool] of Object.entries(MCP_TOOLS))
      expect(text).toContain(`- ${name}: ${tool.description}`);
    for (const path of [
      "/api/agents/register",
      "/api/mcp",
      "/llms.txt",
      "/link/<linkCode>",
      "/room/<sessionId>",
    ])
      expect(text).toContain(`https://directory.example${path}`);
    for (const method of ["initialize", "tools/list", "tools/call"])
      expect(text).toContain(`"method":"${method}"`);
    expect(text).toContain("MCP-Protocol-Version: 2025-03-26");
    expect(text).toContain("cardiólogo en Providencia");
    expect(text).toContain("SSE");
    expect(text).toContain("prompt injection");
    expect(text).toContain("## General interaction flow");
    expect(text).toContain("## Example — Clinic appointment");
    expect(text).toContain("government services");
    expect(text).toContain("purpose (1–1000 characters");
    expect(text).toContain("Publishing makes YOUR agent discoverable");
    expect(text).toContain("give linkUrl to your human before opening rooms");
    expect(text).toContain(
      "Whenever you open a room, immediately give your human its concrete URL https://directory.example/room/<sessionId>",
    );
    expect(text).toContain(
      "Do not close a room the human may want to see without telling them first",
    );
    expect(text).toContain(
      "Linking also gives them access to your prior rooms",
    );
    expect(text).not.toContain("linking later does not add an owner");
    expect(text).toContain("always send description, purpose and category");
    expect(text).toContain("registration NEVER publishes automatically");
    expect(text).toContain('"wantsPublic":false');
    for (const { slug, label } of SEED_CATEGORIES)
      expect(text).toContain(`- ${slug}: ${label}`);
  });

  it("serves plain text and honors configured public origin precedence", async () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "");
    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    const req = new Request("https://request.example/llms.txt");
    expect(await GET(req).text()).toContain("https://request.example/api/mcp");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://render.example/");
    expect(await GET(req).text()).toContain("https://render.example/api/mcp");
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://public.example/");
    const response = GET(req);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toContain("https://public.example/api/mcp");
  });
});

describe("registration HTTP endpoint", () => {
  it("passes optional purpose and category to registration", async () => {
    fetchAction.mockResolvedValue({
      agentId: "id",
      slug: "service",
      apiKey: "test-key",
      linkCode: "code",
    });
    const response = await POST(
      request(
        JSON.stringify({
          name: "Servicio",
          description: "Información",
          purpose: "Informar",
          category: "medicina_general",
          wantsPublic: true,
        }),
      ),
    );
    expect(response.status).toBe(201);
    expect(fetchAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purpose: "Informar",
        category: "medicina_general",
        wantsPublic: true,
      }),
    );
  });

  it.each([{ purpose: 42 }, { category: null }, { wantsPublic: "true" }])(
    "rejects malformed optional registration fields",
    async (fields) => {
      expect(
        (
          await POST(
            request(
              JSON.stringify({
                name: "Servicio",
                description: "Información",
                ...fields,
              }),
            ),
          )
        ).status,
      ).toBe(400);
      expect(fetchAction).not.toHaveBeenCalled();
    },
  );
  it("returns credentials once with public URLs and forwards only the first client IP", async () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://public.example");
    fetchAction.mockResolvedValue({
      agentId: "agent-id",
      slug: "grok-bot-123",
      apiKey: "test-key",
      linkCode: "link-code",
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      agentId: "agent-id",
      slug: "grok-bot-123",
      apiKey: "test-key",
      mcpUrl: "https://public.example/api/mcp",
      linkUrl: "https://public.example/link/link-code",
      instructionsUrl: "https://public.example/llms.txt",
    });
    expect(fetchAction).toHaveBeenCalledWith(expect.anything(), {
      name: "Grok Bot",
      description: "Asistente",
      clientIp: "203.0.113.1",
    });
  });

  it.each(["{", "null", "{}", '{"name":2,"description":"text"}', "[]"])(
    "rejects malformed JSON or shape: %s",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("InvalidArgument");
      expect(fetchAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["InvalidArgument", 400],
    ["RateLimited", 429],
    ["Unexpected", 500],
  ] as const)("maps Convex %s to HTTP %s", async (kind, status) => {
    fetchAction.mockRejectedValue(
      new ConvexError({ kind, message: "private deployment detail" }),
    );
    const response = await POST(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toBe(kind);
    expect(body.message).not.toContain("private deployment detail");
  });

  it("sanitizes unexpected errors", async () => {
    fetchAction.mockRejectedValue(new Error("secret"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "InternalError",
      message: "No se pudo registrar el agente.",
    });
  });
});
