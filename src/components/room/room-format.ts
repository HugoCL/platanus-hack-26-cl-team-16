import type { z } from "zod";
import type { SlotPickerSpec, UiResponse, UiSpec } from "@/shared/genui";
import type { Message } from "@/shared/messages";
import type {
  ModerationReason,
  ModerationReasonCode,
  ModerationStage,
  ModerationStatus,
} from "@/shared/moderation";
import type { SessionStatus } from "@/shared/session";

export const SANTIAGO = "America/Santiago";

export type RoomMessage = Message & {
  reasons?: ModerationReason[];
  redactedText?: string;
  audit?: { model: string; latencyMs: number };
};

export type RoomParticipant = {
  participantId: string;
  name: string;
  side: "self" | "other";
  kind: "agent" | "human";
  verified?: boolean;
  onBehalfOf?: string;
};

export type Viewer = {
  role: "owner" | "observer" | "operator";
  ownParticipantIds: string[];
};

const INTENT_LABELS: Record<string, string> = {
  book: "Agendar hora",
  check_availability: "Ver disponibilidad",
  cancel_booking: "Cancelar hora",
  ask_info: "Responder consultas",
  browse_catalog: "Ver catálogo",
  request_quote: "Pedir cotización",
  place_order: "Hacer un pedido",
};

export function intentLabel(name: string) {
  const label = INTENT_LABELS[name];
  if (label) return label;
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DATA_FIELD_LABELS: Record<string, string> = {
  rut: "RUT",
  nombre: "Nombre",
  nombre_paciente: "Nombre",
  telefono: "Teléfono",
  direccion: "Dirección",
  precios: "Precios",
  especialidades: "Especialidades",
  horarios_disponibles: "Horarios disponibles",
};

export function dataFieldLabel(field: string) {
  return DATA_FIELD_LABELS[field] ?? intentLabel(field);
}

export const REASON_LABELS: Record<ModerationReasonCode, string> = {
  size_limit: "Mensaje demasiado largo",
  rate_limit: "Demasiados mensajes",
  url: "Enlace externo",
  pii: "Dato personal (PII)",
  malformed_payload: "Formato inválido",
  prompt_injection: "Inyección de instrucciones",
  off_purpose: "Fuera del propósito",
  forbidden_topic: "Tema prohibido",
  data_leak: "Fuga de datos",
  repeated_violations: "Bloqueos repetidos",
  moderator_error: "Error del moderador",
};

export const STAGE_LABELS: Record<ModerationStage, string> = {
  deterministic: "Filtros",
  injection: "Inyección",
  purpose: "Propósito",
};

// What the moderator ruled, as a word. The shield, its panel and the room audit share it.
export const STATUS_LABELS: Record<ModerationStatus, string> = {
  pending: "Revisando…",
  allowed: "Aprobado",
  redacted: "Editado",
  blocked: "Bloqueado",
  escalated: "Requiere aprobación",
};

// The rule a moderator alert cites, in words. The code stays in the message audit.
const RULE_LABELS: Record<string, string> = {
  purpose: "Fuera del propósito",
  scope: "Fuera del contrato",
  injection: "Inyección de instrucciones",
  sensitive_data: "Datos sensibles",
};

export function ruleLabel(rule: string) {
  return RULE_LABELS[rule] ?? intentLabel(rule);
}

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  requested: "Esperando aceptación",
  active: "Activa",
  closed: "Cerrada",
  terminated: "Terminada por el moderador",
};

const timeFormat = new Intl.DateTimeFormat("es-CL", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: SANTIAGO,
});

const dayFormat = new Intl.DateTimeFormat("es-CL", {
  weekday: "short",
  day: "numeric",
  timeZone: SANTIAGO,
});

export function formatTime(at: number | string) {
  return timeFormat.format(new Date(at));
}

const longDayFormat = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: SANTIAGO,
});

