import { describe, expect, it } from "vitest";
import {
  MODERATION_CASES,
  MODERATION_ROOMS,
  MODERATION_SET_VERSION,
  moderationInput,
  REFERENCE_ATTACK,
} from "../shared/fixtures/moderationSet";
import { Message, SendableContent } from "../shared/messages";
import { CLINIC_AGENT_SLUG } from "../shared/seedData";
import { Participant, SessionContract } from "../shared/session";

const blocks = MODERATION_CASES.filter((c) => c.expected.decision === "block");
const allows = MODERATION_CASES.filter((c) => c.expected.decision === "allow");

describe("moderation set", () => {
  it("is versioned and has at least 10 legitimate messages and 10 attacks", () => {
    expect(Number.isInteger(MODERATION_SET_VERSION)).toBe(true);
    expect(allows.length).toBeGreaterThanOrEqual(10);
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique case ids", () => {
    const ids = MODERATION_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("blocks the reference attack as an injection", () => {
    const reference = MODERATION_CASES.filter(
      (c) =>
        c.message.content.kind === "text" &&
        c.message.content.text === REFERENCE_ATTACK,
    );
    expect(reference).toHaveLength(1);
    expect(reference[0].expected).toMatchObject({
      decision: "block",
      rule: "injection",
    });
  });

  it("has at least 4 paraphrased attacks that only the judge can catch", () => {
    const paraphrases = MODERATION_CASES.filter((c) => c.paraphrase);
    expect(paraphrases.length).toBeGreaterThanOrEqual(4);
    for (const c of paraphrases) {
      expect(c.expected).toMatchObject({ decision: "block", stage: "purpose" });
    }
  });

  it("covers the clinic and two other seed providers", () => {
    const slugs = Object.values(MODERATION_ROOMS).map((room) => {
      const provider = room.participants.find((p) => p.role === "recipient");
      return provider?.kind === "agent" ? provider.agentId : undefined;
    });
    expect(slugs).toContain(CLINIC_AGENT_SLUG);
    expect(new Set(slugs).size).toBeGreaterThanOrEqual(3);
    const roomsUsed = new Set(MODERATION_CASES.map((c) => c.room));
    expect(roomsUsed.size).toBe(Object.keys(MODERATION_ROOMS).length);
  });

  it.each(Object.entries(MODERATION_ROOMS))(
    "room %s has a valid contract and participants",
    (_key, room) => {
      expect(SessionContract.safeParse(room.contract).error).toBeUndefined();
      for (const p of room.participants) {
        expect(Participant.safeParse(p).error).toBeUndefined();
      }
    },
  );

  it.each(MODERATION_CASES.map((c) => [c.id, c] as const))(
    "%s is a valid moderator input",
    (_id, c) => {
      const input = moderationInput(c);
      expect(SendableContent.safeParse(input.content).error).toBeUndefined();
      for (const m of input.history) {
        expect(Message.safeParse(m).error).toBeUndefined();
      }
      const ids = input.participants.map((p) => p.participantId);
      expect(ids).toContain(input.sender.participantId);
      expect(input.recipient).not.toBe(input.sender.participantId);
      expect([...ids, "all"]).toContain(input.recipient);
      if (input.content.kind === "ui_response") {
        const { inReplyTo } = input.content;
        expect(input.history.map((m) => m.messageId)).toContain(inReplyTo);
      }
    },
  );
});
