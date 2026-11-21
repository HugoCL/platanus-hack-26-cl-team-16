import { z } from "zod";
import { UiResponse, UiSpec } from "./genui";

export const MAX_TEXT_LENGTH = 4000;

export const TextContent = z.object({
  kind: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

export const UiContent = z.object({ kind: z.literal("ui"), spec: UiSpec });

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
  UiContent,
  UiResponseContent,
  CiphertextContent,
]);
export type SendableContent = z.infer<typeof SendableContent>;
