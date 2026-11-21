import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { Location } from "../shared/geo";
import { MessageContent } from "../shared/messages";
import { EMBEDDING_DIMENSIONS } from "../shared/models";
import {
  MessageModeration,
  ModerationAction,
  ModerationReason,
  ModerationStage,
} from "../shared/moderation";
import {
  BusinessCandidate,
  BusinessContact,
  OutreachDraft,
  ProspectingJobStatus,
  ProspectingScope,
  ProspectStatus,
  SiteExtraction,
} from "../shared/prospecting";
import {
  AgentEndpoint,
  AgentKind,
  AgentScope,
  AgentStatus,
} from "../shared/scope";
import {
  AgentParticipantRole,
  HumanParticipantRole,
  SessionContract,
  SessionIntent,
  SessionMode,
  SessionStatus,
} from "../shared/session";

const location = zodToConvex(Location);

export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),

  entities: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.optional(location),
    contact: zodToConvex(BusinessContact),
    verification: v.union(
      v.literal("unverified"),
      v.literal("claimed"),
      v.literal("verified"),
    ),
    ownerTokenIdentifier: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),

  agents: defineTable({
    entityId: v.optional(v.id("entities")),
    ownerTokenIdentifier: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    purpose: v.string(),
    scope: zodToConvex(AgentScope),
    categories: v.array(v.string()),
    primaryCategory: v.string(),
    location: v.optional(location),
    kind: zodToConvex(AgentKind),
    endpoint: v.optional(zodToConvex(AgentEndpoint)),
    publicKey: v.optional(v.string()),
    status: zodToConvex(AgentStatus),
    searchText: v.string(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_slug", ["slug"])
    .index("by_entityId", ["entityId"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_status_and_location_geohash", ["status", "location.geohash"])
    .index("by_status_and_location_comuna", ["status", "location.comuna"])
    .searchIndex("search_searchText", {
      searchField: "searchText",
      filterFields: ["status", "primaryCategory", "location.comuna"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["status", "primaryCategory"],
    }),

  agentApiKeys: defineTable({
    agentId: v.id("agents"),
    keyHash: v.string(),
    prefix: v.string(),
    label: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_keyHash", ["keyHash"])
    .index("by_agentId", ["agentId"]),

  sessions: defineTable({
    initiatorAgentId: v.id("agents"),
    intent: zodToConvex(SessionIntent),
    contract: v.union(zodToConvex(SessionContract), v.null()),
    mode: zodToConvex(SessionMode),
    status: zodToConvex(SessionStatus),
    violationCount: v.number(),
    closedReason: v.optional(v.string()),
  })
    .index("by_initiatorAgentId_and_status", ["initiatorAgentId", "status"])
    .index("by_status", ["status"]),

  participants: defineTable(
    v.union(
      v.object({
        sessionId: v.id("sessions"),
        kind: v.literal("agent"),
        agentId: v.id("agents"),
        role: zodToConvex(AgentParticipantRole),
        leftAt: v.optional(v.number()),
      }),
      v.object({
        sessionId: v.id("sessions"),
        kind: v.literal("human"),
        tokenIdentifier: v.string(),
        displayName: v.string(),
        role: zodToConvex(HumanParticipantRole),
        onBehalfOfAgentId: v.optional(v.id("agents")),
        leftAt: v.optional(v.number()),
      }),
    ),
  )
    .index("by_sessionId", ["sessionId"])
    .index("by_agentId_and_sessionId", ["agentId", "sessionId"])
    .index("by_tokenIdentifier_and_sessionId", [
      "tokenIdentifier",
      "sessionId",
    ]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    senderParticipantId: v.optional(v.id("participants")),
    content: zodToConvex(MessageContent),
    moderation: zodToConvex(MessageModeration),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_moderation_status", [
      "sessionId",
      "moderation.status",
    ]),

  moderationEvents: defineTable({
    sessionId: v.id("sessions"),
    messageId: v.optional(v.id("messages")),
    stage: zodToConvex(ModerationStage),
    action: zodToConvex(ModerationAction),
    reasons: v.array(zodToConvex(ModerationReason)),
    model: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_messageId", ["messageId"]),

  prospectingJobs: defineTable({
    scope: zodToConvex(ProspectingScope),
    status: zodToConvex(ProspectingJobStatus),
    requestedByTokenIdentifier: v.optional(v.string()),
    found: v.number(),
    created: v.number(),
    error: v.optional(v.string()),
  }).index("by_status", ["status"]),

  prospects: defineTable({
    jobId: v.id("prospectingJobs"),
    business: zodToConvex(BusinessCandidate),
    extraction: v.optional(zodToConvex(SiteExtraction)),
    agentId: v.optional(v.id("agents")),
    outreach: v.optional(zodToConvex(OutreachDraft)),
    status: zodToConvex(ProspectStatus),
    claimTokenHash: v.optional(v.string()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_status", ["status"])
    .index("by_business_source", [
      "business.source.provider",
      "business.source.externalId",
    ]),

  hostedAgentConfigs: defineTable({
    agentId: v.id("agents"),
    systemPrompt: v.string(),
    model: v.string(),
    tools: v.array(v.string()),
    temperature: v.optional(v.number()),
  }).index("by_agentId", ["agentId"]),
});
