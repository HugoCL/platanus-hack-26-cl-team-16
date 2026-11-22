// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { errorKind } from "./roomFixture";

const modules = import.meta.glob("../../convex/**/*.ts");

let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest({ schema, modules });
  rateLimiter.register(t);
});
afterEach(() => vi.useRealTimers());

const ana = () => t.withIdentity({ subject: "ana", name: "Ana Rojas" });
const beto = () => t.withIdentity({ subject: "beto", name: "Beto Paz" });
const caro = () => t.withIdentity({ subject: "caro", name: "Caro Vidal" });

async function befriend() {
  const { code } = await ana().mutation(api.friends.createInvite, {});
  await beto().mutation(api.friends.acceptInvite, { code });
  return code;
}

describe("friends", () => {
  it("makes both users friends once the link is accepted, with auto-approve off", async () => {
    await befriend();
    expect(await ana().query(api.friends.list, {})).toMatchObject([
      { name: "Beto Paz", autoApprove: false, agents: [] },
    ]);
    expect(await beto().query(api.friends.list, {})).toMatchObject([
      { name: "Ana Rojas", autoApprove: false, agents: [] },
    ]);
    expect(await caro().query(api.friends.list, {})).toEqual([]);
  });

  it("stores only the hash of the link code", async () => {
    const { code } = await ana().mutation(api.friends.createInvite, {});
    const rows = await t.run((ctx) => ctx.db.query("friendInvites").collect());
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("refuses a link that is used, expired, replaced, unknown or the caller's own", async () => {
    const used = await befriend();
    expect(
      await errorKind(
        caro().mutation(api.friends.acceptInvite, { code: used }),
      ),
    ).toBe("InvalidArgument");

    const replaced = await ana().mutation(api.friends.createInvite, {});
    const live = await ana().mutation(api.friends.createInvite, {});
    for (const code of [replaced.code, "nope"]) {
      expect(await caro().query(api.friends.inviteInfo, { code })).toBeNull();
      expect(
        await errorKind(caro().mutation(api.friends.acceptInvite, { code })),
      ).toBe("InvalidArgument");
    }
    expect(
      await errorKind(
        ana().mutation(api.friends.acceptInvite, { code: live.code }),
      ),
    ).toBe("InvalidArgument");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(live.expiresAt);
    expect(
      await errorKind(
        caro().mutation(api.friends.acceptInvite, { code: live.code }),
      ),
    ).toBe("InvalidArgument");
    expect(await caro().query(api.friends.list, {})).toEqual([]);
  });

  it("requires sign-in to create or accept a link", async () => {
    const { code } = await ana().mutation(api.friends.createInvite, {});
    expect(await errorKind(t.mutation(api.friends.createInvite, {}))).toBe(
      "Unauthorized",
    );
    expect(
      await errorKind(t.mutation(api.friends.acceptInvite, { code })),
    ).toBe("Unauthorized");
  });

  it("tells the visitor of a link who invites and whether they are already friends", async () => {
    const used = await befriend();
    expect(
      await beto().query(api.friends.inviteInfo, { code: used }),
    ).toMatchObject({
      inviterName: "Ana Rojas",
      used: true,
      alreadyFriends: true,
    });
    const { code } = await ana().mutation(api.friends.createInvite, {});
    expect(
      await beto().query(api.friends.inviteInfo, { code: used }),
    ).toBeNull();
    expect(await ana().query(api.friends.inviteInfo, { code })).toMatchObject({
      own: true,
      alreadyFriends: false,
    });
    expect(await t.query(api.friends.inviteInfo, { code })).toMatchObject({
      inviterName: "Ana Rojas",
      used: false,
      own: false,
    });
  });

  it("lets each side set its own auto-approve and nobody else's", async () => {
    await befriend();
    const [mine] = await ana().query(api.friends.list, {});
    expect(
      await errorKind(
        beto().mutation(api.friends.setAutoApprove, {
          friendshipId: mine.friendshipId,
          autoApprove: true,
        }),
      ),
    ).toBe("NotFound");
    await ana().mutation(api.friends.setAutoApprove, {
      friendshipId: mine.friendshipId,
      autoApprove: true,
    });
    expect(await ana().query(api.friends.list, {})).toMatchObject([
      { autoApprove: true },
    ]);
    expect(await beto().query(api.friends.list, {})).toMatchObject([
      { autoApprove: false },
    ]);
  });

  it("lists the agents a friend owns", async () => {
    await t.mutation(internal.seed.ensure, {});
    await befriend();
    const { agentId } = await beto().mutation(api.agentBuilder.createDraft, {
      name: "Agenda de Beto",
      summary: "Coordina la agenda de Beto",
    });
    expect(await ana().query(api.friends.list, {})).toMatchObject([
      {
        agents: [
          {
            agentId,
            name: "Agenda de Beto",
            description: "Coordina la agenda de Beto",
          },
        ],
      },
    ]);
  });

  it("removes the friendship for both sides", async () => {
    await befriend();
    const [mine] = await beto().query(api.friends.list, {});
    expect(
      await errorKind(
        caro().mutation(api.friends.remove, {
          friendshipId: mine.friendshipId,
        }),
      ),
    ).toBe("NotFound");
    await beto().mutation(api.friends.remove, {
      friendshipId: mine.friendshipId,
    });
    expect(await ana().query(api.friends.list, {})).toEqual([]);
    expect(await beto().query(api.friends.list, {})).toEqual([]);
  });
});