export function formatLongDay(at: number | string) {
  const text = longDayFormat.format(new Date(at)).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDay(at: number | string) {
  const text = dayFormat.format(new Date(at)).replace(".", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Slot = z.infer<typeof SlotPickerSpec>["slots"][number];

export function groupSlotsByDay(slots: Slot[]) {
  const days: { day: string; slots: Slot[] }[] = [];
  for (const slot of slots) {
    const day = formatDay(slot.start);
    const last = days.at(-1);
    if (last?.day === day) last.slots.push(slot);
    else days.push({ day, slots: [slot] });
  }
  return days;
}

// "Mié 25 · 09:00": a slot named by its day and time, as the landing writes it.
export function formatSlot(at: number | string) {
  return `${formatDay(at)} · ${formatTime(at)}`;
}

const monthDayFormat = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  timeZone: SANTIAGO,
});

const fullDateFormat = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: SANTIAGO,
});

const yearFormat = new Intl.DateTimeFormat("es-CL", {
  year: "numeric",
  timeZone: SANTIAGO,
});

// A room in a list: "16:15" today, "Sáb 21" this week, "22 mar" this year, "22 nov 2025" before.
export function formatLastActivity(at: number, now = Date.now()) {
  if (yearFormat.format(at) !== yearFormat.format(now))
    return fullDateFormat.format(at).replaceAll(".", "");
  if (formatLongDay(at) === formatLongDay(now)) return formatTime(at);
  if (now - at < 6 * 86_400_000) return formatDay(at);
  return monthDayFormat.format(at).replaceAll(".", "");
}

export function violationTone(count: number, max: number) {
  if (count >= max) return "danger";
  if (count / max > 0.5) return "warning";
  return "neutral";
}

export function primaryReason(reasons: ModerationReason[] = []) {
  const confirmed = reasons.filter(
    (reason) => reason.code !== "moderator_error",
  );
  return (confirmed.length > 0 ? confirmed : reasons).reduce<
    ModerationReason | undefined
  >(
    (best, reason) =>
      (reason.score ?? 0) > (best?.score ?? -1) ? reason : best,
    undefined,
  );
}

// Until the moderator delivers a message, and forever if it blocks it, only the people behind its
// sender see the content. Everyone else sees the review state or the block notice.
export function canSeeContent(
  status: ModerationStatus,
  senderParticipantId: string | null,
  viewer: Viewer,
) {
  if (status !== "blocked" && status !== "pending") return true;
  if (senderParticipantId === null) return true;
  return viewer.ownParticipantIds.includes(senderParticipantId);
}

export function canAnswerUi(viewer: Viewer) {
  return viewer.role === "owner" || viewer.role === "operator";
}

export function countViolations(messages: RoomMessage[]) {
  return messages.filter(isViolation).length;
}

function isViolation(message: RoomMessage) {
  return (
    message.status === "blocked" &&
    message.senderParticipantId !== null &&
    !message.reasons?.some((reason) => reason.code === "moderator_error")
  );
}

// Which fault each blocked message was: the first is 1. The header shows the total; this is the
// ordinal written under the message.
export function violationOrdinals(messages: RoomMessage[]) {
  const ordinals = new Map<string, number>();
  for (const message of messages)
    if (isViolation(message))
      ordinals.set(message.messageId, ordinals.size + 1);
  return ordinals;
}

// The gate counts one turn per message an agent sends (convex/gate.ts), whatever its verdict.
export function countAgentTurns(
  messages: RoomMessage[],
  participants: RoomParticipant[],
) {
  const agents = new Set(
    participants.filter((p) => p.kind === "agent").map((p) => p.participantId),
  );
  return messages.filter(
    (m) => m.senderParticipantId !== null && agents.has(m.senderParticipantId),
  ).length;
}

export function isIntervention(message: RoomMessage) {
  return (
    message.senderParticipantId !== null &&
    message.status !== "allowed" &&
    message.status !== "pending"
  );
}

// The opening notice in words. The stored text carries the intent code, so the room writes its own.
export function openingNotice(sentAt: number, intentName: string) {
  return `${formatLongDay(sentAt)} · sala abierta · contrato: ${intentLabel(intentName).toLowerCase()}`;
}

export function uiInteractionState(
  canInteract: boolean,
  readOnly: boolean,
  answered: boolean,
) {
  return {
    disabled: !canInteract || readOnly || answered,
    showOwnerOnly: !canInteract && !answered,
  };
}

