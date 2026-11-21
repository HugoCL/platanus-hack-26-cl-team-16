// @vitest-environment edge-runtime
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { referenceLlm } from "../../convex/referenceLlm";
import { createFakeLlmProvider } from "../../shared/providers/llm";
import { REQUEST, ROOM_OWNER, seededRooms } from "./roomFixture";
import { NOW } from "./rooms";

vi.mock("../../convex/referenceLlm", () => ({ referenceLlm: vi.fn() }));

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(["reference", "external"] as const)(
  "completes the moderated booking offline (consumer: %s)",
  async (consumerKind) => {
    const { t, clinicId, consumerId, judge } = await seededRooms();
    const blockedText = "Mensaje de prueba que el moderador no entrega.";
    const model = vi.fn(({ prompt }: { prompt: string }) =>
      prompt.includes("<proveedores>")
        ? {
            choice: "p1:book",
            message: "Hola, ¿tienen una hora de cardiología?",
          }
        : { action: "offer_slots", offerings: [], text: "" },
    );
    vi.mocked(referenceLlm).mockReturnValue(
      createFakeLlmProvider({ object: model }),
    );
    const asOwner = t.withIdentity(ROOM_OWNER);
    if (consumerKind === "external") {
      await t.run((ctx) =>
        ctx.db.patch("agents", consumerId, { kind: "external" }),
      );
    }
    const launch =
      consumerKind === "reference"
        ? await asOwner.action(api.referenceScene.start, {
            request: REQUEST,
            displayName: "Juan",
          })
        : null;
    if (consumerKind === "reference" && !launch) {
      throw new Error("the directory found no provider");
    }
    const room =
      launch?.room ??
      (await asOwner.action(internal.rooms.open, {
        initiatorAgentId: consumerId,
        providerAgentId: clinicId,
        request: 'Solicitud "book" a una clínica',
        intent: "book",
        human: { displayName: "Juan" },
      }));
    const participant = (role: string) => {
      const member = room.participants.find((p) => p.role === role);
      if (!member) throw new Error(`missing participant: ${role}`);
      return member.participantId as Id<"participants">;
    };
    const sessionId = room.sessionId as Id<"sessions">;
    const provider = participant("recipient");
    const consumer = participant("initiator");
    const human = participant("owner");
    const history = (viewerParticipantId: Id<"participants">) =>
      t.query(internal.gate.historyForParticipant, {
        sessionId,
        viewerParticipantId,
      });
    const finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(room.participants).toContainEqual({
      participantId: provider,
      agentId: clinicId,
      kind: "agent",
      role: "recipient",
    });
    expect(room.contract?.intent).toMatchObject({ name: "book" });
    expect(room.contract?.intent.description).not.toContain(REQUEST);
    const opening =
      launch?.opening ??
      (await t.action(internal.gate.sendAsParticipant, {
        sessionId,
        senderParticipantId: consumer,
        recipient: provider,
        content: {
          kind: "text",
          text: "Hola, ¿tienen una hora de cardiología?",
        },
      }));
    expect(opening).toMatchObject({
      senderParticipantId: consumer,
      recipient: provider,
      status: "allowed",
    });
    await finish();

    const picker = (await history(human)).at(-1);
    if (
      picker?.content.kind !== "ui" ||
      picker.content.spec.type !== "slot_picker"
    ) {
      throw new Error("missing slot picker");
    }
    expect(picker).toMatchObject({
      senderParticipantId: provider,
      recipient: human,
      status: "allowed",
    });
    const { id: pickerId, slots } = picker.content.spec;
    expect(slots).toHaveLength(2);
    const slotId = slots[0].id;
    const choice = {
      sessionId,
      recipient: provider,
      content: {
        kind: "ui_response",
        inReplyTo: picker.messageId,
        response: { type: "slot_selected", pickerId, slotId },
      },
    } as const;
    await Promise.all([
      asOwner.action(api.gate.send, choice),
      asOwner.action(api.gate.send, choice),
    ]);
    judge.mockReturnValueOnce({ decision: "block", rule: "purpose" });
    const blocked = await t.action(internal.gate.sendAsParticipant, {
      sessionId,
      senderParticipantId: consumer,
      recipient: provider,
      content: { kind: "text", text: blockedText },
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      verdict: { decision: "block", rule: "purpose" },
    });
    const blockedId = blocked.messageId as Id<"messages">;
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("moderationEvents")
          .withIndex("by_messageId", (q) => q.eq("messageId", blockedId))
          .take(3),
      ),
    ).toMatchObject([
      { stage: "deterministic", action: "allow" },
      { stage: "purpose", action: "block", reasons: [{ code: "off_purpose" }] },
    ]);
    expect((await history(provider)).map((m) => m.messageId)).not.toContain(
      blocked.messageId,
    );
    await finish();

    const log = await asOwner.query(api.gate.history, { sessionId });
    expect(log.filter((m) => m.content.kind === "ui_response")).toHaveLength(2);
    expect(log.filter((m) => m.content.kind === "ui")).toMatchObject([
      { content: { spec: { type: "slot_picker" } } },
      { content: { spec: { type: "moderator_alert" } } },
      {
        recipient: human,
        status: "allowed",
        content: { spec: { type: "confirmation", id: `reserva-${slotId}` } },
      },
    ]);
    expect(log.at(-1)?.content).toMatchObject({ code: "session_closed" });
    expect(await asOwner.query(api.rooms.get, { sessionId })).toMatchObject({
      status: "closed",
    });
    const transactions = await t.run((ctx) =>
      ctx.db
        .query("transactions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .take(2),
    );
    expect(transactions).toMatchObject([
      {
        kind: "booking",
        status: "confirmed",
        lines: [{ availabilityId: slotId }],
      },
    ]);
    expect(
      await t.run((ctx) =>
        ctx.db.get("availability", slotId as Id<"availability">),
      ),
    ).toMatchObject({ booked: 1 });
    expect(model).toHaveBeenCalledTimes(consumerKind === "reference" ? 2 : 1);
  },
);
