import { beforeEach, expect, it, vi } from "vitest";
import { httpRequestTool, maskKeys } from "../scripts/demo-http.mjs";

const fetchMock = vi.mocked(fetch);
const logs: string[] = [];
const tool = () =>
  httpRequestTool("http://localhost:3000", (line: string) => logs.push(line));
const execute = async (input: {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) => {
  const run = tool().execute;
  if (!run) throw new Error("HTTP tool has no execute function");
  const result = await run(input, {
    toolCallId: "test",
    messages: [],
    context: {},
  });
  if (!("status" in result))
    throw new Error("Expected a non-streaming HTTP result");
  return result;
};
beforeEach(() => {
  logs.length = 0;
});

it("returns raw SSE with only content-type and masks keys in logs", async () => {
  const body = `data: {"apiKey":"dak_${"a".repeat(64)}"}\n\n`;
  fetchMock.mockResolvedValueOnce(
    new Response(body, {
      headers: { "content-type": "text/event-stream", "set-cookie": "private" },
    }),
  );
  const result = await execute({
    method: "POST",
    url: "http://localhost:3000/anything",
    body: "{}",
  });
  expect(result).toEqual({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body,
  });
  expect(logs[0]).toContain("[MASKED_API_KEY]");
  expect(logs[0]).not.toContain("a".repeat(64));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ redirect: "manual", body: "{}" }),
  );
});

it("limits the raw response to 20000 characters", async () => {
  fetchMock.mockResolvedValueOnce(new Response("x".repeat(25000)));
  const result = await execute({ method: "GET", url: "http://localhost:3000" });
  expect(result.body).toHaveLength(20000);
});

it.each([
  "http://localhost:3210",
  "https://elsewhere.example",
  "http://user:pass@localhost:3000",
  "http://localhost:3001",
])("refuses requests outside the allowed origin: %s", async (url) => {
  expect((await execute({ method: "GET", url })).status).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not follow redirects or accept routing-header overrides", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "https://elsewhere.example" },
    }),
  );
  expect(
    (await execute({ method: "GET", url: "http://localhost:3000" })).status,
  ).toBe(302);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    (
      await execute({
        method: "GET",
        url: "http://localhost:3000",
        headers: { Host: "elsewhere.example" },
      })
    ).status,
  ).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("handles empty bodies and network failures without throwing", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(
    (await execute({ method: "GET", url: "http://localhost:3000" })).body,
  ).toBe("");
  fetchMock.mockRejectedValueOnce(new Error("connection failed"));
  expect(
    await execute({ method: "GET", url: "http://localhost:3000" }),
  ).toEqual({ status: 0, headers: {}, body: "connection failed" });
});

it("redacts API keys wherever they appear", () => {
  expect(maskKeys("dak_abcd dak_1234")).toBe(
    "[MASKED_API_KEY] [MASKED_API_KEY]",
  );
});
