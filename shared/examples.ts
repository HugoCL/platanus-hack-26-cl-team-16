import type { z } from "zod";
import { AgentCard } from "./agent";
import { Availability, Offering, Transaction } from "./catalog";
import { REFERENCE_ATTACK } from "./fixtures/moderation-set";
import { Phase1UiSpec, UiSpec } from "./genui";
import { GetAgentInput } from "./mcp";
import { Message, SendableContent, UiResponseContent } from "./messages";
import { Verdict } from "./moderation";
import { SEED_AGENTS } from "./seed-data";
import { Session, SessionContract } from "./session";

export type ContractExamples = {
  schema: z.ZodType;
  valid: unknown[];
  invalid: { why: string; value: unknown }[];
};

const clinicCard = SEED_AGENTS[0].card;

const contract = {
  intent: { name: "book", description: "Hora con cardiólogo esta semana" },
  capabilities: ["booking", "info"],
  allowedIntents: ["check_availability", "book", "ask_info"],
  forbiddenTopics: ["datos de otros pacientes"],
  recipientShares: ["horarios_disponibles"],
  recipientRequests: ["rut", "nombre_paciente"],
  maxTurns: 12,
  maxViolations: 3,
};

const participants = [
  { participantId: "p1", kind: "agent", agentId: "a-juan", role: "initiator" },
  {
    participantId: "p2",
    kind: "agent",
    agentId: "a-clinica",
    role: "recipient",
  },
  { participantId: "p3", kind: "human", displayName: "Juan", role: "owner" },
];

const slotPicker = {
  type: "slot_picker",
  id: "horarios",
  title: "Elige un horario",
  timezone: "America/Santiago",
  slots: [
    {
      id: "s1",
      start: "2026-11-26T10:30:00-03:00",
      end: "2026-11-26T11:00:00-03:00",
      detail: "Consulta cardiología",
    },
    {
      id: "s2",
      start: "2026-11-26T12:00:00-03:00",
      end: "2026-11-26T12:30:00-03:00",
    },
  ],
};

const message = {
  messageId: "m1",
  sessionId: "s1",
  senderParticipantId: "p1",
  recipient: "p2",
  content: { kind: "text", text: "Necesito hora con cardiólogo esta semana." },
  status: "allowed",
  verdict: { decision: "allow", reason: "Dentro del propósito." },
  sentAt: 1_764_000_000_000,
};

