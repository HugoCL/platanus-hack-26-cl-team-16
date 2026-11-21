import { z } from "zod";
import type { Message, Recipient, SendableContent } from "./messages";
import type { Participant, SessionContract } from "./session";

export const ModerationStage = z.enum([
  "deterministic",
  "injection",
  "purpose",
]);
export type ModerationStage = z.infer<typeof ModerationStage>;

export const ModerationReasonCode = z.enum([
  "size_limit",
  "rate_limit",
  "url",
  "pii",
  "malformed_payload",
  "prompt_injection",
  "off_purpose",
  "forbidden_topic",
  "data_leak",
  "repeated_violations",
  "moderator_error",
]);
export type ModerationReasonCode = z.infer<typeof ModerationReasonCode>;

export const ModerationReason = z.object({
  code: ModerationReasonCode,
  stage: ModerationStage,
  detail: z.string().max(500),
  score: z.number().min(0).max(1).optional(),
});
export type ModerationReason = z.infer<typeof ModerationReason>;

const reasons = z.array(ModerationReason);

export const ModerationAction = z.enum([
  "allow",
  "redact",
  "block",
  "escalate",
  "terminate",
]);
export type ModerationAction = z.infer<typeof ModerationAction>;

export const ModerationResult = z.discriminatedUnion("action", [
  z.object({ action: z.literal("allow"), reasons }),
  z.object({
    action: z.literal("redact"),
    reasons: reasons.min(1),
    redactedText: z.string(),
  }),
  z.object({
    action: z.literal("block"),
    reasons: reasons.min(1),
    systemNotice: z.string(),
  }),
  z.object({ action: z.literal("escalate"), reasons: reasons.min(1) }),
  z.object({
    action: z.literal("terminate"),
    reasons: reasons.min(1),
    systemNotice: z.string(),
  }),
]);
export type ModerationResult = z.infer<typeof ModerationResult>;

export const ModerationStatus = z.enum([
  "pending",
  "allowed",
  "redacted",
  "blocked",
  "escalated",
]);
export type ModerationStatus = z.infer<typeof ModerationStatus>;

export const MODERATION_STATUS_FOR_ACTION = {
  allow: "allowed",
  redact: "redacted",
  block: "blocked",
  escalate: "escalated",
  terminate: "blocked",
} as const satisfies Record<ModerationAction, ModerationStatus>;

export const DELIVERABLE_STATUSES: readonly ModerationStatus[] = [
  "allowed",
  "redacted",
];

export const VerdictRule = z.enum([
  "purpose",
  "scope",
  "injection",
  "sensitive_data",
]);
export type VerdictRule = z.infer<typeof VerdictRule>;

export const Verdict = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("allow"),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    decision: z.literal("block"),
    rule: VerdictRule,
    reason: z.string().min(1).max(500),
  }),
]);
export type Verdict = z.infer<typeof Verdict>;

export const MessageModeration = z.object({
  status: ModerationStatus,
  verdict: Verdict.optional(),
  reasons,
  redactedText: z.string().optional(),
  decidedAt: z.number().optional(),
});
export type MessageModeration = z.infer<typeof MessageModeration>;

export type ModerationInput = {
  content: SendableContent;
  sender: Participant;
  recipient: Recipient;
  contract: SessionContract;
  participants: Participant[];
  history: Message[];
};

export type ModerationEvent = {
  stage: ModerationStage;
  action: ModerationAction;
  reasons: ModerationReason[];
  model?: string;
  latencyMs?: number;
};

export type ModerationOutcome = {
  verdict: Verdict;
  events: ModerationEvent[];
};

export interface Moderator {
  moderate(input: ModerationInput): Promise<ModerationOutcome>;
}
