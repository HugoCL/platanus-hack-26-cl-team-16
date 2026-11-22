import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { AgentCard } from "../shared/agent";
import {
  AttributeDef,
  Attributes,
  AvailabilityUnit,
  Money,
  OfferingImage,
  OfferingKind,
  TimeRange,
  TransactionKind,
  TransactionStatus,
} from "../shared/catalog";
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
  AgentParticipantRole,
  HumanParticipantRole,
  SessionContract,
  SessionIntent,
  SessionMode,
  SessionStatus,
} from "../shared/session";

export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),

  categories: defineTable({
    slug: v.string(),
    parent: v.union(v.string(), v.null()),
    label: v.string(),
    attributeSchema: v.array(zodToConvex(AttributeDef)),
  })
    .index("by_slug", ["slug"])
    .index("by_parent", ["parent"]),

  entities: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.optional(zodToConvex(Location)),
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
    ...zodToConvex(AgentCard).fields,
    entityId: v.optional(v.id("entities")),
    ownerTokenIdentifier: v.optional(v.string()),
    primaryCategory: v.string(),
    selfRegistered: v.optional(v.boolean()),
    builderCreated: v.optional(v.boolean()),
    wantsPublic: v.optional(v.boolean()),
    searchText: v.string(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_slug", ["slug"])
    .index("by_entityId", ["entityId"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_status_and_primaryCategory", ["status", "primaryCategory"])
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

  agentLinkCodes: defineTable({
    agentId: v.id("agents"),
    codeHash: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  }).index("by_codeHash", ["codeHash"]),

  friendInvites: defineTable({
    codeHash: v.string(),
    inviterTokenIdentifier: v.string(),
    inviterName: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_inviterTokenIdentifier", ["inviterTokenIdentifier"]),

  // One row per direction: `autoApprove` is the owner's switch for invocations that come from
  // that friend, so each side sets its own.
  friendships: defineTable({
    ownerTokenIdentifier: v.string(),
    friendTokenIdentifier: v.string(),
    friendName: v.string(),
    autoApprove: v.boolean(),
  }).index("by_ownerTokenIdentifier_and_friendTokenIdentifier", [
    "ownerTokenIdentifier",
    "friendTokenIdentifier",
  ]),

  // A request to bring a friend's agent into a room. The agent's owner answers it, unless their
  // auto-approve for the inviter was on, in which case the row is created already approved.
  roomInvitations: defineTable({
    sessionId: v.id("sessions"),
    agentId: v.id("agents"),
    inviterTokenIdentifier: v.string(),
    inviterName: v.string(),
    ownerTokenIdentifier: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("cancelled"),
    ),
    autoApproved: v.boolean(),
  })
    .index("by_ownerTokenIdentifier_and_status", [
      "ownerTokenIdentifier",
      "status",
    ])
    .index("by_sessionId_and_status", ["sessionId", "status"]),

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

  offerings: defineTable({
    agentId: v.id("agents"),
    kind: zodToConvex(OfferingKind),
    category: v.string(),
    name: v.string(),
    description: v.string(),
    images: v.array(zodToConvex(OfferingImage)),
    price: v.optional(zodToConvex(Money)),
    attributes: zodToConvex(Attributes),
    stock: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_agentId_and_active", ["agentId", "active"])
    .index("by_category", ["category"]),

  availability: defineTable({
    offeringId: v.id("offerings"),
    agentId: v.id("agents"),
    start: v.number(),
    end: v.number(),
    unit: zodToConvex(AvailabilityUnit),
    capacity: v.number(),
    booked: v.number(),
  })
    .index("by_offeringId_and_start", ["offeringId", "start"])
    .index("by_agentId_and_start", ["agentId", "start"]),

  transactions: defineTable({
    sessionId: v.id("sessions"),
    agentId: v.id("agents"),
    kind: zodToConvex(TransactionKind),
    lines: v.array(
      v.object({
        offeringId: v.id("offerings"),
        quantity: v.number(),
        availabilityId: v.optional(v.id("availability")),
        range: v.optional(zodToConvex(TimeRange)),
        unitPrice: v.optional(zodToConvex(Money)),
      }),
    ),
    total: zodToConvex(Money),
    status: zodToConvex(TransactionStatus),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_agentId_and_status", ["agentId", "status"]),

  agentSources: defineTable({
    agentId: v.id("agents"),
    kind: v.union(v.literal("website"), v.literal("pdf"), v.literal("text")),
    label: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_agentId", ["agentId"])
    .index("by_storageId", ["storageId"]),

  hostedAgentConfigs: defineTable({
    agentId: v.id("agents"),
    systemPrompt: v.string(),
    tools: v.array(v.string()),
    temperature: v.optional(v.number()),
  }).index("by_agentId", ["agentId"]),

  sessions: defineTable({
    initiatorAgentId: v.id("agents"),
    intent: zodToConvex(SessionIntent),
    contract: v.union(
      zodToConvex(SessionContract.partial({ purpose: true })),
      v.null(),
    ),
    mode: zodToConvex(SessionMode),
    status: zodToConvex(SessionStatus),
    turnCount: v.number(),
    violationCount: v.number(),
    closedReason: v.optional(v.string()),
  })
    .index("by_initiatorAgentId_and_status", ["initiatorAgentId", "status"])
    .index("by_initiatorAgentId", ["initiatorAgentId"])
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
    .index("by_tokenIdentifier_and_leftAt", ["tokenIdentifier", "leftAt"])
    .index("by_tokenIdentifier_and_sessionId", [
      "tokenIdentifier",
      "sessionId",
    ]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    senderParticipantId: v.optional(v.id("participants")),
    recipient: v.union(v.literal("all"), v.id("participants")),
    content: zodToConvex(MessageContent),
    moderation: zodToConvex(MessageModeration),
    seq: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_seq", ["sessionId", "seq"])
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
});
