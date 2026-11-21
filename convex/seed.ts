import { effectiveAllowedIntents } from "../shared/agent";
import { REFERENCE_ATTACK } from "../shared/fixtures/moderationSet";
import type { SendableContent } from "../shared/messages";
import type { ModerationReason } from "../shared/moderation";
import { checkRules } from "../shared/moderator/rules";
import { createFixtureSource } from "../shared/providers/business";
import type { Capability } from "../shared/scope";
import {
  CLINIC_AGENT_SLUG,
  CONSUMER_AGENT_SLUG,
  SEED_AGENTS,
  SEED_AVAILABILITY,
  SEED_CATEGORIES,
  SEED_OFFERINGS,
} from "../shared/seedData";
import { DEFAULT_MAX_TURNS, type SessionContract } from "../shared/session";
import type { Id, TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { sha256Hex } from "./agentKeys";
import { loadSession } from "./roomState";

// Local deployments start empty, so every table needs sample data to develop against.
//
// RULE: add a table to convex/schema.ts -> add a seeder for it below. `seeders` is typed as
// Record<TableNames, Seeder>, so `pnpm typecheck` fails until every table has one.
//
// `pnpm dev` runs `seed:ensure` once at startup, before it starts watching. It only fills tables
// that are empty, so it is safe to run again. `pnpm seed` runs it by hand, `pnpm seed:reset`
// wipes and reseeds a local deployment (it refuses to run anywhere else). Both talk to the running
// deployment, so start `pnpm dev` first.
type Seeder = (ctx: MutationCtx) => Promise<void>;

const CAPABILITY_TOOLS: Record<Capability, string[]> = {
  booking: ["list_offerings", "find_availability", "book"],
  catalog: ["list_offerings"],
  ordering: ["place_order"],
  info: [],
};

const PROSPECTING_SCOPE = {
  category: "cafeteria",
  area: {
    label: "Las Condes",
    comuna: "Las Condes",
    center: { lat: -33.4116, lng: -70.5713 },
    radiusKm: 4,
  },
  limit: 20,
};

async function agentBySlug(ctx: MutationCtx, slug: string) {
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!agent) throw new Error(`seed: agent ${slug} is missing`);
  return agent;
}

async function offeringIdsByKey(ctx: MutationCtx) {
  const ids = new Map<string, Id<"offerings">>();
  for (const seed of SEED_OFFERINGS) {
    const agent = await agentBySlug(ctx, seed.agentSlug);
    const offering = await ctx.db
      .query("offerings")
      .withIndex("by_agentId_and_active", (q) =>
        q.eq("agentId", agent._id).eq("active", true),
      )
      .filter((q) => q.eq(q.field("name"), seed.offering.name))
      .first();
    if (!offering) throw new Error(`seed: offering ${seed.key} is missing`);
    ids.set(seed.key, offering._id);
  }
  return ids;
}

async function demoSession(ctx: MutationCtx) {
  const session = await ctx.db.query("sessions").first();
  if (!session) throw new Error("seed: demo session is missing");
  return session;
}

