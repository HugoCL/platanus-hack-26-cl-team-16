// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { sha256Hex } from "../../convex/agentKeys";
import { REQUEST, seededRooms } from "./roomFixture";

let rooms: Awaited<ReturnType<typeof seededRooms>>;
beforeEach(async () => {
  vi.stubEnv("AGENT_REGISTRATION_SECRET", undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  rooms = await seededRooms();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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
  it("allows unprotected local registration and warns exactly once per call", async () => {
    await register();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      "AGENT_REGISTRATION_SECRET is not set; registration is unprotected.",
    );
    await register();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("rejects missing or wrong server credentials without consuming either registration bucket", async () => {
    const secret = "test-registration-secret";
    vi.stubEnv("AGENT_REGISTRATION_SECRET", secret);
    vi.useFakeTimers({ toFake: ["Date"] });
    const attempt = (secret: string | undefined, clientIp: string) =>
      rooms.t.action(api.agentRegistration.register, {
        name: "Servicio",
        description: "Información",
        secret,
        clientIp,
      });
    const wrong = [
      undefined,
      "",
      "wrong",
      "test-registration-secreu",
      `${secret}extra`,
    ];
    for (let i = 0; i < 65; i++) {
      await expect(
        attempt(wrong[i % wrong.length], i % 2 ? "shared-ip" : `rotating-${i}`),
      ).rejects.toThrow(/server credential/);
    }
    for (let i = 0; i < 5; i++)
      await expect(attempt(secret, "shared-ip")).resolves.toHaveProperty(
        "agentId",
      );
    await expect(attempt(secret, "shared-ip")).rejects.toThrow(
      /registration quota exhausted/,
    );
    for (let i = 0; i < 55; i++) await attempt(secret, `valid-${i}`);
    await expect(attempt(secret, "next-ip")).rejects.toThrow(
      /registration quota exhausted/,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "linking backfills old open and closed rooms and preserves future access (publish=%s)",
    async (publish) => {
      const agent = await register();
      const caller = rooms.t.withIdentity({ subject: "owner", name: "Ana" });
      const open = () =>
        rooms.t.action(api.mcpRooms.open, {
          apiKey: agent.apiKey,
          targetAgentId: rooms.clinicId,
          intent: "book",
          request: REQUEST,
        });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const first = await open();
        vi.advanceTimersByTime(1000);
        const second = await open();
        await rooms.t.action(api.mcpRooms.close, {
          apiKey: agent.apiKey,
          sessionId: second.sessionId,
        });
        await expect(
          caller.query(api.rooms.view, {
            sessionId: first.sessionId as Id<"sessions">,
          }),
        ).rejects.toThrow(/not a participant/);
        await caller.mutation(api.agentRegistration.link, {
          code: agent.linkCode,
          ...(publish
            ? { publish: { purpose: "Ayudar", category: "asistente_personal" } }
            : {}),
        });
        for (const room of [first, second]) {
          const sessionId = room.sessionId as Id<"sessions">;
          await expect(
            caller.query(api.rooms.view, { sessionId }),
          ).resolves.toMatchObject({
            session: {
              status: room === first ? "active" : "closed",
              participants: expect.arrayContaining([
                expect.objectContaining({
                  kind: "human",
                  role: "owner",
                  displayName: "Ana",
                  onBehalfOfAgentId: agent.agentId,
                }),
              ]),
            },
          });
          expect(
            await rooms.t.run((ctx) =>
              ctx.db
                .query("participants")
                .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
                .collect(),
            ),
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                tokenIdentifier: (
                  await caller.run((ctx) => ctx.auth.getUserIdentity())
                )?.tokenIdentifier,
              }),
            ]),
          );
        }
        const page = await caller.query(api.agentRegistration.rooms, {
          agentId: agent.agentId,
          paginationOpts: { numItems: 1, cursor: null },
        });
        expect(page.page).toMatchObject([
          { sessionId: second.sessionId, status: "closed" },
        ]);
        expect(page.isDone).toBe(false);
        expect(
          (
            await caller.query(api.agentRegistration.rooms, {
              agentId: agent.agentId,
              paginationOpts: { numItems: 1, cursor: page.continueCursor },
            })
          ).page,
        ).toMatchObject([{ sessionId: first.sessionId, status: "active" }]);
        for (const client of [rooms.t, other()])
          await expect(
            client.query(api.agentRegistration.rooms, {
              agentId: agent.agentId,
              paginationOpts: { numItems: 20, cursor: null },
            }),
          ).rejects.toThrow(/only the owner/);
        vi.advanceTimersByTime(1000);
        const future = await open();
        await expect(
          caller.query(api.rooms.view, {
            sessionId: future.sessionId as Id<"sessions">,
          }),
        ).resolves.toMatchObject({
          session: {
            participants: expect.arrayContaining([
              expect.objectContaining({
                kind: "human",
                role: "owner",
                onBehalfOfAgentId: agent.agentId,
              }),
            ]),
          },
        });
        expect(
          (
            await caller.query(api.agentRegistration.rooms, {
              agentId: agent.agentId,
              paginationOpts: { numItems: 20, cursor: null },
            })
          ).page.map((room) => room.sessionId),
        ).toEqual([future.sessionId, second.sessionId, first.sessionId]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("lists no rooms for a newly linked agent and never replaces an existing room owner", async () => {
    const agent = await register();
    const first = await rooms.t.action(api.mcpRooms.open, {
      apiKey: agent.apiKey,
      targetAgentId: rooms.clinicId,
      intent: "book",
      request: REQUEST,
    });
    const sessionId = first.sessionId as Id<"sessions">;
    await rooms.t.run((ctx) =>
      ctx.db.insert("participants", {
        sessionId,
        kind: "human",
        role: "owner",
        tokenIdentifier: "existing-owner",
        displayName: "Titular original",
        onBehalfOfAgentId: agent.agentId,
      }),
    );
    await owner().mutation(api.agentRegistration.link, {
      code: agent.linkCode,
    });
    const humans = await rooms.t.run(async (ctx) =>
      (
        await ctx.db
          .query("participants")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
          .collect()
      ).filter((p) => p.kind === "human"),
    );
    expect(humans).toHaveLength(1);
    expect(humans[0]).toMatchObject({
      tokenIdentifier: "existing-owner",
      displayName: "Titular original",
    });
    const empty = await register();
    await owner().mutation(api.agentRegistration.link, {
      code: empty.linkCode,
    });
    expect(
      (
        await owner().query(api.agentRegistration.rooms, {
          agentId: empty.agentId,
          paginationOpts: { numItems: 20, cursor: null },
        })
      ).page,
    ).toEqual([]);
  });
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
      scope: {
        allowedIntents: [],
        forbiddenTopics: [],
        dataItShares: [],
        dataItRequests: [],
      },
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
    await rooms.t.run((ctx) =>
      ctx.db.patch(provider.agentId, {
        verified: true,
        scope: {
          allowedIntents: [],
          forbiddenTopics: ["pacientes"],
          dataItShares: ["rut", "nombre_paciente", "telefono", "nombre"],
          dataItRequests: ["rut"],
        },
      }),
    );
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
    ).toMatchObject({
      capabilities: ["info"],
      allowedIntents: ["ask_info"],
      verified: false,
      scope: {
        allowedIntents: [],
        forbiddenTopics: [],
        dataItShares: [],
        dataItRequests: [],
      },
    });
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
      recipientShares: [],
      recipientRequests: [],
      forbiddenTopics: [],
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
    const initial = await owner().query(api.agentRegistration.linkInfo, {
      code: agent.linkCode,
    });
    expect(initial).toMatchObject({
      expiresAt: expect.any(Number),
      alreadyLinked: false,
      linkedToCurrentUser: false,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      await expect(
        owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
      ).resolves.toEqual(initial);
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
        expiresAt: expect.any(Number),
        usedAt: expect.any(Number),
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

  it("stores the agent's card and publication request without publishing before human confirmation", async () => {
    const card = {
      name: "Información",
      description: "Descripción preparada",
      purpose: "Propósito preparado",
      category: "medicina_general",
      wantsPublic: true,
    };
    const agent = await rooms.t.action(api.agentRegistration.register, card);
    await expect(
      rooms.t.query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({
      description: card.description,
      purpose: card.purpose,
      category: card.category,
      wantsPublic: true,
      status: "draft",
    });
    await expect(
      rooms.t.query(api.directory.get, { agentId: agent.agentId }),
    ).resolves.toBeNull();
    await owner().mutation(api.agentRegistration.link, {
      code: agent.linkCode,
    });
    await expect(
      owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({ status: "draft", wantsPublic: true });
    const privateAgent = await rooms.t.action(api.agentRegistration.register, {
      ...card,
      wantsPublic: false,
    });
    await expect(
      rooms.t.query(api.agentRegistration.linkInfo, {
        code: privateAgent.linkCode,
      }),
    ).resolves.toMatchObject({ wantsPublic: false, status: "draft" });
  });

  it("links and publishes atomically with human-reviewed values", async () => {
    const agent = await register();
    const publication = {
      purpose: "Propósito editado",
      description: "Descripción editada",
      category: "medicina_general",
    };
    await expect(
      rooms.t.mutation(api.agentRegistration.link, {
        code: agent.linkCode,
        publish: publication,
      }),
    ).rejects.toThrow(/sign in/);
    await expect(
      owner().mutation(api.agentRegistration.link, {
        code: agent.linkCode,
        publish: { ...publication, category: "missing" },
      }),
    ).rejects.toThrow(/unknown category/);
    await expect(
      rooms.t.query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({ alreadyLinked: false, status: "draft" });
    await expect(
      owner().mutation(api.agentRegistration.link, {
        code: agent.linkCode,
        publish: { ...publication, purpose: " " },
      }),
    ).rejects.toThrow(/text must/);
    await owner().mutation(api.agentRegistration.link, {
      code: agent.linkCode,
      publish: publication,
    });
    await expect(
      owner().query(api.agentRegistration.linkInfo, { code: agent.linkCode }),
    ).resolves.toMatchObject({
      alreadyLinked: true,
      linkedToCurrentUser: true,
      status: "active",
      ...publication,
    });
    await expect(
      rooms.t.query(api.directory.get, { agentId: agent.agentId }),
    ).resolves.toMatchObject({
      status: "active",
      description: publication.description,
      purpose: publication.purpose,
      allowedIntents: ["ask_info"],
    });
    await expect(
      other().mutation(api.agentRegistration.link, {
        code: agent.linkCode,
        publish: publication,
      }),
    ).rejects.toThrow(/another user/);
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
