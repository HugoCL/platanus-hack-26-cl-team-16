import { z } from "zod";
import { AgentUiSpec, UiResponse, UiSpec } from "./genui";
import { ModerationStatus, Verdict } from "./moderation";

export const MAX_TEXT_LENGTH = 4000;

export const TextContent = z.object({
  kind: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const UiContent = z.object({ kind: z.literal("ui"), spec: UiSpec });
export const AgentUiContent = z.object({
  kind: z.literal("ui"),
  spec: AgentUiSpec,
});

export const UiResponseContent = z.object({
  kind: z.literal("ui_response"),
  inReplyTo: z.string().min(1),
  response: UiResponse,
});

export const SystemContent = z.object({
  kind: z.literal("system"),
  code: z.enum([
    "session_opened",
    "session_closed",
    "session_terminated",
    "message_blocked",
    "escalation_requested",
    "human_joined",
    "human_took_control",
  ]),
  text: z.string().max(MAX_TEXT_LENGTH),
});

export const CiphertextContent = z.object({
  kind: z.literal("ciphertext"),
  ciphertext: z.base64().max(65536),
  epoch: z.number().int().nonnegative(),
});

export const MessageContent = z.discriminatedUnion("kind", [
  TextContent,
  UiContent,
  UiResponseContent,
  SystemContent,
  CiphertextContent,
]);
export type MessageContent = z.infer<typeof MessageContent>;
export type MessageKind = MessageContent["kind"];

export const SendableContent = z.discriminatedUnion("kind", [
  TextContent,
  AgentUiContent,
  UiResponseContent,
  CiphertextContent,
]);
export type SendableContent = z.infer<typeof SendableContent>;

export const Recipient = z.union([z.literal("all"), z.string().min(1)]);
export type Recipient = z.infer<typeof Recipient>;

const VERDICT_FOR_STATUS: Partial<
  Record<ModerationStatus, Verdict["decision"]>
> = { allowed: "allow", blocked: "block" };

export const Message = z
  .object({
    messageId: z.string().min(1),
    sessionId: z.string().min(1),
    senderParticipantId: z.string().min(1).nullable(),
    recipient: Recipient,
    content: MessageContent,
    status: ModerationStatus,
    verdict: Verdict.nullable(),
    sentAt: z.number().int().nonnegative(),
  })
  .superRefine((message, ctx) => {
    const { content } = message;
    const fromPlatform =
      content.kind === "system" ||
      (content.kind === "ui" && content.spec.type === "moderator_alert");
    if (fromPlatform !== (message.senderParticipantId === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["senderParticipantId"],
        message:
          "system notices and moderator alerts have no sender; every other message has one",
      });
    }
    if (message.status === "pending" && message.verdict) {
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "a pending message has no verdict yet",
      });
    }
    const expected = VERDICT_FOR_STATUS[message.status];
    if (expected && message.verdict?.decision !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: `a ${message.status} message needs a "${expected}" verdict`,
      });
    }
  });
export type Message = z.infer<typeof Message>;
