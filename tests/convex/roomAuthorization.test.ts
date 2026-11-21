// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  errorKind,
  REQUEST,
  ROOM_OWNER,
  roomWithHuman,
  seededRooms,
} from "./roomFixture";

async function setup() {
  const fixture = await seededRooms();
  const { t } = fixture;
  const { sessionId, human } = await roomWithHuman(fixture);
  const asCaller = (
    caller: Pick<typeof t, "query" | "action" | "mutation">,
  ) => ({
    room: () => caller.query(api.rooms.get, { sessionId }),
    history: () => caller.query(api.gate.history, { sessionId }),
    historyPage: () =>
      caller.query(api.gate.historyPage, {
        sessionId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    send: () =>
      caller.action(api.gate.send, {
        sessionId,
        recipient: "all",
        content: { kind: "text", text: "Prefiero el jueves" },
      }),
    close: () => caller.mutation(api.rooms.close, { sessionId }),
  });
  return {
    ...fixture,
    sessionId,
    human,
    member: asCaller(t.withIdentity(ROOM_OWNER)),
    other: asCaller(
      t.withIdentity({ ...ROOM_OWNER, issuer: "https://other.test" }),
    ),
    signedOut: asCaller(t),
  };
}

describe("public room authorization", () => {
  it("lets the authenticated member read, send as themselves and close", async () => {
    const { member, sessionId, human } = await setup();

    expect(await member.room()).toMatchObject({ sessionId, status: "active" });
    const initial = await member.history();
    expect(initial).toMatchObject([{ content: { code: "session_opened" } }]);
    const message = await member.send();
    expect(message).toMatchObject({
      status: "allowed",
      senderParticipantId: human,
    });
    expect(await member.history()).toEqual([...initial, message]);
    expect((await member.historyPage()).page).toEqual([...initial, message]);
    expect(await member.close()).toEqual({ sessionId, status: "closed" });
  });

  it("denies unauthenticated users and non-members without changing the room", async () => {
    const { member, other, signedOut } = await setup();
    const initial = await member.history();

    for (const call of Object.values(signedOut)) {
      expect(await errorKind(call())).toBe("Unauthorized");
    }
    for (const call of Object.values(other)) {
      expect(await errorKind(call())).toBe("NotParticipant");
    }

    expect(await member.room()).toMatchObject({ status: "active" });
    expect(await member.history()).toEqual(initial);
  });

  it("denies users who have left the room", async () => {
    const { t, human, member } = await setup();
    await t.run((ctx) => ctx.db.patch("participants", human, { leftAt: 1 }));

    for (const call of Object.values(member)) {
      expect(await errorKind(call())).toBe("NotParticipant");
    }
  });

  it("opens a room for a human only on behalf of an agent they own or a shared agent", async () => {
    const { t, consumerId, open } = await seededRooms();
    const shared = await open({ human: { displayName: "Juan" } });
    const tokenIdentifier = await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("participants")
        .withIndex("by_sessionId", (q) =>
          q.eq("sessionId", shared.sessionId as Id<"sessions">),
        )
        .filter((q) => q.eq(q.field("kind"), "human"))
        .first();
      if (owner?.kind !== "human") throw new Error("missing owner");
      return owner.tokenIdentifier;
    });
    const setOwner = (ownerTokenIdentifier: string) =>
      t.run((ctx) =>
        ctx.db.patch("agents", consumerId, { ownerTokenIdentifier }),
      );
    const rows = () =>
      t.run(async (ctx) => ({
        sessions: (await ctx.db.query("sessions").collect()).length,
        participants: (await ctx.db.query("participants").collect()).length,
        messages: (await ctx.db.query("messages").collect()).length,
      }));

    await setOwner(tokenIdentifier);
    expect(
      (await open({ human: { displayName: "Juan" } })).participants,
    ).toContainEqual(
      expect.objectContaining({ role: "owner", onBehalfOfAgentId: consumerId }),
    );

    await setOwner("https://other.test|someone-else");
    const before = await rows();
    expect(await errorKind(open({ human: { displayName: "Juan" } }))).toBe(
      "NotOwner",
    );
    expect(await rows()).toEqual(before);
    expect((await open()).participants).toHaveLength(2);
  });

  it("does not attach a human to an internal opening without an authenticated user", async () => {
    const { t, consumerId, clinicId } = await seededRooms();

    expect(
      await errorKind(
        t.action(internal.rooms.open, {
          initiatorAgentId: consumerId,
          providerAgentId: clinicId,
          request: REQUEST,
          human: { displayName: "Juan" },
        }),
      ),
    ).toBe("Unauthorized");
  });
});
