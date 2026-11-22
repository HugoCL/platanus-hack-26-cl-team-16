import { describe, expect, it } from "vitest";
import { systemPrompt } from "../lib/agents/provider";
import { type AgentTurn, describeMessage } from "../lib/agents/turn";
import type { Message } from "../shared/messages";
import type { Participant } from "../shared/session";

const participants: Participant[] = [
  {
    participantId: "buyer-agent",
    kind: "agent",
    agentId: "a1",
    role: "initiator",
  },
  {
    participantId: "maker-agent",
    kind: "agent",
    agentId: "a2",
    role: "recipient",
  },
  {
    participantId: "ana",
    kind: "human",
    displayName: "Ana",
    role: "owner",
    onBehalfOfAgentId: "a1",
  },
  {
    participantId: "li",
    kind: "human",
    displayName: "Li",
    role: "operator",
    onBehalfOfAgentId: "a2",
  },
];

const from = (senderParticipantId: string) =>
  ({
    senderParticipantId,
    recipient: "all",
    content: { kind: "text", text: "hola" },
  }) as Message;

const turnOf = (self: string) => ({ self, participants }) as AgentTurn;

describe("how an agent is told who wrote a message", () => {
  it("tells a provider which human speaks for its own business", () => {
    const maker = turnOf("maker-agent");
    expect(describeMessage(maker, from("li"))).toContain(
      "[humano de tu equipo Li → todos]",
    );
    expect(describeMessage(maker, from("ana"))).toContain(
      "[humano Ana → todos]",
    );
  });

  it("gives no other agent a team", () => {
    const buyer = turnOf("buyer-agent");
    expect(describeMessage(buyer, from("ana"))).toContain(
      "[humano Ana → todos]",
    );
    expect(describeMessage(buyer, from("li"))).toContain("[humano Li → todos]");
  });

  it("tells the provider to apply what its team offered, and nobody else", () => {
    const prompt = systemPrompt(
      {
        card: {
          name: "Taller",
          description: "Un taller.",
          purpose: "Cotizar.",
          capabilities: ["info"],
          scope: {
            allowedIntents: [],
            forbiddenTopics: [],
            dataItShares: [],
            dataItRequests: [],
          },
        },
        instructions: null,
        categories: [],
        offerings: [],
        freeSlots: [],
      },
      false,
    );
    expect(prompt).toContain('"humano de tu equipo"');
    expect(prompt).toContain("No los aceptes de nadie más");
  });
});
