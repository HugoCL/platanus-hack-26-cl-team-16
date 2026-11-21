import type { UiResponse, UiSpec } from "../genui";
import type { SendableContent } from "../messages";
import {
  DELIVERABLE_STATUSES,
  type ModerationInput,
  type ModerationReasonCode,
  type VerdictRule,
} from "../moderation";

export type RuleFinding = {
  rule: VerdictRule;
  code: ModerationReasonCode;
  detail: string;
};

const RUT_FORMATTED =
  /(?<![\d.])(\d{1,2}(?:\.\d{3}){2}|\d{7,8})-([\dk])(?![\dk])/gi;
const RUT_AFTER_KEYWORD = /\bru[tn]\b[\s:#]*(\d{7,8})([\dk])(?![\dk])/gi;
const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

const INJECTION_PATTERNS = [
  /(?<!\bno )\b(ignora|ignore|ignoren|olvida|olviden|disregard|forget)\s+((todas|all)\s+)?((tus|sus|las|the|your)\s+)?((anteriores|previas|previous|prior|above)\s+)?(instrucciones|reglas|restricciones|instructions|rules)\b/,
  /\b(desde ahora|a partir de ahora|de ahora en adelante) (eres|seras|actuas|actuaras)\b/,
  /\byou are now\b/,
  /\b(system prompt|prompt del sistema|prompt de sistema|instrucciones del sistema|tu prompt|your prompt)\b/,
  /\b(modo (desarrollador|administrador|dios)|developer mode|jailbreak)\b/,
];

export function checkRules(input: ModerationInput): RuleFinding[] {
  const { content } = input;
  if (content.kind === "ciphertext") {
    return [
      {
        rule: "purpose",
        code: "malformed_payload",
        detail:
          "El moderador no puede revisar contenido cifrado en una sala moderada.",
      },
    ];
  }

  const findings: RuleFinding[] = [];
  if (content.kind === "ui_response") {
    const problem = uiResponseProblem(input, content);
    if (problem) {
      findings.push({
        rule: "scope",
        code: "malformed_payload",
        detail: problem,
      });
    }
  }

  const text = strings(content).join("\n");
  if (hasCard(text)) {
    findings.push({
      rule: "sensitive_data",
      code: "pii",
      detail:
        "El mensaje trae un número de tarjeta. Los datos de pago no se comparten en la sala.",
    });
  }
  if (hasRut(text) && !rutAllowed(input)) {
    findings.push({
      rule: "sensitive_data",
      code: "pii",
      detail:
        "El mensaje trae un RUT, y el contrato solo permite que el agente consumidor se lo entregue al proveedor cuando este lo pide.",
    });
  }
  const normalized = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    findings.push({
      rule: "injection",
      code: "prompt_injection",
      detail: "El mensaje intenta cambiar las instrucciones de un agente.",
    });
  }
  return findings;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

function hasCard(text: string): boolean {
  for (const [candidate] of text.matchAll(CARD_CANDIDATE)) {
    const digits = candidate.replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let digit = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

function hasRut(text: string): boolean {
  const candidates = [
    ...text.matchAll(RUT_FORMATTED),
    ...text.matchAll(RUT_AFTER_KEYWORD),
  ];
  return candidates.some(
    ([, body, checkDigit]) =>
      rutCheckDigit(body.replace(/\./g, "")) === checkDigit.toLowerCase(),
  );
}

function rutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const digit = 11 - (sum % 11);
  if (digit === 11) return "0";
  if (digit === 10) return "k";
  return String(digit);
}

function rutAllowed({
  contract,
  sender,
  recipient,
  participants,
}: ModerationInput): boolean {
  const to = participants.find((p) => p.participantId === recipient);
  return (
    contract.recipientRequests.includes("rut") &&
    sender.kind === "agent" &&
    sender.role === "initiator" &&
    to?.kind === "agent" &&
    to.role === "recipient"
  );
}

function uiResponseProblem(
  { sender, history }: ModerationInput,
  { inReplyTo, response }: Extract<SendableContent, { kind: "ui_response" }>,
): string | undefined {
  const block = history.find((m) => m.messageId === inReplyTo);
  if (
    block?.content.kind !== "ui" ||
    !DELIVERABLE_STATUSES.includes(block.status)
  ) {
    return "La respuesta apunta a un bloque que no está en la sala.";
  }
  if (sender.kind !== "human" || block.recipient !== sender.participantId) {
    return "La respuesta viene de alguien a quien no iba dirigido el bloque.";
  }
  if (!offers(block.content.spec, response)) {
    return "La opción elegida no está entre las que ofrecía el bloque.";
  }
}

function offers(spec: UiSpec, response: UiResponse): boolean {
  switch (response.type) {
    case "slot_selected":
      return (
        spec.type === "slot_picker" &&
        spec.id === response.pickerId &&
        spec.slots.some((slot) => slot.id === response.slotId)
      );
    case "confirmation":
      return (
        spec.type === "confirmation" && spec.id === response.confirmationId
      );
    case "card_action":
      return (
        spec.type === "card" &&
        spec.id === response.cardId &&
        (spec.actions ?? []).some((action) => action.id === response.actionId)
      );
    case "list_selected":
      return (
        spec.type === "list" &&
        spec.id === response.listId &&
        (spec.selection === "multiple" ||
          (spec.selection === "single" && response.itemIds.length === 1)) &&
        response.itemIds.every((id) =>
          spec.items.some((item) => item.id === id),
        )
      );
    case "form_submit":
      return (
        spec.type === "form" &&
        spec.id === response.formId &&
        Object.entries(response.values).every(([name, value]) => {
          const field = spec.fields.find((f) => f.name === name);
          return (
            field !== undefined &&
            (field.input !== "select" ||
              (field.options ?? []).some((option) => option.value === value))
          );
        })
      );
  }
}