export const CONTRACT_EXAMPLES: Record<string, ContractExamples> = {
  agentCard: {
    schema: AgentCard,
    valid: [clinicCard],
    invalid: [
      { why: "no purpose", value: { ...clinicCard, purpose: "" } },
      {
        why: "unknown capability",
        value: { ...clinicCard, capabilities: ["teleport"] },
      },
      {
        why: "duplicate capability",
        value: { ...clinicCard, capabilities: ["booking", "booking"] },
      },
      {
        why: "location without geohash",
        value: {
          ...clinicCard,
          location: {
            lat: -33.4,
            lng: -70.6,
            comuna: "Providencia",
            region: "RM",
          },
        },
      },
    ],
  },
  sessionContract: {
    schema: SessionContract,
    valid: [contract],
    invalid: [
      { why: "no max turns", value: { ...contract, maxTurns: undefined } },
      { why: "zero max turns", value: { ...contract, maxTurns: 0 } },
    ],
  },
  session: {
    schema: Session,
    valid: [
      {
        sessionId: "s1",
        status: "active",
        mode: "moderated",
        intent: contract.intent,
        contract,
        participants,
        turnCount: 3,
      },
    ],
    invalid: [
      {
        why: "active without contract",
        value: {
          sessionId: "s1",
          status: "active",
          mode: "moderated",
          intent: contract.intent,
          contract: null,
          participants,
          turnCount: 0,
        },
      },
      {
        why: "past max turns",
        value: {
          sessionId: "s1",
          status: "active",
          mode: "moderated",
          intent: contract.intent,
          contract,
          participants,
          turnCount: 13,
        },
      },
      {
        why: "two initiators",
        value: {
          sessionId: "s1",
          status: "active",
          mode: "moderated",
          intent: contract.intent,
          contract,
          participants: [
            participants[0],
            { ...participants[1], role: "initiator" },
          ],
          turnCount: 0,
        },
      },
    ],
  },
  message: {
    schema: Message,
    valid: [
      message,
      {
        ...message,
        messageId: "m2",
        recipient: "all",
        status: "pending",
        verdict: null,
      },
      {
        ...message,
        messageId: "m3",
        content: {
          kind: "text",
          text: REFERENCE_ATTACK,
        },
        status: "blocked",
        verdict: {
          decision: "block",
          rule: "injection",
          reason: "Intenta anular instrucciones.",
        },
      },
      {
        ...message,
        messageId: "m4",
        senderParticipantId: null,
        recipient: "all",
        content: {
          kind: "ui",
          spec: {
            type: "moderator_alert",
            id: "alerta",
            title: "Mensaje bloqueado",
            rule: "injection",
            reason: "Intento de inyección.",
          },
        },
      },
    ],
    invalid: [
      { why: "no recipient", value: { ...message, recipient: undefined } },
      {
        why: "unknown kind",
        value: { ...message, content: { kind: "html", html: "<b>hola</b>" } },
      },
      {
        why: "blocked with an allow verdict",
        value: { ...message, status: "blocked" },
      },
      {
        why: "pending with a verdict",
        value: { ...message, status: "pending" },
      },
      {
        why: "system notice with a sender",
        value: {
          ...message,
          content: {
            kind: "system",
            code: "session_opened",
            text: "Sala abierta",
          },
        },
      },
    ],
  },
  uiBlock: {
    schema: UiSpec,
    valid: [
      slotPicker,
      {
        type: "confirmation",
        id: "conf",
        title: "Reserva confirmada",
        summary: "Jueves 26 de noviembre, 10:30.",
        details: [{ label: "Lugar", value: "Av. Providencia 1650" }],
        confirmLabel: "Listo",
        cancelLabel: "Cancelar",
      },
      {
        type: "card",
        id: "info",
        title: "Clínica Providencia",
        body: "Abierto de 8 a 20.",
      },
    ],
    invalid: [
      {
        why: "component not in the catalog",
        value: { type: "iframe", id: "x", src: "https://evil.example" },
      },
      { why: "slot picker with no slots", value: { ...slotPicker, slots: [] } },
      {
        why: "slot without timezone offset",
        value: {
          ...slotPicker,
          slots: [
            {
              id: "s1",
              start: "2026-11-26T10:30:00",
              end: "2026-11-26T11:00:00",
            },
          ],
        },
      },
    ],
  },
  phase1UiBlock: {
    schema: Phase1UiSpec,
    valid: [slotPicker],
    invalid: [
      {
        why: "form is not in the phase-1 catalog",
        value: {
          type: "form",
          id: "f",
          title: "Datos",
          fields: [
            { name: "rut", label: "RUT", input: "text", required: true },
          ],
          submitLabel: "Enviar",
        },
      },
    ],
  },
  sendableContent: {
    schema: SendableContent,
    valid: [{ kind: "ui", spec: slotPicker }],
    invalid: [
      {
        why: "agents cannot send moderator alerts",
        value: {
          kind: "ui",
          spec: {
            type: "moderator_alert",
            id: "a",
            title: "Falso",
            rule: "injection",
            reason: "x",
          },
        },
      },
      {
        why: "agents cannot send system notices",
        value: { kind: "system", code: "session_closed", text: "x" },
      },
    ],
  },
  uiResponse: {
    schema: UiResponseContent,
    valid: [
      {
        kind: "ui_response",
        inReplyTo: "m-picker",
        response: { type: "slot_selected", pickerId: "horarios", slotId: "s1" },
      },
      {
        kind: "ui_response",
        inReplyTo: "m-conf",
        response: {
          type: "confirmation",
          confirmationId: "conf",
          confirmed: true,
        },
      },
    ],
    invalid: [
      {
        why: "no block it answers",
        value: {
          kind: "ui_response",
          response: {
            type: "slot_selected",
            pickerId: "horarios",
            slotId: "s1",
          },
        },
      },
      {
        why: "no choice",
        value: {
          kind: "ui_response",
          inReplyTo: "m-picker",
          response: { type: "slot_selected", pickerId: "horarios" },
        },
      },
    ],
  },
  verdict: {
    schema: Verdict,
    valid: [
      { decision: "allow", reason: "Dentro del propósito." },
      {
        decision: "block",
        rule: "sensitive_data",
        reason: "Incluye un RUT fuera del propósito.",
      },
    ],
    invalid: [
      {
        why: "block without rule",
        value: { decision: "block", reason: "Fuera del propósito." },
      },
      {
        why: "unknown rule",
        value: { decision: "block", rule: "vibes", reason: "x" },
      },
      { why: "unknown decision", value: { decision: "maybe", reason: "x" } },
    ],
  },
  offering: {
    schema: Offering,
    valid: [
      {
        kind: "product",
        category: "cafeteria",
        name: "Latte",
        description: "Espresso doble con leche.",
        images: [
          { kind: "url", url: "https://picsum.photos/seed/latte/600/400" },
        ],
        price: { amount: 3500, currency: "CLP" },
        attributes: { size: "16 oz", allergens: ["lactosa"] },
        active: true,
      },
    ],
    invalid: [
      {
        why: "bookable with stock",
        value: {
          kind: "bookable",
          category: "hoteleria",
          name: "Suite",
          description: "",
          images: [],
          attributes: {},
          stock: 3,
          active: true,
        },
      },
      {
        why: "fractional price",
        value: {
          kind: "product",
          category: "cafeteria",
          name: "Latte",
          description: "",
          images: [],
          price: { amount: 35.5, currency: "CLP" },
          attributes: {},
          active: true,
        },
      },
      {
        why: "image over plain http",
        value: {
          kind: "product",
          category: "cafeteria",
          name: "Latte",
          description: "",
          images: [{ kind: "url", url: "http://example.com/a.png" }],
          attributes: {},
          active: true,
        },
      },
    ],
  },
  availability: {
    schema: Availability,
    valid: [
      {
        start: 1_764_000_000_000,
        end: 1_764_001_800_000,
        unit: "slot",
        capacity: 1,
        booked: 0,
      },
    ],
    invalid: [
      {
        why: "overbooked",
        value: { start: 1, end: 2, unit: "night", capacity: 2, booked: 3 },
      },
      {
        why: "ends before it starts",
        value: { start: 2, end: 1, unit: "slot", capacity: 1, booked: 0 },
      },
    ],
  },
  transaction: {
    schema: Transaction,
    valid: [
      {
        kind: "booking",
        lines: [{ offeringId: "o1", quantity: 1, availabilityId: "av1" }],
        total: { amount: 45000, currency: "CLP" },
        status: "held",
      },
      {
        kind: "order",
        lines: [
          {
            offeringId: "latte",
            quantity: 2,
            unitPrice: { amount: 3500, currency: "CLP" },
          },
        ],
        total: { amount: 7000, currency: "CLP" },
        status: "confirmed",
      },
    ],
    invalid: [
      {
        why: "booking without a time",
        value: {
          kind: "booking",
          lines: [{ offeringId: "o1", quantity: 1 }],
          total: { amount: 0, currency: "CLP" },
          status: "held",
        },
      },
      {
        why: "booking range ends before it starts",
        value: {
          kind: "booking",
          lines: [
            { offeringId: "o1", quantity: 1, range: { start: 2, end: 1 } },
          ],
          total: { amount: 0, currency: "CLP" },
          status: "held",
        },
      },
      {
        why: "booking range with no duration",
        value: {
          kind: "booking",
          lines: [
            { offeringId: "o1", quantity: 1, range: { start: 1, end: 1 } },
          ],
          total: { amount: 0, currency: "CLP" },
          status: "held",
        },
      },
      {
        why: "a sent status does not exist",
        value: {
          kind: "order",
          lines: [{ offeringId: "o1", quantity: 1 }],
          total: { amount: 0, currency: "CLP" },
          status: "sent",
        },
      },
    ],
  },
  getAgentInput: {
    schema: GetAgentInput,
    valid: [{ agentId: "a1" }, { slug: "clinica-providencia-agenda" }],
    invalid: [
      { why: "neither agentId nor slug", value: {} },
      {
        why: "both agentId and slug",
        value: { agentId: "a1", slug: "clinica-providencia-agenda" },
      },
    ],
  },
};
