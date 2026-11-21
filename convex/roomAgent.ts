import type { Message, Recipient, SendableContent } from "../shared/messages";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../shared/providers/llm";
import { CONSUMER_AGENT_SLUG } from "../shared/seed-data";
import type { Participant, SessionContract } from "../shared/session";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { referenceConsumer, referenceProvider } from "./referenceAgents";
import { referenceLlm } from "./referenceLlm";

const ACK = "Recibido.";

// What a room agent asks the room to do, in order. The gate sends each message with the agent as
// sender, through moderation, and closes the room like `rooms.close`. The actions after a send
// the moderator blocked are dropped, and so is a whole reply that addresses someone outside the
// room.
export type RoomAgentAction =
  | { kind: "send"; recipient: Recipient; content: SendableContent }
  | { kind: "close" };

// An agent gets data and a model, never the action context: everything it writes goes through
// its actions. `roomAgentFor` binds any narrower port an agent needs.
export interface RoomAgent {
  reply(input: {
    self: string;
    message: Message;
    contract: SessionContract;
    participants: Participant[];
    history: Message[];
    llm: LlmProvider;
  }): Promise<RoomAgentAction[]>;
}

export const testRoomAgent: RoomAgent = {
  async reply({ message, llm }) {
    const sender = message.senderParticipantId;
    if (
      !sender ||
      (message.content.kind === "text" && message.content.text === ACK)
    ) {
      return [];
    }
    const text = await llm.generateText({
      role: "agent",
      prompt: "Acknowledge the message.",
    });
    return [
      { kind: "send", recipient: sender, content: { kind: "text", text } },
    ];
  },
};

export const fakeRoomLlm = createFakeLlmProvider({ text: () => ACK });

export function roomAgentFor(
  agent: Doc<"agents">,
  ctx: ActionCtx,
): {
  agent: RoomAgent;
  llm: LlmProvider;
} {
  const llm = referenceLlm();
  if (!llm) return { agent: testRoomAgent, llm: fakeRoomLlm };
  return {
    agent:
      agent.slug === CONSUMER_AGENT_SLUG
        ? referenceConsumer
        : referenceProvider(ctx, agent._id),
    llm,
  };
}
