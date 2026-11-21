import { z } from "zod";
import { DataField, IntentName } from "./scope";

export const SessionIntent = z.object({
  name: IntentName,
  description: z.string().min(1).max(500),
});
export type SessionIntent = z.infer<typeof SessionIntent>;

export const SessionContract = z.object({
  intent: SessionIntent,
  allowedIntents: z.array(IntentName).min(1),
  forbiddenTopics: z.array(z.string()),
  recipientShares: z.array(DataField),
  recipientRequests: z.array(DataField),
  maxViolations: z.number().int().positive(),
});
export type SessionContract = z.infer<typeof SessionContract>;

export const SessionMode = z.enum(["moderated", "private"]);
export type SessionMode = z.infer<typeof SessionMode>;

export const SessionStatus = z.enum([
  "requested",
  "active",
  "closed",
  "terminated",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const AgentParticipantRole = z.enum(["initiator", "recipient"]);
export const HumanParticipantRole = z.enum(["owner", "observer", "operator"]);
