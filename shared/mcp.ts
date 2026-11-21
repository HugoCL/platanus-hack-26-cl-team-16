import { z } from "zod";
import { LatLng } from "./geo";
import { MessageContent, SendableContent } from "./messages";
import { MessageModeration } from "./moderation";
import { AgentEndpoint, AgentKind, AgentScope, AgentStatus } from "./scope";
import {
  SessionContract,
  SessionIntent,
  SessionMode,
  SessionStatus,
} from "./session";

const agentId = z.string().min(1);
const sessionId = z.string().min(1);
const messageId = z.string().min(1);

export const AgentSummary = z.object({
  agentId,
  slug: z.string(),
  name: z.string(),
  purpose: z.string(),
  categories: z.array(z.string()),
  kind: AgentKind,
  status: AgentStatus,
  entityName: z.string().optional(),
  comuna: z.string().optional(),
  distanceKm: z.number().optional(),
  allowedIntents: z.array(z.string()),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentDetail = AgentSummary.extend({
  description: z.string(),
  scope: AgentScope,
  endpoint: AgentEndpoint.optional(),
  publicKey: z.string().optional(),
  location: LatLng.extend({ address: z.string().optional() }).optional(),
});
export type AgentDetail = z.infer<typeof AgentDetail>;

export const DeliveredMessage = z.object({
  messageId,
  sessionId,
  senderAgentId: agentId.optional(),
  senderName: z.string(),
  sentAt: z.number(),
  content: MessageContent,
  moderation: MessageModeration.pick({ status: true, reasons: true }),
});
export type DeliveredMessage = z.infer<typeof DeliveredMessage>;

export const SearchAgentsInput = z.object({
  query: z.string().min(1).max(300),
  category: z.string().optional(),
  near: LatLng.optional(),
  comuna: z.string().optional(),
  radiusKm: z.number().positive().max(50).default(5),
  limit: z.number().int().min(1).max(20).default(10),
});
export const SearchAgentsOutput = z.object({ agents: z.array(AgentSummary) });

export const GetAgentInput = z.union([
  z.object({ agentId }),
  z.object({ slug: z.string().min(1) }),
]);
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
  content: SendableContent,
});
export const SendMessageOutput = z.object({
  messageId,
  moderation: MessageModeration.pick({ status: true, reasons: true }),
});

export const WaitForMessagesInput = z.object({
  sessionId,
  after: z.number().optional(),
  timeoutMs: z.number().int().min(0).max(25000).default(20000),
});
export const WaitForMessagesOutput = z.object({
  messages: z.array(DeliveredMessage),
  cursor: z.number(),
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
      "Search the agent directory by need, category and location (Santiago comunas or lat/lng).",
    input: SearchAgentsInput,
    output: SearchAgentsOutput,
  },
  get_agent: {
    description:
      "Get one agent's declared purpose, structured scope and connection details.",
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
