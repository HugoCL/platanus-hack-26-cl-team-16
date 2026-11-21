import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createMcpEndpoint } from "../lib/mcp";

const MCP_URL = "http://localhost/api/mcp";
const endpoint = createMcpEndpoint();

type Negotiation = "legacy" | "auto";

async function connect(mode: Negotiation) {
  const client = new Client(
    { name: "e5-test", version: "0.0.0" },
    { versionNegotiation: { mode } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (url, init) => endpoint(new Request(url, init)),
    }),
  );
  return client;
}

describe.each<[Negotiation, string]>([
  ["legacy", "legacy"],
  ["auto", "modern"],
])("MCP endpoint, %s client", (mode, era) => {
  it(`speaks the ${era} protocol and lists its tools`, async () => {
    const client = await connect(mode);
    expect(client.getProtocolEra()).toBe(era);
    expect(client.getServerVersion()?.name).toBe("directorio-agentes");
    await expect(client.listTools()).resolves.toMatchObject({ tools: [] });
    await client.close();
  });
});

it("refuses a request from another site's page with 403", async () => {
  const initialize = (origin: string, proxy: Record<string, string> = {}) =>
    endpoint(
      new Request(MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          origin,
          ...proxy,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "browser", version: "0" },
          },
        }),
      }),
    );
  for (const origin of [
    "https://evil.example",
    "http://localhost.evil.example",
    "https://localhost",
    "http://localhost/api/mcp",
    "null",
  ]) {
    expect((await initialize(origin)).status).toBe(403);
  }
  expect((await initialize("http://localhost")).status).toBe(200);

  const proxy = {
    "x-forwarded-proto": "https",
    "x-forwarded-host": "directorio.example",
  };
  expect((await initialize("https://directorio.example", proxy)).status).toBe(
    200,
  );
  expect((await initialize("http://localhost", proxy)).status).toBe(403);
});
