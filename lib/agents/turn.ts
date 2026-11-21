import {
  MAX_TEXT_LENGTH,
  type Message,
  type Recipient,
  type SendableContent,
} from "../../shared/messages";
import { DELIVERABLE_STATUSES } from "../../shared/moderation";
import type { Participant, SessionContract } from "../../shared/session";

export const PROMPT_HISTORY_SIZE = 12;

// What a room hands an agent when it asks for its turn. `history` is what the agent can see,
// in order; `incoming` is the message it answers.
export type AgentTurn = {
  self: string;
  contract: SessionContract;
  participants: Participant[];
  history: Message[];
  incoming: Message;
};

// What the agent wants the room to do, in order. Every send goes through the room's moderation.
export type AgentAction =
  | { kind: "send"; recipient: Recipient; content: SendableContent }
  | { kind: "close" };

export const sendText = (recipient: string, text: string): AgentAction => ({
  kind: "send",
  recipient,
  content: { kind: "text", text: text.slice(0, MAX_TEXT_LENGTH) },
});

export const agentWithRole = (
  participants: Participant[],
  role: "initiator" | "recipient",
) => participants.find((p) => p.kind === "agent" && p.role === role);

export const humanOwner = (participants: Participant[]) =>
  participants.find((p) => p.kind === "human" && p.role === "owner");

export const delivered = (history: Message[]) =>
  history.filter((m) => DELIVERABLE_STATUSES.includes(m.status));

// Room data for a prompt: JSON with "<" escaped, so nothing in it can close a prompt tag.
export const data = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

function label(turn: AgentTurn, id: string | null): string {
  if (id === null) return "plataforma";
  if (id === "all") return "todos";
  if (id === turn.self) return "tú";
  const participant = turn.participants.find((p) => p.participantId === id);
  if (!participant) return "desconocido";
  if (participant.kind === "human") return `humano ${participant.displayName}`;
  return participant.role === "initiator"
    ? "agente consumidor"
    : "agente proveedor";
}

export const describeMessage = (turn: AgentTurn, message: Message) =>
  `[${label(turn, message.senderParticipantId)} → ${label(turn, message.recipient)}] ${data(message.content)}`;

// The recent room as prompt lines, without the message being answered.
export const transcript = (turn: AgentTurn) =>
  delivered(turn.history)
    .filter((m) => m.messageId !== turn.incoming.messageId)
    .slice(-PROMPT_HISTORY_SIZE)
    .map((m) => describeMessage(turn, m));
