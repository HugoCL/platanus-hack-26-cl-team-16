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
  prompt_injection: "Prompt injection",
  off_purpose: "Fuera del propósito",
  forbidden_topic: "Tema prohibido",
  data_leak: "Fuga de datos",
  repeated_violations: "Violaciones repetidas",
  moderator_error: "Error del moderador",
};

export const STAGE_LABELS: Record<ModerationStage, string> = {
  deterministic: "Filtros",
  injection: "Inyección",
  purpose: "Propósito",
};

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

export function violationTone(count: number, max: number) {
  if (count >= max) return "danger";
  if (count / max > 0.5) return "warning";
  return "neutral";
}

export function primaryReason(reasons: ModerationReason[] = []) {
  return reasons.reduce<ModerationReason | undefined>(
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
