// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { CLINIC_AGENT_SLUG } from "../../shared/seed-data";
import { errorKind, REQUEST, ROOM_OWNER, seededRooms } from "./roomFixture";

let rooms: Awaited<ReturnType<typeof seededRooms>>;
beforeEach(async () => {
  rooms = await seededRooms();
});
const args = {
  providerSlug: CLINIC_AGENT_SLUG,
  intent: "book",
  description: REQUEST,
};
const owner = { ...ROOM_OWNER, name: "Ana" };
const open = () =>
  rooms.t.withIdentity(owner).action(api.rooms.openFromCard, args);

describe("room UI API", () => {
  it("opens with the caller as owner and resolves names from agent cards", async () => {
    const { sessionId } = await open();
    const caller = rooms.t.withIdentity(owner);
    const room = await caller.query(api.rooms.get, { sessionId });
    expect(room?.participants).toContainEqual(
      expect.objectContaining({
        kind: "human",
        role: "owner",
        displayName: "Ana",
      }),
    );
    expect(rooms.judge).toHaveBeenCalledOnce();
    const view = await caller.query(api.rooms.view, { sessionId });
    const clinic = await rooms.t.query(api.directory.get, {
      slug: CLINIC_AGENT_SLUG,
    });
    expect(view?.session).toEqual(room);
    expect(view?.participantNames).toContainEqual({
      participantId: view?.humanParticipantId,
      name: "Ana",
    });
    expect(view?.participantNames).toContainEqual(
      expect.objectContaining({ name: clinic?.name, slug: CLINIC_AGENT_SLUG }),
    );
    expect(
      await errorKind(
        rooms.t
          .withIdentity({ subject: "outsider" })
          .query(api.rooms.view, { sessionId }),
      ),
    ).toBe("NotParticipant");
    expect(await errorKind(rooms.t.query(api.rooms.view, { sessionId }))).toBe(
      "Unauthorized",
    );
  });

  it("rejects signed-out openers, unknown cards, and invalid requests", async () => {
    expect(await errorKind(rooms.t.action(api.rooms.openFromCard, args))).toBe(
      "Unauthorized",
    );
    const caller = rooms.t.withIdentity(owner);
    expect(
      await errorKind(
        caller.action(api.rooms.openFromCard, {
          ...args,
          providerSlug: "missing",
        }),
      ),
    ).toBe("NotFound");
    expect(
      await errorKind(
        caller.action(api.rooms.openFromCard, { ...args, description: " " }),
      ),
    ).toBe("InvalidArgument");
    rooms.judge.mockReturnValue({
      decision: "block",
      rule: "purpose",
      reason: "Fuera de propósito",
    });
    expect(await errorKind(open())).toBe("RequestBlocked");
  });

  it("lists only active memberships of the caller, newest first", async () => {
    const caller = rooms.t.withIdentity(owner);
    expect(await caller.query(api.rooms.mine, {})).toEqual([]);
    const first = await open();
    const second = await open();
    await rooms.t
      .withIdentity({ subject: "other" })
      .action(api.rooms.openFromCard, args);
    const mine = await caller.query(api.rooms.mine, {});
    expect(mine.map((r) => r.sessionId)).toEqual([
      second.sessionId,
      first.sessionId,
    ]);
    expect(mine[0]).toMatchObject({
      status: "active",
      intent: "book",
      provider: { slug: CLINIC_AGENT_SLUG },
    });
    expect(mine[0].lastActivityTime).toBeGreaterThanOrEqual(
      mine[1].lastActivityTime,
    );
    const view = await caller.query(api.rooms.view, first);
    if (!view) throw new Error("missing room view");
    await rooms.t.run((ctx) =>
      ctx.db.patch(view.humanParticipantId, { leftAt: Date.now() }),
    );
    expect(
      (await caller.query(api.rooms.mine, {})).map((r) => r.sessionId),
    ).toEqual([second.sessionId]);
    expect(await errorKind(caller.query(api.rooms.view, first))).toBe(
      "NotParticipant",
    );
    expect(await rooms.t.query(api.rooms.mine, {})).toEqual([]);
  });

  it.each([{ email: "ana@example.com" }, {}])(
    "uses identity name fallbacks: %j",
    async (identity) => {
      const caller = rooms.t.withIdentity({ subject: "fallback", ...identity });
      const opened = await caller.action(api.rooms.openFromCard, args);
      const view = await caller.query(api.rooms.view, opened);
      expect(view?.participantNames).toContainEqual({
        participantId: view?.humanParticipantId,
        name: "email" in identity ? identity.email : "Tú",
      });
    },
  );
});
