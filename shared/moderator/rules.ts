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
// A RUT with no dots or hyphen: 7 or 8 digits and the check digit, standing
// alone, so not part of a longer number. A "+56" before it is dropped with its
// separators, so what follows is read on its own. When the message says RUT or
// RUN as a word, every such number that passes modulo 11 is a RUT. Otherwise
// three shapes are not: a price, "$" and a whole token of digits with or
// without dots; a Chilean phone, "+56" and nine digits starting with 2 to 9;
// and a mobile, nine digits starting with 9.
const RUT_COMPACT = /(?<![\p{L}\d.,-])(\d{7,8})([\dk])(?![\p{L}\d]|[.,-]\d)/giu;
const RUT_WORD = /(?<![\p{L}\d])ru[tn](?![\p{L}\d])/iu;
const COUNTRY_CODE = /\+\p{Zs}*56[\p{Zs}().-]*/gu;
const PRICE = /\$\p{Zs}*\d[\d.]*(?![\p{L}\d])/giu;
const CHILEAN_PHONE =
  /\+\p{Zs}*56[\p{Zs}().-]*[2-9](?:[\p{Zs}().-]*\d){8}(?![\p{L}\d])/gu;
const CHILEAN_MOBILE = /^9\d{8}$/;
// A card number has 13 to 19 digits, unbroken or in groups split either by
// spaces (any Unicode space) and hyphens, mixed freely, or by dots alone. Every
// run of whole consecutive groups whose separators are all dotted or all
// undotted is checked with Luhn, so digits next to a card cannot hide it, and a
// list of prices like "59.990 12.990" is not read as one number.
const DIGIT_RUN = /\d+(?:[\p{Zs}.-]+\d+)*/gu;
const CARD_SEPARATOR = /([\p{Zs}.-]+)/u;

const INJECTION_PATTERNS = [
  /(?<!\bno )\b(ignora|ignore|ignoren|olvida|olviden|disregard|forget)\s+((todas|all)\s+)?((tus|sus|las|the|your)\s+)?((anteriores|previas|previous|prior|above)\s+)?(instrucciones|reglas|restricciones|instructions|rules)\b/,
  /\b(desde ahora|a partir de ahora|de ahora en adelante) (eres|seras|actuas|actuaras)\b/,
  /\byou are now\b/,
  /\b(system prompt|prompt del sistema|prompt de sistema|instrucciones del sistema|tu prompt|your prompt)\b/,
  /\b(modo (desarrollador|administrador|dios)|developer mode|jailbreak)\b/,
];

// Findings come in priority order and the first one decides the verdict:
// sensitive data, then injection, then a ui_response that matches no offered block.
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
        "El mensaje trae un RUT, y el contrato solo permite que el lado consumidor se lo entregue al proveedor cuando este lo pide.",
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
  for (const [run] of text.matchAll(DIGIT_RUN)) {
    const { groups, dotted } = splitRun(run);
    for (let first = 0; first < groups.length; first++) {
      if (cardEnd(groups, dotted, first) !== undefined) return true;
    }
  }
  return false;
}

function splitRun(run: string) {
  const parts = run.split(CARD_SEPARATOR);
  return {
    parts,
    groups: parts.filter((_, i) => i % 2 === 0),
    dotted: parts
      .filter((_, i) => i % 2 === 1)
      .map((separator) => separator.includes(".")),
  };
}

// The last group of the longest card that starts at group `first`.
function cardEnd(
  groups: string[],
  dotted: boolean[],
  first: number,
): number | undefined {
  let end: number | undefined;
  let digits = "";
  for (let last = first; last < groups.length; last++) {
    if (last > first && dotted[last - 1] !== dotted[first]) break;
    digits += groups[last];
    if (digits.length > 19) break;
    if (digits.length >= 13 && passesLuhn(digits)) end = last;
  }
  return end;
}

const MASK = "•";

// A message blocked for carrying a card or a RUT is stored with the value
// masked, so the database never holds it: a card keeps its last four digits
// and a RUT keeps none. Masking follows the rules' own readings; when one of
// them still finds a value afterwards, every digit in the message is masked.
export function maskSensitiveData<T>(content: T): T {
  const masked = mapStrings(content, (s) => maskRuts(maskCards(s)));
  const text = strings(masked).join("\n");
  if (!hasCard(text) && !hasRut(text)) return masked;
  return mapStrings(content, (s) => s.replace(/\d/g, MASK));
}

function mapStrings<T>(value: T, mask: (text: string) => string): T {
  if (typeof value === "string") return mask(value) as T;
  if (typeof value === "number") {
    const text = String(value);
    return (mask(text) === text ? value : 0) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapStrings(item, mask)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, mask)]),
    ) as T;
  }
  return value;
}

function maskCards(text: string): string {
  return text.replace(DIGIT_RUN, (run) => {
    const { parts, groups, dotted } = splitRun(run);
    const starts: number[] = [];
    let at = 0;
    for (const [i, part] of parts.entries()) {
      if (i % 2 === 0) starts.push(at);
      at += part.length;
    }
    const chars = run.split("");
    for (let first = 0; first < groups.length; first++) {
      const last = cardEnd(groups, dotted, first);
      if (last === undefined) continue;
      let kept = 0;
      for (
        let i = starts[last] + groups[last].length - 1;
        i >= starts[first];
        i--
      ) {
        if (!/\d/.test(chars[i])) continue;
        if (kept < 4) kept++;
        else chars[i] = MASK;
      }
      first = last;
    }
    return chars.join("");
  });
}

function maskRuts(text: string): string {
  const mask = (match: string, body: string, checkDigit: string) =>
    rutCheckDigit(body.replace(/\./g, "")) === checkDigit.toLowerCase()
      ? match.replace(/[\dk]/gi, MASK)
      : match;
  return text.replace(RUT_FORMATTED, mask).replace(RUT_COMPACT, mask);
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

export const carriesRut = (content: Parameters<typeof strings>[0]) =>
  hasRut(strings(content).join("\n"));

function hasRut(text: string): boolean {
  const saysRut = RUT_WORD.test(text);
  const compactText = (
    saysRut ? text : text.replace(PRICE, " ").replace(CHILEAN_PHONE, " ")
  ).replace(COUNTRY_CODE, " ");
  const candidates = [
    ...text.matchAll(RUT_FORMATTED),
    ...[...compactText.matchAll(RUT_COMPACT)].filter(
      ([compact]) => saysRut || !CHILEAN_MOBILE.test(compact),
    ),
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
  const fromConsumerSide =
    sender.kind === "agent"
      ? sender.role === "initiator"
      : participants.some(
          (p) =>
            p.kind === "agent" &&
            p.role === "initiator" &&
            p.agentId === sender.onBehalfOfAgentId,
        );
  return (
    contract.recipientRequests.includes("rut") &&
    fromConsumerSide &&
    ((to?.kind === "agent" && to.role === "recipient") ||
      (sender.kind === "human" &&
        sender.role === "owner" &&
        recipient === "all"))
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