export const seeders = {
  numbers: async (ctx) => {
    for (const value of [3, 1, 4, 1, 5]) {
      await ctx.db.insert("numbers", { value });
    }
  },

  categories: async (ctx) => {
    for (const category of SEED_CATEGORIES) {
      await ctx.db.insert("categories", category);
    }
  },

  entities: async (ctx) => {
    for (const { card, entity } of SEED_AGENTS) {
      if (!entity) continue;
      await ctx.db.insert("entities", {
        name: entity.name,
        slug: card.slug,
        description: card.description,
        category: card.categories[0],
        location: card.location,
        contact: entity.contact,
        verification: card.verified ? "verified" : "unverified",
      });
    }
  },

  agents: async (ctx) => {
    for (const { card, entity } of SEED_AGENTS) {
      const entityDoc = entity
        ? await ctx.db
            .query("entities")
            .withIndex("by_slug", (q) => q.eq("slug", card.slug))
            .unique()
        : null;
      await ctx.db.insert("agents", {
        ...card,
        entityId: entityDoc?._id,
        primaryCategory: card.categories[0],
        searchText: [
          card.name,
          card.description,
          card.purpose,
          card.categories.join(" "),
          card.location?.comuna,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
  },

  agentApiKeys: async (ctx) => {
    const agent = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
    const unknowableKey = crypto.randomUUID();
    await ctx.db.insert("agentApiKeys", {
      agentId: agent._id,
      keyHash: await sha256Hex(unknowableKey),
      prefix: unknowableKey.slice(0, 8),
      label: "seed (revoked, never usable)",
      revokedAt: Date.now(),
    });
  },

  hostedAgentConfigs: async (ctx) => {
    for (const { card } of SEED_AGENTS) {
      if (card.kind !== "hosted" || card.status !== "active") continue;
      const agent = await agentBySlug(ctx, card.slug);
      const isConsumer = card.capabilities.length === 0;
      await ctx.db.insert("hostedAgentConfigs", {
        agentId: agent._id,
        systemPrompt: isConsumer
          ? `Eres ${card.name}. ${card.purpose} No compartas más datos de los necesarios.`
          : `Eres el agente de ${card.name}. ${card.purpose} Responde solo dentro de tu alcance.`,
        tools: isConsumer
          ? ["search_agents", "open_session", "send_message"]
          : [
              ...new Set(
                card.capabilities.flatMap((cap) => CAPABILITY_TOOLS[cap]),
              ),
            ],
      });
    }
  },

  offerings: async (ctx) => {
    for (const seed of SEED_OFFERINGS) {
      const agent = await agentBySlug(ctx, seed.agentSlug);
      await ctx.db.insert("offerings", {
        agentId: agent._id,
        ...seed.offering,
      });
    }
  },

  availability: async (ctx) => {
    const offeringIds = await offeringIdsByKey(ctx);
    for (const seed of SEED_AVAILABILITY) {
      const offeringId = offeringIds.get(seed.offeringKey);
      const offering = offeringId ? await ctx.db.get(offeringId) : null;
      if (!offering)
        throw new Error(`seed: offering ${seed.offeringKey} is missing`);
      await ctx.db.insert("availability", {
        offeringId: offering._id,
        agentId: offering.agentId,
        ...seed.availability,
      });
    }
  },

  sessions: async (ctx) => {
    const consumer = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
    const clinic = await agentBySlug(ctx, CLINIC_AGENT_SLUG);
    const intent = {
      name: "book",
      description: "Hora con cardiólogo esta semana en Providencia",
    };
    const contract: SessionContract = {
      intent,
      purpose: clinic.purpose,
      capabilities: clinic.capabilities,
      allowedIntents: effectiveAllowedIntents(clinic),
      forbiddenTopics: clinic.scope.forbiddenTopics,
      recipientShares: clinic.scope.dataItShares,
      recipientRequests: clinic.scope.dataItRequests,
      maxTurns: DEFAULT_MAX_TURNS,
      maxViolations: 3,
    };
    await ctx.db.insert("sessions", {
      initiatorAgentId: consumer._id,
      intent,
      contract,
      mode: "moderated",
      status: "active",
      turnCount: 4,
      violationCount: 1,
    });
  },

  participants: async (ctx) => {
    const session = await demoSession(ctx);
    const consumer = await agentBySlug(ctx, CONSUMER_AGENT_SLUG);
    const clinic = await agentBySlug(ctx, CLINIC_AGENT_SLUG);
    await ctx.db.insert("participants", {
      sessionId: session._id,
      kind: "agent",
      agentId: consumer._id,
      role: "initiator",
    });
    await ctx.db.insert("participants", {
      sessionId: session._id,
      kind: "agent",
      agentId: clinic._id,
      role: "recipient",
    });
    await ctx.db.insert("participants", {
      sessionId: session._id,
      kind: "human",
      tokenIdentifier: "seed|juan",
      displayName: "Juan",
      role: "owner",
      onBehalfOfAgentId: consumer._id,
    });
  },

  messages: async (ctx) => {
    const session = await demoSession(ctx);
    const clinic = await agentBySlug(ctx, CLINIC_AGENT_SLUG);
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
      .take(10);
    const role = (r: string) => {
      const found = participants.find((p) => p.role === r);
      if (!found) throw new Error(`seed: participant ${r} is missing`);
      return found._id;
    };
    const allowed = (reason: string) => ({
      status: "allowed" as const,
      verdict: { decision: "allow" as const, reason },
      reasons: [],
    });
    const slots = await ctx.db
      .query("availability")
      .withIndex("by_agentId_and_start", (q) => q.eq("agentId", clinic._id))
      .take(2);
    const options = await Promise.all(
      slots.map(async (slot) => {
        const offering = await ctx.db.get(slot.offeringId);
        return {
          id: slot._id,
          start: new Date(slot.start).toISOString(),
          end: new Date(slot.end).toISOString(),
          detail: offering?.name,
        };
      }),
    );

    await ctx.db.insert("messages", {
      sessionId: session._id,
      recipient: "all",
      content: {
        kind: "system",
        code: "session_opened",
        text: "Sala abierta para reservar una hora de cardiología.",
      },
      moderation: allowed("Aviso del sistema."),
    });
    await ctx.db.insert("messages", {
      sessionId: session._id,
      senderParticipantId: role("initiator"),
      recipient: role("recipient"),
      content: {
        kind: "text",
        text: "Necesito una hora con cardiólogo esta semana.",
      },
      moderation: allowed("Pide horarios, dentro del propósito de la sala."),
    });
    const picker = await ctx.db.insert("messages", {
      sessionId: session._id,
      senderParticipantId: role("recipient"),
      recipient: role("owner"),
      content: {
        kind: "ui",
        spec: {
          type: "slot_picker",
          id: "horarios",
          title: "Elige un horario",
          timezone: "America/Santiago",
          slots: options,
        },
      },
      moderation: allowed("Ofrece horarios disponibles."),
    });
    await ctx.db.insert("messages", {
      sessionId: session._id,
      senderParticipantId: role("owner"),
      recipient: role("recipient"),
      content: {
        kind: "ui_response",
        inReplyTo: picker,
        response: {
          type: "slot_selected",
          pickerId: "horarios",
          slotId: options[options.length - 1].id,
        },
      },
      moderation: allowed("Respuesta del humano al selector."),
    });
    const content = {
      kind: "text",
      text: REFERENCE_ATTACK,
    } satisfies SendableContent;
    const senderId = role("initiator");
    const recipient = role("recipient");
    const room = await loadSession(ctx, session._id);
    const sender = room?.participants.find((p) => p.participantId === senderId);
    if (!room?.contract || !sender)
      throw new Error("seed: demo room context is missing");
    const findings = checkRules({
      content,
      sender,
      recipient,
      participants: room.participants,
      contract: room.contract,
      history: [],
    });
    const [first] = findings;
    if (!first)
      throw new Error("seed: the reference message must be blocked by rules");
    const blocked = await ctx.db.insert("messages", {
      sessionId: session._id,
      senderParticipantId: senderId,
      recipient,
      content,
      moderation: {
        status: "blocked",
        verdict: {
          decision: "block",
          rule: first.rule,
          reason: first.detail,
        },
        reasons: findings.map<ModerationReason>(({ code, detail }) => ({
          code,
          detail,
          stage: "deterministic",
        })),
        decidedAt: Date.now(),
      },
    });
    await ctx.db.insert("messages", {
      sessionId: session._id,
      recipient: senderId,
      content: {
        kind: "ui",
        spec: {
          type: "moderator_alert",
          id: "alerta-1",
          title: "Mensaje bloqueado",
          rule: first.rule,
          reason: first.detail,
          blockedMessageId: blocked,
        },
      },
      moderation: allowed("Alerta del moderador."),
    });
  },

  moderationEvents: async (ctx) => {
    const session = await demoSession(ctx);
    const blocked = await ctx.db
      .query("messages")
      .withIndex("by_sessionId_and_moderation_status", (q) =>
        q.eq("sessionId", session._id).eq("moderation.status", "blocked"),
      )
      .first();
    if (!blocked) throw new Error("seed: blocked demo message is missing");
    const { reasons } = blocked.moderation;
    for (const stage of new Set(reasons.map((r) => r.stage))) {
      await ctx.db.insert("moderationEvents", {
        sessionId: session._id,
        messageId: blocked._id,
        stage,
        action: "block",
        reasons: reasons.filter((r) => r.stage === stage),
      });
    }
  },

  // Starts empty on purpose: every seeded availability must stay bookable.
  transactions: async () => {},

  prospectingJobs: async (ctx) => {
    const found = await createFixtureSource().discover(PROSPECTING_SCOPE);
    await ctx.db.insert("prospectingJobs", {
      scope: PROSPECTING_SCOPE,
      status: "completed",
      found: found.length,
      created: 1,
    });
  },

  prospects: async (ctx) => {
    const job = await ctx.db.query("prospectingJobs").first();
    if (!job) throw new Error("seed: prospecting job is missing");
    const agent = await agentBySlug(ctx, "cafe-los-dominicos");
    const [business] = (
      await createFixtureSource().discover(PROSPECTING_SCOPE)
    ).filter((b) => b.name === agent.name);
    if (!business) throw new Error("seed: fixture business is missing");
    await ctx.db.insert("prospects", {
      jobId: job._id,
      business,
      extraction: {
        description: "Café de barrio con pastelería propia.",
        offer: ["café de especialidad", "pastelería", "sándwiches"],
        openingHours: "Lunes a sábado, 8:00 a 20:00",
        contact: business.contact,
      },
      agentId: agent._id,
      outreach: {
        channel: "email",
        recipient: business.contact.email ?? "sin correo",
        subject: "Ya armamos el agente de Café Los Dominicos",
        body: "Hola, armamos un agente que muestra su menú y toma pedidos para retirar. Pueden revisarlo y activarlo cuando quieran.",
        status: "draft",
      },
      status: "agent_drafted",
    });
  },
} satisfies Record<TableNames, Seeder>;

const tableNames = Object.keys(seeders) as TableNames[];

// Seeds every table that has no documents yet and leaves the others alone.
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded: TableNames[] = [];
    for (const table of tableNames) {
      if ((await ctx.db.query(table).first()) === null) {
        await seeders[table](ctx);
        seeded.push(table);
      }
    }
    console.log(
      seeded.length
        ? `seed: seeded ${seeded.join(", ")}`
        : "seed: every table already has data",
    );
    return { seeded };
  },
});

// Local deployments (`convex dev` anonymous or local) serve from the loopback address.
function isLocalDeployment() {
  const url = process.env.CONVEX_CLOUD_URL;
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  } catch {
    return false;
  }
}

// Deletes every document of every seeded table, then seeds again. Local deployments only.
// It runs in one transaction, so it suits seed-sized tables, not big ones. Everything is deleted
// first and seeded afterwards, in `seeders` order (list parents before children), so a seeder
// never sees leftover rows of a later table.
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!isLocalDeployment()) {
      throw new Error(
        "seed:reset only runs on a local deployment (CONVEX_CLOUD_URL must be localhost or 127.0.0.1)",
      );
    }
    for (const table of tableNames) {
      for await (const doc of ctx.db.query(table)) {
        await ctx.db.delete(doc._id);
      }
    }
    for (const table of tableNames) {
      await seeders[table](ctx);
    }
    console.log(`seed: reset ${tableNames.join(", ")}`);
    return { reset: tableNames };
  },
});