export function describeUiResponse(response: UiResponse, spec?: UiSpec) {
  switch (response.type) {
    case "slot_selected": {
      if (spec?.type !== "slot_picker") return "Eligió un horario";
      const slot = spec.slots.find((s) => s.id === response.slotId);
      if (!slot) return "Eligió un horario";
      const detail = slot.detail ? ` – ${slot.detail}` : "";
      return `Eligió: ${formatDay(slot.start)}, ${formatTime(slot.start)}${detail}`;
    }
    case "form_submit": {
      const names =
        spec?.type === "form"
          ? spec.fields
              .filter((f) => f.name in response.values)
              .map((f) => f.label)
          : Object.keys(response.values);
      return `Envió: ${names.join(", ")}`;
    }
    case "confirmation":
      return response.confirmed ? "Confirmó" : "Canceló";
    case "card_action": {
      const action =
        spec?.type === "card"
          ? spec.actions?.find((a) => a.id === response.actionId)
          : undefined;
      return `Eligió: ${action?.label ?? response.actionId}`;
    }
    case "list_selected": {
      const titles =
        spec?.type === "list"
          ? spec.items
              .filter((i) => response.itemIds.includes(i.id))
              .map((i) => i.title)
          : response.itemIds;
      return `Eligió: ${titles.join(", ")}`;
    }
  }
}

export function responseTargetId(response: UiResponse) {
  switch (response.type) {
    case "slot_selected":
      return response.pickerId;
    case "form_submit":
      return response.formId;
    case "confirmation":
      return response.confirmationId;
    case "card_action":
      return response.cardId;
    case "list_selected":
      return response.listId;
  }
}

export function auditMetrics(messages: RoomMessage[]) {
  const reviewed = messages.filter(
    (m) => m.senderParticipantId !== null && m.status !== "pending",
  );
  const interventions = reviewed.filter((m) => m.status !== "allowed").length;
  const latencies = reviewed.flatMap((m) =>
    m.audit ? [m.audit.latencyMs] : [],
  );
  const averageLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  return { reviewed: reviewed.length, interventions, averageLatencyMs };
}

export const REDACTION_MARK = "█";

export function splitRedacted(text: string) {
  let at = 0;
  return text
    .split(new RegExp(`(${REDACTION_MARK}+)`))
    .filter(Boolean)
    .map((part) => {
      const piece = { at, text: part, hidden: part.startsWith(REDACTION_MARK) };
      at += part.length;
      return piece;
    });
}

// The last session notice decides whether the room is open, closed, or terminated.
export function sessionEnd(messages: RoomMessage[]) {
  const notice = messages.findLast(
    (m) =>
      m.content.kind === "system" &&
      (m.content.code === "session_closed" ||
        m.content.code === "session_terminated"),
  );
  if (notice?.content.kind !== "system") return null;
  const status: SessionStatus =
    notice.content.code === "session_terminated" ? "terminated" : "closed";
  return { status, text: notice.content.text };
}

const secondsFormat = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
});
const msFormat = new Intl.NumberFormat("es-CL");

export function formatLatency(ms: number) {
  return ms < 1000
    ? `${msFormat.format(ms)} ms`
    : `${secondsFormat.format(ms / 1000)} s`;
}

const scoreFormat = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatScore(score: number) {
  return scoreFormat.format(score);
}

const graphemes =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("es", { granularity: "grapheme" })
    : null;

// Prefer capitalized words ("Agendamiento y Reservas" gives "AR"), else any words ("mi asistente 🦊" gives "MA").
export function initials(name: string) {
  const words = name.split(/\s+/).filter((word) => /^\p{L}/u.test(word));
  const capitalized = words.filter((word) => /^\p{Lu}/u.test(word));
  return (capitalized.length >= 2 ? capitalized : words)
    .slice(0, 2)
    .map(
      (word) =>
        (graphemes
          ? graphemes.segment(word)[Symbol.iterator]().next().value?.segment
          : word.match(/^\P{M}\p{M}*/u)?.[0].normalize("NFC")) ?? "",
    )
    .join("")
    .toLocaleUpperCase("es");
}
