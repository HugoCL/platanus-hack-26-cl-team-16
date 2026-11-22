// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  errorKind,
  ROOM_OWNER,
  roomWithHuman,
  seededRooms,
} from "./roomFixture";

const BETO = { subject: "beto", name: "Beto Paz" };
const CARO = { subject: "caro", name: "Caro Vidal" };

async function setup({ friends = true, autoApprove = false } = {}) {
  const fixture = await seededRooms();
  const { t } = fixture;
  const juan = t.withIdentity({ ...ROOM_OWNER, name: "Juan Soto" });
  const beto = t.withIdentity(BETO);
  const caro = t.withIdentity(CARO);
  const { sessionId } = await roomWithHuman(fixture);
  const { agentId } = await beto.mutation(api.agentBuilder.createDraft, {
    name: "Agenda de Beto",
    summary: "Coordina la agenda de Beto",
  });
  if (friends) {
    const { code } = await juan.mutation(api.friends.createInvite, {});
    await beto.mutation(api.friends.acceptInvite, { code });
  }
  if (autoApprove) {
    const [{ friendshipId }] = await beto.query(api.friends.list, {});
    await beto.mutation(api.friends.setAutoApprove, {
      friendshipId,
      autoApprove: true,
    });
  }
  const invite = (caller = juan) =>
    caller.mutation(api.roomInvitations.invite, { sessionId, agentId });
  const invitationId = async () =>
    (await beto.query(api.roomInvitations.inbox, {}))[0]?.invitationId;
  const members = async () =>
    (await juan.query(api.rooms.view, { sessionId }))?.session.participants;
  return {
    ...fixture,
    juan,
    beto,
    caro,
    sessionId,
    agentId,
    invite,
    invitationId,
    members,
  };
}

const respond = (
  caller: Awaited<ReturnType<typeof setup>>["beto"],
  invitationId: Id<"roomInvitations">,
  approve = true,
) => caller.mutation(api.roomInvitations.respond, { invitationId, approve });

