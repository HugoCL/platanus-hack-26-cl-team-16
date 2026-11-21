import { z } from "zod";

export const Slug = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "lowercase snake_case slug");

export const IntentName = Slug;
export const DataField = Slug;

export const AgentScope = z.object({
  allowedIntents: z.array(IntentName).min(1).max(32),
  forbiddenTopics: z.array(z.string().min(1).max(200)).max(32),
  dataItShares: z.array(DataField).max(32),
  dataItRequests: z.array(DataField).max(32),
});
export type AgentScope = z.infer<typeof AgentScope>;

export const AgentKind = z.enum(["hosted", "external"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentStatus = z.enum(["prospect", "draft", "active"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentEndpoint = z.object({
  protocol: z.enum(["mcp", "a2a", "webhook"]),
  url: z.url({ protocol: /^https?$/ }),
});
export type AgentEndpoint = z.infer<typeof AgentEndpoint>;
