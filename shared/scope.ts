import { z } from "zod";

export const Slug = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "lowercase snake_case slug");

export const IntentName = Slug;
export const DataField = Slug;

export const Capability = z.enum(["booking", "catalog", "ordering", "info"]);
export type Capability = z.infer<typeof Capability>;

export const CAPABILITY_INTENTS = {
  booking: ["check_availability", "book"],
  catalog: ["browse_catalog", "request_quote"],
  ordering: ["place_order"],
  info: ["ask_info"],
} as const satisfies Record<Capability, readonly string[]>;

export const AgentScope = z.object({
  allowedIntents: z.array(IntentName).max(32),
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