describe("room invitations", () => {
  it("waits for the agent's owner, then adds the agent as a guest and its owner", async () => {
    const { juan, beto, sessionId, agentId, invite, invitationId, members } =
      await setup();
    expect(await invite()).toEqual({ status: "pending" });
    expect(await members()).toHaveLength(3);
    expect(await beto.query(api.roomInvitations.inbox, {})).toMatchObject([
      { sessionId, agentName: "Agenda de Beto", inviterName: "Juan Soto" },
    ]);
    expect(
      await juan.query(api.roomInvitations.forRoom, { sessionId }),
    ).toMatchObject([{ agentId, mine: true }]);
    expect(await errorKind(beto.query(api.rooms.view, { sessionId }))).toBe(
      "NotParticipant",
    );

    await respond(beto, (await invitationId()) as Id<"roomInvitations">);

    expect(await members()).toMatchObject([
      { role: "initiator" },
      { role: "recipient" },
      { kind: "human", role: "owner" },
      { kind: "agent", role: "guest", agentId },
      {
        kind: "human",
        role: "owner",
        displayName: "Beto Paz",
        onBehalfOfAgentId: agentId,
      },
    ]);
    expect(await beto.query(api.roomInvitations.inbox, {})).toEqual([]);
    expect(
      await juan.query(api.roomInvitations.forRoom, { sessionId }),
    ).toEqual([]);
    const history = await beto.query(api.gate.history, { sessionId });
    expect(history.at(-1)?.content).toMatchObject({
      kind: "system",
      code: "agent_joined",
      text: "Agenda de Beto se unió a la sala, invitado por Juan Soto.",
    });
  });

  it("joins at once when the owner auto-approves the inviter", async () => {
    const { beto, invite, members } = await setup({ autoApprove: true });
    expect(await invite()).toEqual({ status: "approved" });
    expect(await members()).toHaveLength(5);
    expect(await beto.query(api.roomInvitations.inbox, {})).toEqual([]);
  });

  it("does not auto-approve on the inviter's own switch", async () => {
    const { juan, invite, members } = await setup();
    const [{ friendshipId }] = await juan.query(api.friends.list, {});
    await juan.mutation(api.friends.setAutoApprove, {
      friendshipId,
      autoApprove: true,
    });
    expect(await invite()).toEqual({ status: "pending" });
    expect(await members()).toHaveLength(3);
  });

  it("leaves the room unchanged when the owner denies", async () => {
    const { beto, invite, invitationId, members } = await setup();
    await invite();
    const id = (await invitationId()) as Id<"roomInvitations">;
    await respond(beto, id, false);
    expect(await members()).toHaveLength(3);
    expect(await errorKind(respond(beto, id))).toBe("AlreadyAnswered");
  });

  it("only invites an agent that a friend owns", async () => {
    const { invite, consumerId, juan, sessionId } = await setup({
      friends: false,
    });
    expect(await errorKind(invite())).toBe("NotFriend");
    expect(
      await errorKind(
        juan.mutation(api.roomInvitations.invite, {
          sessionId,
          agentId: consumerId,
        }),
      ),
    ).toBe("NotFriend");
  });

  it("refuses callers who are not in the room", async () => {
    const { t, beto, caro, invite, sessionId } = await setup();
    expect(await errorKind(invite(beto))).toBe("NotParticipant");
    expect(await errorKind(invite(caro))).toBe("NotParticipant");
    expect(await errorKind(invite(t as never))).toBe("Unauthorized");
    expect(
      await errorKind(caro.query(api.roomInvitations.forRoom, { sessionId })),
    ).toBe("NotParticipant");
  });

  it("lets only the agent's owner answer and only the inviter cancel", async () => {
    const { t, juan, beto, caro, invite, invitationId, members } =
      await setup();
    await invite();
    const id = (await invitationId()) as Id<"roomInvitations">;
    expect(await caro.query(api.roomInvitations.inbox, {})).toEqual([]);
    expect(await t.query(api.roomInvitations.inbox, {})).toEqual([]);
    for (const caller of [juan, caro]) {
      expect(await errorKind(respond(caller, id))).toBe("NotFound");
    }
    expect(await errorKind(respond(t as never, id))).toBe("Unauthorized");
    for (const caller of [beto, caro]) {
      expect(
        await errorKind(
          caller.mutation(api.roomInvitations.cancel, { invitationId: id }),
        ),
      ).toBe("NotFound");
    }
    expect(await members()).toHaveLength(3);
    await juan.mutation(api.roomInvitations.cancel, { invitationId: id });
    expect(await errorKind(respond(beto, id))).toBe("AlreadyAnswered");
  });

  it("refuses a second invitation while one is pending or after the agent joined", async () => {
    const { beto, invite, invitationId } = await setup();
    await invite();
    expect(await errorKind(invite())).toBe("AlreadyInvited");
    await respond(beto, (await invitationId()) as Id<"roomInvitations">);
    expect(await errorKind(invite())).toBe("AlreadyParticipant");
  });

  it("voids a pending invitation once the friendship ends or the room closes", async () => {
    const { juan, beto, invite, invitationId, sessionId, members } =
      await setup();
    await invite();
    const id = (await invitationId()) as Id<"roomInvitations">;
    const [{ friendshipId }] = await juan.query(api.friends.list, {});
    await juan.mutation(api.friends.remove, { friendshipId });
    expect(await errorKind(respond(beto, id))).toBe("NotFriend");
    expect(await members()).toHaveLength(3);

    const { code } = await juan.mutation(api.friends.createInvite, {});
    await beto.mutation(api.friends.acceptInvite, { code });
    await juan.mutation(api.rooms.close, { sessionId });
    expect(await errorKind(respond(beto, id))).toBe("RoomNotActive");
    expect(await errorKind(invite())).toBe("RoomNotActive");
  });

  it("hides the room's blocked messages from the invited owner, except their own", async () => {
    const { juan, beto, invite, invitationId, sessionId } = await setup();
    await invite();
    await respond(beto, (await invitationId()) as Id<"roomInvitations">);
    const card = "Mi tarjeta es 4111 1111 1111 1111";
    const send = (caller: typeof juan, text: string) =>
      caller.action(api.gate.send, {
        sessionId,
        recipient: "all",
        content: { kind: "text", text },
      });
    expect(await send(juan, card)).toMatchObject({ status: "blocked" });
    expect(await send(beto, `${card}.`)).toMatchObject({ status: "blocked" });
    const texts = async (caller: typeof juan) =>
      [
        ...(await caller.query(api.gate.history, { sessionId })),
        ...(
          await caller.query(api.gate.historyPage, {
            sessionId,
            paginationOpts: { numItems: 50, cursor: null },
          })
        ).page,
      ].flatMap((m) =>
        m.status === "blocked" && m.content.kind === "text"
          ? [m.content.text]
          : [],
      );
    expect(await texts(juan)).toEqual([card, `${card}.`, card, `${card}.`]);
    expect(await texts(beto)).toEqual([`${card}.`, `${card}.`]);
  });

  it("gives a guest agent no hosted turn", async () => {
    const { t, juan, beto, invite, invitationId, sessionId } = await setup();
    await invite();
    await respond(beto, (await invitationId()) as Id<"roomInvitations">);
    const guest = (await juan.query(api.rooms.view, { sessionId }))?.session
      .participants[3].participantId as Id<"participants">;
    await juan.action(api.gate.send, {
      sessionId,
      recipient: guest,
      content: { kind: "text", text: "¿Puede Beto el jueves?" },
    });
    await t.finishAllScheduledFunctions(() => {});
    const history = await juan.query(api.gate.history, { sessionId });
    expect(history.filter((m) => m.senderParticipantId === guest)).toEqual([]);
  });
});
