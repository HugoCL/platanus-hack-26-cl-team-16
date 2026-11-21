// @vitest-environment edge-runtime
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { seededRooms } from "./roomFixture";

const network = vi.hoisted(() => ({
  address: "93.184.216.34",
  body: "<title>Mi web</title><p>Información pública</p>",
  status: 200,
  type: "text/html",
  bytes: "100",
}));
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: network.address, family: 4 }],
}));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({
  request: (
    _url: URL,
    _options: unknown,
    callback: (response: EventEmitter) => void,
  ) => {
    const request = new EventEmitter();
    return Object.assign(request, {
      destroy: (error: Error) => request.emit("error", error),
      end: () => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: network.status,
          headers: {
            "content-type": network.type,
            "content-length": network.bytes,
          },
          destroy: () => {},
        });
        callback(response);
        response.emit("data", Buffer.from(network.body));
        response.emit("end");
      },
    });
  },
}));
const pdf = vi.hoisted(() => ({
  text: "Texto del PDF",
  pages: 1,
  fail: false,
}));
vi.mock("unpdf", () => ({
  getDocumentProxy: async () => {
    if (pdf.fail) throw new Error("invalid PDF");
    return { numPages: pdf.pages, destroy: async () => {} };
  },
  extractText: async () => ({ text: pdf.text }),
}));

let rooms: Awaited<ReturnType<typeof seededRooms>>;
beforeEach(async () => {
  rooms = await seededRooms();
  Object.assign(network, {
    address: "93.184.216.34",
    body: "<title>Mi web</title><p>Información pública</p>",
    status: 200,
    type: "text/html",
    bytes: "100",
  });
  Object.assign(pdf, { text: "Texto del PDF", pages: 1, fail: false });
});

async function extractWebsite() {
  const caller = rooms.t.withIdentity({ subject: "owner" });
  const { agentId } = await caller.mutation(api.agentBuilder.createDraft, {
    name: "A",
    summary: "B",
  });
  const sourceId = await caller.mutation(api.agentBuilder.addWebsite, {
    agentId,
    url: "https://example.com",
  });
  await rooms.t.action(internal.agentBuilderExtraction.extract, { sourceId });
  return rooms.t.run((ctx) => ctx.db.get("agentSources", sourceId));
}

it("extracts and labels a public website", async () => {
  expect(await extractWebsite()).toMatchObject({
    status: "ready",
    label: "Mi web",
    text: "Mi web Información pública",
  });
});

it("rejects non-PDF uploads", async () => {
  const caller = rooms.t.withIdentity({ subject: "owner" });
  const { agentId } = await caller.mutation(api.agentBuilder.createDraft, {
    name: "A",
    summary: "B",
  });
  const storageId = await rooms.t.run((ctx) =>
    ctx.storage.store(new Blob(["text"], { type: "text/plain" })),
  );
  await expect(
    caller.mutation(api.agentBuilder.addPdf, {
      agentId,
      storageId,
      filename: "fake.pdf",
    }),
  ).rejects.toThrow(/PDF válido/);
});

it.each(["private DNS", "redirect", "oversize", "binary", "empty"])(
  "marks %s websites failed without exposing technical errors",
  async (scenario) => {
    if (scenario === "private DNS") network.address = "169.254.169.254";
    if (scenario === "redirect") network.status = 302;
    if (scenario === "oversize") network.bytes = "3000000";
    if (scenario === "binary") network.type = "application/octet-stream";
    if (scenario === "empty") network.body = "";
    expect(await extractWebsite()).toMatchObject({
      status: "failed",
      error: expect.stringContaining("No pudimos leer el sitio"),
    });
  },
);

it.each(["ready", "empty", "corrupt", "too many pages"])(
  "handles %s PDFs and respects ownership",
  async (scenario) => {
    if (scenario === "empty") pdf.text = "";
    if (scenario === "corrupt") pdf.fail = true;
    if (scenario === "too many pages") pdf.pages = 201;
    const caller = rooms.t.withIdentity({ subject: "owner" });
    const { agentId } = await caller.mutation(api.agentBuilder.createDraft, {
      name: "A",
      summary: "B",
    });
    const storageId = await rooms.t.run((ctx) =>
      ctx.storage.store(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
    );
    await expect(
      rooms.t
        .withIdentity({ subject: "other" })
        .mutation(api.agentBuilder.addPdf, {
          agentId,
          storageId,
          filename: "info.pdf",
        }),
    ).rejects.toThrow(/acceso/);
    const sourceId = await caller.mutation(api.agentBuilder.addPdf, {
      agentId,
      storageId,
      filename: "info.pdf",
    });
    await rooms.t.action(internal.agentBuilderExtraction.extract, { sourceId });
    const source = await rooms.t.run((ctx) =>
      ctx.db.get("agentSources", sourceId),
    );
    expect(source?.status).toBe(scenario === "ready" ? "ready" : "failed");
    if (scenario === "ready") expect(source?.text).toBe("Texto del PDF");
    else expect(source?.error).toContain("No pudimos leer el PDF");
    await caller.mutation(api.agentBuilder.removeSource, { sourceId });
    await rooms.t.action(internal.agentBuilderExtraction.extract, { sourceId });
    expect(
      await rooms.t.run((ctx) => ctx.db.get("agentSources", sourceId)),
    ).toBeNull();
  },
);
