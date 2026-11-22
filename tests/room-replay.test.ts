import { describe, expect, it } from "vitest";
import { Message } from "../shared/messages";
import {
  REPLAY_CONTRACT,
  REPLAY_PARTICIPANTS,
  REPLAY_SCRIPT,
} from "../src/components/landing/room-replay-script";
import { buildReplayFrames } from "../src/components/landing/room-replay-timeline";
import { liveAnswers } from "../src/components/room/live-room";
import {
  countAgentTurns,
  countViolations,
  sessionEnd,
} from "../src/components/room/room-format";

const frames = buildReplayFrames(REPLAY_SCRIPT);
const last = frames.at(-1)?.messages ?? [];

describe("landing room replay", () => {
  it("scripts valid messages from known participants", () => {
    const ids = new Set(REPLAY_PARTICIPANTS.map((p) => p.participantId));
    for (const { message } of REPLAY_SCRIPT) {
      const { reasons, redactedText, ...rest } = message;
      expect(Message.safeParse(rest).success).toBe(true);
      if (message.senderParticipantId)
        expect(ids.has(message.senderParticipantId)).toBe(true);
    }
  });

  it("has the moderator review every agent message before it lands", () => {
    for (const { message } of REPLAY_SCRIPT) {
      if (!message.senderParticipantId) continue;
      const shown = frames.map((frame) =>
        frame.messages.find((m) => m.messageId === message.messageId),
      );
      const first = shown.findIndex(Boolean);
      expect(frames[first - 1].typing).toBe(message.senderParticipantId);
      expect(shown[first]?.status).toBe("pending");
      expect(shown.at(-1)?.status).toBe(message.status);
    }
  });

  it("never shows data before the moderator hides it", () => {
    for (const frame of frames)
      for (const m of frame.messages)
        if (m.status === "pending" && m.content.kind === "text")
          expect(m.content.text).not.toContain("9.876.543-2");
  });

  it("stays within the contract's limits and ends closed", () => {
    for (const { messages } of frames)
      expect(countViolations(messages)).toBeLessThan(
        REPLAY_CONTRACT.maxViolations,
      );
    expect(countAgentTurns(last, REPLAY_PARTICIPANTS)).toBeLessThanOrEqual(
      REPLAY_CONTRACT.maxTurns,
    );
    expect(sessionEnd(last)?.status).toBe("closed");
  });

  it("shows the injection's text struck, not an empty box", () => {
    const blocked = last.filter((m) => m.status === "blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].content).toMatchObject({ kind: "text" });
    expect(blocked[0].reasons?.[0]?.code).toBe("prompt_injection");
  });

  it("has each sibling pick the slot the clinic confirms", () => {
    const pickers = new Set(
      last.flatMap((m) =>
        m.content.kind === "ui_response" ? [m.senderParticipantId] : [],
      ),
    );
    expect(pickers).toEqual(new Set(["r-ana", "r-pedro", "r-diego"]));
    expect(liveAnswers(last)["slots-cardio"]?.response).toEqual({
      type: "slot_selected",
      pickerId: "slots-cardio",
      slotId: "s2",
    });
  });
});
