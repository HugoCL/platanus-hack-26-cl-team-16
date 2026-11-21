// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { sha256Hex } from "../../convex/agentKeys";
import { REQUEST, seededRooms } from "./roomFixture";

let rooms: Awaited<ReturnType<typeof seededRooms>>;
beforeEach(async () => {
  rooms = await seededRooms();
});
const register = (clientIp?: string) =>
  rooms.t.action(api.agentRegistration.register, {
    name: "Mi asistente",
    description: "Reservar citas para mi usuario",
    clientIp,
  });
const owner = () => rooms.t.withIdentity({ subject: "owner" });
const other = () => rooms.t.withIdentity({ subject: "other" });

describe("agent self-onboarding", () => {
  it("registers an agent with its own declared purpose and category", async () => {
    const { t } = rooms;
    const agent = await t.action(api.agentRegistration.register, {
      name: "Información de salud",
      description: "Servicio de información",
      purpose: "Responder consultas de salud",
      category: "medicina_general",
    });
    expect(await t.run((ctx) => ctx.db.get(agent.agentId))).toMatchObject({
      purpose: "Responder consultas de salud",
      categories: ["medicina_general"],
      primaryCategory: "medicina_general",
      capabilities: [],
      status: "draft",
    });
    await expect(
      t.action(api.agentRegistration.register, {
        name: "Servicio",
        description: "Información",
        category: "missing",
      }),
    ).rejects.toThrow(/unknown category/);
    await expect(
      t.action(api.agentRegistration.register, {
        name: "Servicio",
        description: "Información",
        purpose: " ",
      }),
    ).rejects.toThrow(/text must/);
    await expect(
      t.action(api.agentRegistration.register, {
        name: "Servicio",
        description: "Información",
        purpose: "a".repeat(1001),
      }),
    ).rejects.toThrow(/text must/);
  });
  it("registers private external agents with hashed credentials and usable MCP keys", async () => {
    const { t, clinicId } = rooms;
    const agent = await register();
    expect(agent.slug).toMatch(/^mi-asistente-[a-z0-9-]+$/);
    const second = await register();
    expect(second.slug).not.toBe(agent.slug);
    await expect(
      t.mutation(api.agentKeys.authenticate, { apiKey: agent.apiKey }),
    ).resolves.toEqual({ ok: true, agentId: agent.agentId });
    const codeHash = await sha256Hex(agent.linkCode);
    const stored = await t.run(async (ctx) => ({
      agent: await ctx.db.get(agent.agentId),
      code: await ctx.db
        .query("agentLinkCodes")
        .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
        .unique(),
    }));
    expect(stored.code?.codeHash).toBe(codeHash);
    expect(JSON.stringify(stored)).not.toContain(agent.linkCode);
    expect(stored.agent).toMatchObject({
      kind: "external",
      status: "draft",
      verified: false,
      capabilities: [],
      categories: ["asistente_personal"],
    });
    await expect(
      t.query(api.directory.get, { slug: agent.slug }),
    ).resolves.toBeNull();
    expect(
      (await t.query(api.directory.search, {})).agents.some(
        (a) => a.agentId === agent.agentId,
      ),
    ).toBe(false);
    const room = await t.action(api.mcpRooms.open, {
      apiKey: agent.apiKey,
      targetAgentId: clinicId,
      intent: "book",
      request: REQUEST,
    });
    expect(
      room.participants.some(
        (p) => p.kind === "agent" && p.agentId === agent.agentId,
      ),
    ).toBe(true);
    await expect(
      t.action(internal.rooms.open, {
        initiatorAgentId: clinicId,
        providerAgentId: agent.agentId,
        request: REQUEST,
      }),
    ).rejects.toThrow(/provider card/);
    const issued = await t.action(internal.agentKeys.issue, {
      slug: agent.slug,
    });
    await expect(
      t.mutation(api.agentKeys.authenticate, { apiKey: issued.apiKey }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("requires authentication, binds ownership once and restricts publication", async () => {
    const agent = await register();
    const { t } = rooms;
    await expect(t.query(api.agentRegistration.mine, {})).resolves.toEqual([]);
    await expect(
      t.query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({
      alreadyLinked: false,
      linkedToCurrentUser: false,
    });
    await expect(
      t.mutation(api.agentRegistration.link, { code: agent.linkCode }),
    ).rejects.toThrow(/sign in/);
    await owner().mutation(api.agentRegistration.link, {
      code: agent.linkCode,
    });
    await expect(
      other().mutation(api.agentRegistration.link, { code: agent.linkCode }),
    ).rejects.toThrow(/another user/);
    await expect(
      owner().mutation(api.agentRegistration.link, { code: agent.linkCode }),
    ).rejects.toThrow(/already used/);
    await expect(
      t.query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toBeNull();
    await expect(
      owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({
      alreadyLinked: true,
      linkedToCurrentUser: true,
    });
    expect(await owner().query(api.agentRegistration.mine, {})).toHaveLength(1);
    expect(await other().query(api.agentRegistration.mine, {})).toHaveLength(0);
    const publish = {
      agentId: agent.agentId,
      purpose: "Ayudar a reservar",
      category: "asistente_personal",
      description: "Asistente publicado",
    };
    await expect(
      other().mutation(api.agentRegistration.publish, publish),
    ).rejects.toThrow(/only the owner/);
    await expect(
      owner().mutation(api.agentRegistration.publish, {
        ...publish,
        category: "missing",
      }),
    ).rejects.toThrow(/unknown category/);
    await expect(
      owner().mutation(api.agentRegistration.publish, {
        ...publish,
        purpose: " ",
      }),
    ).rejects.toThrow(/text must/);
    await owner().mutation(api.agentRegistration.publish, publish);
    await expect(
      t.query(api.directory.get, { agentId: agent.agentId }),
    ).resolves.toMatchObject({
      status: "active",
      description: publish.description,
      purpose: publish.purpose,
    });
    expect(
      (
        await t.query(api.directory.search, { category: "asistente_personal" })
      ).agents.some((a) => a.agentId === agent.agentId),
    ).toBe(true);
    await expect(
      other().mutation(api.agentRegistration.unpublish, {
        agentId: agent.agentId,
      }),
    ).rejects.toThrow(/only the owner/);
    await owner().mutation(api.agentRegistration.unpublish, {
      agentId: agent.agentId,
    });
    await expect(
      t.query(api.directory.get, { slug: agent.slug }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.agentKeys.authenticate, { apiKey: agent.apiKey }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("allows another registered agent to open an information room with a published agent", async () => {
    const provider = await register();
    const initiator = await register();
    await owner().mutation(api.agentRegistration.link, {
      code: provider.linkCode,
    });
    const publication = {
      agentId: provider.agentId,
      purpose: "Responder consultas",
      category: "asistente_personal",
    };
    await owner().mutation(api.agentRegistration.publish, publication);
    await owner().mutation(api.agentRegistration.publish, publication);
    expect(
      await rooms.t.query(api.directory.get, { agentId: provider.agentId }),
    ).toMatchObject({ capabilities: ["info"], allowedIntents: ["ask_info"] });
    const room = await rooms.t.action(api.mcpRooms.open, {
      apiKey: initiator.apiKey,
      targetAgentId: provider.agentId,
      intent: "ask_info",
      request: "Necesito información sobre tu propósito",
    });
    expect(room.contract).toMatchObject({
      capabilities: ["info"],
      allowedIntents: ["ask_info"],
      intent: { name: "ask_info" },
    });
    await expect(
      rooms.t.action(api.mcpRooms.open, {
        apiKey: initiator.apiKey,
        targetAgentId: provider.agentId,
        intent: "book",
        request: REQUEST,
      }),
    ).rejects.toThrow(/not one the card allows/);
  });

  it("rejects empty/oversized registration, invalid codes and expired codes", async () => {
    for (const input of [
      { name: "", description: "ok" },
      { name: "a".repeat(121), description: "ok" },
      { name: "ok", description: " " },
      { name: "ok", description: "a".repeat(1001) },
    ]) {
      await expect(
        rooms.t.action(api.agentRegistration.register, input),
      ).rejects.toThrow(/text must/);
    }
    await expect(
      rooms.t.query(api.agentRegistration.linkInfo, { code: "wrong" }),
    ).resolves.toBeNull();
    await expect(
      owner().mutation(api.agentRegistration.link, { code: "wrong" }),
    ).rejects.toThrow(/invalid or expired/);
    const agent = await register();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      await expect(
        owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toBeNull();
      await expect(
        owner().mutation(api.agentRegistration.link, { code: agent.linkCode }),
      ).rejects.toThrow(/invalid or expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an expired linked code accessible only to its owner for publication controls", async () => {
    const agent = await register();
    await owner().mutation(api.agentRegistration.link, {
      code: agent.linkCode,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      await expect(
        owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toMatchObject({
        linkedToCurrentUser: true,
        alreadyLinked: true,
        status: "draft",
      });
      await expect(
        rooms.t.query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toBeNull();
      await expect(
        other().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toBeNull();
      await expect(
        other().mutation(api.agentRegistration.link, { code: agent.linkCode }),
      ).rejects.toThrow(/invalid or expired/);
      await owner().mutation(api.agentRegistration.publish, {
        agentId: agent.agentId,
        purpose: "Responder consultas",
        category: "asistente_personal",
      });
      await expect(
        owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toMatchObject({ status: "active" });
      await owner().mutation(api.agentRegistration.unpublish, {
        agentId: agent.agentId,
      });
      await expect(
        owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toMatchObject({ status: "draft" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate limits missing IPs and the global registration bucket", async () => {
    for (let i = 0; i < 5; i++) await register();
    await expect(register()).rejects.toThrow(/registration quota exhausted/);
    for (let i = 0; i < 55; i++) await register(`ip-${i}`);
    await expect(register("another-ip")).rejects.toThrow(
      /registration quota exhausted/,
    );
  });
});
