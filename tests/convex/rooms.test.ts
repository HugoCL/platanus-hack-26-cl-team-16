// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { effectiveAllowedIntents } from "../../shared/agent";
import { CLINIC_AGENT_SLUG, SEED_AGENTS } from "../../shared/seedData";
import { Session } from "../../shared/session";
import { errorKind, REQUEST, seededRooms } from "./roomFixture";

const clinicCard = SEED_AGENTS.find((a) => a.card.slug === CLINIC_AGENT_SLUG)
  ?.card as (typeof SEED_AGENTS)[number]["card"];

let rooms: Awaited<ReturnType<typeof seededRooms>>;
beforeEach(async () => {
  rooms = await seededRooms();
});
const open: (typeof rooms)["open"] = (overrides) => rooms.open(overrides);

describe("E2 success criteria", () => {
  it("1. opening a room from the clinic card returns an open room with the request, purpose, and what the card allows and forbids", async () => {
    const room = await open();

    expect(room.status).toBe("active");
    expect(room.contract).toMatchObject({
      intent: { description: REQUEST },
      purpose: clinicCard.purpose,
      allowedIntents: effectiveAllowedIntents(clinicCard),
      forbiddenTopics: clinicCard.scope.forbiddenTopics,
      recipientShares: clinicCard.scope.dataItShares,
      recipientRequests: clinicCard.scope.dataItRequests,
    });
    expect(clinicCard.scope.forbiddenTopics.length).toBeGreaterThan(0);
  });
});

describe("opening a room", () => {
  it("reads back as a valid shared Session with both agents and the human", async () => {
    const opened = await open({ human: { displayName: "Juan" } });
    const room = await rooms.t.query(api.rooms.get, {
      sessionId: opened.sessionId as Id<"sessions">,
    });

    expect(Session.safeParse(room).error?.issues ?? []).toEqual([]);
    expect(room).toEqual(opened);
    expect(room?.participants.map((p) => p.role)).toEqual([
      "initiator",
      "recipient",
      "owner",
    ]);
    expect(room?.participants[2]).toMatchObject({
      kind: "human",
      displayName: "Juan",
      onBehalfOfAgentId: rooms.consumerId,
    });
  });

  it("defaults the turn limit to 12 and accepts another one", async () => {
    expect((await open()).contract?.maxTurns).toBe(12);
    expect((await open({ maxTurns: 4 })).contract?.maxTurns).toBe(4);
  });

  it("uses the requested intent when the card allows it", async () => {
    expect((await open({ intent: "book" })).contract?.intent.name).toBe("book");
  });

  it.each([
    ["an intent the card does not allow", { intent: "place_order" }],
    ["an empty request", { request: "   " }],
    ["a turn limit of zero", { maxTurns: 0 }],
    ["a fractional turn limit", { maxTurns: 2.5 }],
    ["an empty human name", { human: { displayName: " " } }],
  ])("rejects %s", async (_why, overrides) => {
    expect(await errorKind(open(overrides))).toBe("InvalidArgument");
  });

  it("rejects a room between an agent and itself", async () => {
    expect(await errorKind(open({ providerAgentId: rooms.consumerId }))).toBe(
      "InvalidArgument",
    );
  });

  it("rejects a draft or missing provider card", async () => {
    const draftId = await rooms.t.run(async (ctx) => {
      const clinic = await ctx.db.get(rooms.clinicId);
      if (!clinic) throw new Error("missing clinic");
      const { _id, _creationTime, ...fields } = clinic;
      return ctx.db.insert("agents", {
        ...fields,
        slug: "draft-copy",
        status: "draft",
      });
    });
    expect(await errorKind(open({ providerAgentId: draftId }))).toBe(
      "InvalidArgument",
    );

    await rooms.t.run((ctx) => ctx.db.delete(draftId));
    expect(await errorKind(open({ providerAgentId: draftId }))).toBe(
      "InvalidArgument",
    );
  });

  it("stores nothing when opening fails", async () => {
    const before = await rooms.t.run((ctx) =>
      ctx.db.query("sessions").take(100),
    );
    await errorKind(open({ intent: "place_order" }));
    const after = await rooms.t.run((ctx) =>
      ctx.db.query("sessions").take(100),
    );
    expect(after).toHaveLength(before.length);
  });
});
