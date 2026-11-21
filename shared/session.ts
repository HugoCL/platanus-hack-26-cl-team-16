import { z } from "zod";
import { Capability, DataField, IntentName } from "./scope";

export const DEFAULT_MAX_TURNS = 12;

export const SessionIntent = z.object({
  name: IntentName,
  description: z.string().min(1).max(500),
});
export type SessionIntent = z.infer<typeof SessionIntent>;

export const SessionContract = z.object({
  intent: SessionIntent,
  capabilities: z.array(Capability),
  allowedIntents: z.array(IntentName).min(1),
  forbiddenTopics: z.array(z.string()),
  recipientShares: z.array(DataField),
  recipientRequests: z.array(DataField),
  maxTurns: z.number().int().min(1).max(100),
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

const id = z.string().min(1);

export const Participant = z.discriminatedUnion("kind", [
  z.object({
    participantId: id,
    kind: z.literal("agent"),
    agentId: id,
    role: AgentParticipantRole,
  }),
  z.object({
    participantId: id,
    kind: z.literal("human"),
    displayName: z.string().min(1).max(120),
    role: HumanParticipantRole,
    onBehalfOfAgentId: id.optional(),
  }),
]);
export type Participant = z.infer<typeof Participant>;

export const Session = z
  .object({
    sessionId: id,
    status: SessionStatus,
    mode: SessionMode,
    intent: SessionIntent,
    contract: SessionContract.nullable(),
    participants: z.array(Participant).min(2).max(10),
    turnCount: z.number().int().nonnegative(),
  })
  .superRefine((session, ctx) => {
    if (session.status !== "requested" && !session.contract) {
      ctx.addIssue({
        code: "custom",
        path: ["contract"],
        message: "an opened session needs its contract",
      });
    }
    if (session.contract && session.turnCount > session.contract.maxTurns) {
      ctx.addIssue({
        code: "custom",
        path: ["turnCount"],
        message: "turnCount is past the contract's maxTurns",
      });
    }
    const initiators = session.participants.filter(
      (p) => p.role === "initiator",
    );
    if (initiators.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["participants"],
        message: "a session has exactly one initiator",
      });
    }
  });
export type Session = z.infer<typeof Session>;
