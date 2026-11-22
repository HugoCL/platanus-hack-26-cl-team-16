import { describe, expect, it } from "vitest";
import { type GuestContext, guestTurn } from "../lib/agents/guest";
import type { AgentTurn } from "../lib/agents/turn";
import type { AgentCard } from "../shared/agent";
import { CONTRACT_EXAMPLES } from "../shared/examples";
import type { Message } from "../shared/messages";
import { createFakeLlmProvider } from "../shared/providers/llm";
import type { SessionContract } from "../shared/session";

const context: GuestContext = {
  card: CONTRACT_EXAMPLES.agentCard.valid[0] as AgentCard,
  instructions: null,
};

const incoming = (over: Partial<Message> = {}): Message => ({
  messageId: "m1",
  sessionId: "s1",
  senderParticipantId: "juan",
  recipient: "guest",
  content: { kind: "text", text: "¿Puede Beto el jueves?" },
  status: "allowed",
  verdict: null,
  sentAt: 1,
  ...over,
});

const turn = (message: Message): AgentTurn => ({
  self: "guest",
  contract: CONTRACT_EXAMPLES.sessionContract.valid[0] as SessionContract,
  participants: [
    { participantId: "guest", kind: "agent", agentId: "a3", role: "guest" },
    {
      participantId: "juan",
      kind: "human",
      displayName: "Juan",
      role: "owner",
    },
  ],
  history: [message],
  incoming: message,
});

function llm(action: "reply" | "wait", text = "El jueves puede a las 10.") {
  const prompts: string[] = [];
  return {
    prompts,
    llm: {
      ...createFakeLlmProvider(),
      generateObject: async (args: { system?: string; prompt: string }) => {
        prompts.push(`${args.system}\n${args.prompt}`);
        return { action, text } as never;
      },
    },
  };
}

describe("guest agent turn", () => {
  it("answers in text whoever wrote to it", async () => {
    const { llm: model, prompts } = llm("reply");
    expect(await guestTurn(turn(incoming()), context, { llm: model })).toEqual([
      {
        kind: "send",
        recipient: "juan",
        content: { kind: "text", text: "El jueves puede a las 10." },
      },
    ]);
    expect(prompts[0]).toContain("No eres el proveedor de la sala");
    expect(prompts[0]).toContain("te sacaría del propósito de la sala");
    expect(prompts[0]).toContain(
      JSON.stringify(turn(incoming()).contract.purpose),
    );
  });

  it("stays quiet when the model says the message is not for it", async () => {
    const { llm: model } = llm("wait");
    expect(await guestTurn(turn(incoming()), context, { llm: model })).toEqual(
      [],
    );
  });

  it.each([
    ["addressed to someone else", { recipient: "juan" }],
    ["its own", { senderParticipantId: "guest" }],
    ["from the platform", { senderParticipantId: null }],
    ["blocked", { status: "blocked" as const }],
  ])("skips the model for a message %s", async (_why, over) => {
    const { llm: model, prompts } = llm("reply");
    expect(
      await guestTurn(turn(incoming(over)), context, { llm: model }),
    ).toEqual([]);
    expect(prompts).toEqual([]);
  });
});
