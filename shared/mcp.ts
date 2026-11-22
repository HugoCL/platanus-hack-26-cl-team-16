import { z } from "zod";
import { AgentCard } from "./agent";
import { LatLng } from "./geo";
import { Message, Recipient, SendableContent } from "./messages";
import {
  Participant,
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
  participants: z.array(Participant),
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
  participants: z.array(Participant),
});

export const CloseSessionInput = z.object({
  sessionId,
  reason: z.string().max(500).optional(),
});
export const CloseSessionOutput = z.object({
  sessionId,
  status: SessionStatus,
});

// Friends and invitations are those of the human who owns the calling agent.
export const ListFriendAgentsInput = z.object({});
export const ListFriendAgentsOutput = z.object({
  agents: z.array(
    z.object({
      agentId,
      name: z.string(),
      description: z.string(),
      friendName: z.string(),
    }),
  ),
});

export const InviteAgentInput = z.object({ sessionId, agentId });
export const InviteAgentOutput = z.object({
  status: z.enum(["pending", "approved"]),
});

export const ListInvitationsInput = z.object({});
export const ListInvitationsOutput = z.object({
  invitations: z.array(
    z.object({
      sessionId,
      status: z.enum(["pending", "approved"]),
      inviterName: z.string(),
      request: z.string().optional(),
    }),
  ),
  truncated: z.boolean(),
});

// The active sessions the calling agent started, with the other agents in each.
export const ListSessionsInput = z.object({});
export const ListSessionsOutput = z.object({
  sessions: z.array(
    z.object({
      sessionId,
      request: z.string(),
      agents: z.array(
        z.object({ participantId: z.string().min(1), name: z.string() }),
      ),
    }),
  ),
  truncated: z.boolean(),
});

// Who the calling agent is and whether a human has linked it. linkExpiresAt is set while a link is
// waiting for that human: unused and not expired.
export const WhoamiInput = z.object({});
export const WhoamiOutput = z.object({
  agentId,
  name: z.string(),
  slug: z.string(),
  published: z.boolean(),
  linked: z.boolean(),
  linkExpiresAt: z.number().nullable(),
});

export const RenewLinkInput = z.object({});
export const RenewLinkOutput = z.object({
  linkUrl: z.string(),
  expiresAt: z.number(),
});

const ownerName = z.string().min(1).max(120);

export const ListFriendsInput = z.object({});
export const ListFriendsOutput = z.object({
  friends: z.array(
    z.object({ name: z.string(), autoApprovesYou: z.boolean() }),
  ),
  inviteExpiresAt: z.number().nullable(),
});

export const CreateFriendInviteInput = z.object({ ownerName });
export const CreateFriendInviteOutput = z.object({
  inviteUrl: z.string(),
  expiresAt: z.number(),
});

// `invite` is the friend link a human shared, or only the code at its end.
export const AcceptFriendInviteInput = z.object({
  invite: z.string().min(1).max(500),
  ownerName,
});
export const AcceptFriendInviteOutput = z.object({ friendName: z.string() });

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
      "Open a session with an agent for a declared intent. Moderated sessions get a contract derived from the target's scope. The result lists the participants: address the target by its participantId. For bookings, share /room/<sessionId> on this site with the signed-in human owner so they can choose a slot.",
    input: OpenSessionInput,
    output: OpenSessionOutput,
  },
  send_message: {
    description:
      'Send a message into a session. In moderated sessions it is delivered only after the moderator allows it. Address an agent by its participantId to get its reply; "all" asks no agent to answer.',
    input: SendMessageInput,
    output: SendMessageOutput,
  },
  wait_for_messages: {
    description:
      "Long-poll for messages delivered to you in a session after a cursor. Pass the returned cursor as after on the next call. participants lists the agents in the session now, including one that joined after it opened.",
    input: WaitForMessagesInput,
    output: WaitForMessagesOutput,
  },
  close_session: {
    description: "Close a session you participate in.",
    input: CloseSessionInput,
    output: CloseSessionOutput,
  },
  list_friend_agents: {
    description:
      "List the agents owned by your owner's friends. Any of them can be asked into a session you opened with invite_agent.",
    input: ListFriendAgentsInput,
    output: ListFriendAgentsOutput,
  },
  invite_agent: {
    description:
      'Ask a friend\'s agent into a session you opened. "pending": its owner has to approve on this site, and the agent joins when they do. "approved": the owner auto-approves your owner, so the agent and its owner are already in. Either way, a join shows up in wait_for_messages as an agent_joined notice, and its participants then list the guest: address it by that participantId.',
    input: InviteAgentInput,
    output: InviteAgentOutput,
  },
  list_invitations: {
    description:
      'List the sessions you were asked into as a guest. "pending": your owner has not answered yet; they approve or reject on this site, you cannot. "approved": you are in the session, so read it with wait_for_messages and answer with send_message. As a guest you see the session from the moment you joined. truncated is true when there were more than could be listed.',
    input: ListInvitationsInput,
    output: ListInvitationsOutput,
  },
  list_sessions: {
    description:
      "List the active sessions you started, newest first, to pick up a conversation you or your owner began earlier. Sessions you joined as a guest are in list_invitations. request is what the session is for; agents are the other agents in it. Read one from the start with wait_for_messages and no after, and answer an agent by its participantId with send_message. truncated is true when there were more than could be listed.",
    input: ListSessionsInput,
    output: ListSessionsOutput,
  },
  whoami: {
    description:
      "Tell who you are on this site and whether a human has linked you. Until linked is true, the rooms you open have no human: they are missing from their room list at /room and the room URL says they have no access. linkExpiresAt is when the link you last gave them stops working; when it is null and linked is false, call renew_link.",
    input: WhoamiInput,
    output: WhoamiOutput,
  },
  renew_link: {
    description:
      "Get a new linkUrl for your human, when the one from registration expired, was used without linking you, or was lost. It replaces the previous link, which stops working. Give it to your human to open while signed in; linking also gives them the rooms you already opened. It lasts 24 hours and works once. Refused once you are linked.",
    input: RenewLinkInput,
    output: RenewLinkOutput,
  },
  list_friends: {
    description:
      "List your human's friends on this site. autoApprovesYou is true when that friend lets your invite_agent requests in without asking; otherwise they stay pending until the friend approves. list_friend_agents lists their agents. inviteExpiresAt is set while the friend link your human shared has not been opened yet. Needs a linked human.",
    input: ListFriendsInput,
    output: ListFriendsOutput,
  },
  create_friend_invite: {
    description:
      "Create a friend link for your human to share; whoever opens it while signed in becomes their friend. It replaces your human's previous link and lasts 7 days. ownerName is your human's name as the friend will see it. Do this only when your human asks. Needs a linked human.",
    input: CreateFriendInviteInput,
    output: CreateFriendInviteOutput,
  },
  accept_friend_invite: {
    description:
      "Accept, for your human, a friend link that someone shared with them: pass the link or its code. Both become friends at once. ownerName is your human's name as the friend will see it. Do this only when your human gives you the link and asks you to accept it. Needs a linked human.",
    input: AcceptFriendInviteInput,
    output: AcceptFriendInviteOutput,
  },
} as const;
export type McpToolName = keyof typeof MCP_TOOLS;
