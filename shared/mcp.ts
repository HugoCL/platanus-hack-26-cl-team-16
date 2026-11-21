import { z } from "zod";
import { AgentCard } from "./agent";
import { LatLng } from "./geo";
import { Message, Recipient, SendableContent } from "./messages";
import {
  SessionContract,
  SessionIntent,
  SessionMode,
  SessionStatus,
} from "./session";

const agentId = z.string().min(1);
const sessionId = z.string().min(1);

export const AgentSummary = AgentCard.pick({
  slug: true,
  name: true,
  purpose: true,
  categories: true,
  kind: true,
  status: true,
  verified: true,
}).extend({
  agentId,
  entityName: z.string().optional(),
  comuna: z.string().optional(),
  distanceKm: z.number().optional(),
  allowedIntents: z.array(z.string()),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentDetail = AgentCard.extend({
  agentId,
  entityName: z.string().optional(),
});
export type AgentDetail = z.infer<typeof AgentDetail>;

export const SearchAgentsInput = z.object({
  query: z.string().min(1).max(300),
  category: z.string().optional(),
  near: LatLng.optional(),
  comuna: z.string().optional(),
  radiusKm: z.number().positive().max(50).default(5),
  limit: z.number().int().min(1).max(20).default(10),
});
// `truncated`: more agents matched than were returned. `unresolved`: what the query text named
// but the directory could not read (a need or a place); pass it as `category` or `comuna` instead.
export const SearchAgentsOutput = z.object({
  agents: z.array(AgentSummary),
  truncated: z.boolean(),
  unresolved: z.array(z.enum(["category", "comuna"])),
});

export const GetAgentInput = z
  .object({ agentId: agentId.optional(), slug: z.string().min(1).optional() })
  .refine(
    (input) => (input.agentId === undefined) !== (input.slug === undefined),
    { message: "pass exactly one of agentId or slug" },
  );
export const GetAgentOutput = z.object({ agent: AgentDetail });

export const OpenSessionInput = z.object({
  targetAgentId: agentId,
  intent: SessionIntent,
  mode: SessionMode.default("moderated"),
});
export const OpenSessionOutput = z.object({
  sessionId,
  status: SessionStatus,
  contract: SessionContract.nullable(),
  rejectionReason: z.string().optional(),
});

export const SendMessageInput = z.object({
  sessionId,
  recipient: Recipient.default("all"),
  content: SendableContent,
});
export const SendMessageOutput = z.object({ message: Message });

// The cursor is opaque: pass back the last `cursor` you received as `after`. It follows the room's
// commit order, so resuming from it never skips or repeats a message.
export const WaitForMessagesInput = z.object({
  sessionId,
  after: z.string().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(0).max(25000).default(20000),
});
export const WaitForMessagesOutput = z.object({
  messages: z.array(Message),
  cursor: z.string().nullable(),
  sessionStatus: SessionStatus,
});

export const CloseSessionInput = z.object({
  sessionId,
  reason: z.string().max(500).optional(),
});
export const CloseSessionOutput = z.object({
  sessionId,
  status: SessionStatus,
});

export const MCP_TOOLS = {
  search_agents: {
    description:
      "Search the agent directory by need, category and Santiago comuna. Distance search (near, radiusKm) is not available yet.",
    input: SearchAgentsInput,
    output: SearchAgentsOutput,
  },
  get_agent: {
    description:
      "Get one agent's declared purpose, structured scope and connection details. Pass its agentId or its slug, not both.",
    input: GetAgentInput,
    output: GetAgentOutput,
  },
  open_session: {
    description:
      "Open a session with an agent for a declared intent. Moderated sessions get a contract derived from the target's scope.",
    input: OpenSessionInput,
    output: OpenSessionOutput,
  },
  send_message: {
    description:
      "Send a message into a session. In moderated sessions it is delivered only after the moderator allows it.",
    input: SendMessageInput,
    output: SendMessageOutput,
  },
  wait_for_messages: {
    description:
      "Long-poll for messages delivered to you in a session after a cursor.",
    input: WaitForMessagesInput,
    output: WaitForMessagesOutput,
  },
  close_session: {
    description: "Close a session you participate in.",
    input: CloseSessionInput,
    output: CloseSessionOutput,
  },
} as const;
export type McpToolName = keyof typeof MCP_TOOLS;
