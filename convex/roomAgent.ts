import type { Message, SendableContent } from "../shared/messages";
import {
  createFakeLlmProvider,
  type LlmProvider,
} from "../shared/providers/llm";
import type { SessionContract } from "../shared/session";

const ACK = "Recibido.";

export interface RoomAgent {
  reply(input: {
    message: Message;
    contract: SessionContract;
    history: Message[];
    llm: Pick<LlmProvider, "generateText">;
  }): Promise<SendableContent | null>;
}

export const testRoomAgent: RoomAgent = {
  async reply({ message, llm }) {
    if (message.content.kind === "text" && message.content.text === ACK) {
      return null;
    }
    return {
      kind: "text",
      text: await llm.generateText({
        role: "agent",
        prompt: "Acknowledge the message.",
      }),
    };
  },
};

export const fakeRoomLlm = createFakeLlmProvider({ text: () => ACK });
