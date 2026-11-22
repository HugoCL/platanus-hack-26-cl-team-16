import { describe, expect, it } from "vitest";
import { visibleTo } from "../convex/visibility";
import type { Message } from "../shared/messages";
import type { Participant } from "../shared/session";

const participants: Participant[] = [
  {
    participantId: "consumer",
    kind: "agent",
    agentId: "a1",
    role: "initiator",
  },
  {
    participantId: "provider",
    kind: "agent",
    agentId: "a2",
    role: "recipient",
  },
  {
    participantId: "juan",
    kind: "human",
    displayName: "Juan",
    role: "owner",
    onBehalfOfAgentId: "a1",
  },
  {
    participantId: "guest",
    kind: "agent",
    agentId: "a3",
    role: "guest",
    joinedAt: 100.4,
  },
  {
    participantId: "beto",
    kind: "human",
    displayName: "Beto",
    role: "owner",
    onBehalfOfAgentId: "a3",
  },
];
const [, , juan, guest, beto] = participants;

const message = (
  sender: string,
  text: string,
  sentAt: number,
  recipient = "all",
): Message => ({
  messageId: `m-${sentAt}`,
  sessionId: "s1",
  senderParticipantId: sender,
  recipient,
  content: { kind: "text", text },
  status: "allowed",
  verdict: null,
  sentAt,
});

describe("what a guest side sees", () => {
  it.each([
    ["the guest agent", guest],
    ["the human it brought", beto],
  ])("hides from %s what was said before it joined", (_who, viewer) => {
    const at = (createdAt: number) =>
      visibleTo(
        message("juan", "Hola", Math.floor(createdAt)),
        viewer,
        participants,
        createdAt,
      );
    expect(at(99)).toBe(false);
    expect(at(100.3)).toBe(false);
    expect(at(100.5)).toBe(true);
    expect(at(101)).toBe(true);
  });

  it("keeps a message from the join millisecond hidden when its exact time is unknown", () => {
    expect(visibleTo(message("juan", "Hola", 100), guest, participants)).toBe(
      false,
    );
  });

  it.each([
    ["the guest agent", guest],
    ["the human it brought", beto],
  ])("hides from %s a RUT the consumer hands the provider", (_who, viewer) => {
    const rut = message("juan", "Mi RUT es 12.345.678-5", 200, "provider");
    expect(visibleTo(rut, viewer, participants)).toBe(false);
    expect(visibleTo(rut, juan, participants)).toBe(true);
  });

  it("keeps showing the guest side its own messages", () => {
    expect(visibleTo(message("guest", "Hola", 200), beto, participants)).toBe(
      true,
    );
    expect(visibleTo(message("beto", "Hola", 200), beto, participants)).toBe(
      true,
    );
  });
});
