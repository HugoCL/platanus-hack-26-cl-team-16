import { z } from "zod";
import { Location } from "./geo";
import {
  AgentEndpoint,
  AgentKind,
  AgentScope,
  AgentStatus,
  CAPABILITY_INTENTS,
  Capability,
  Slug,
} from "./scope";

export const AgentCard = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case slug"),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  purpose: z.string().min(1).max(1000),
  categories: z.array(Slug).min(1).max(10),
  capabilities: z
    .array(Capability)
    .max(4)
    .refine(
      (caps) => new Set(caps).size === caps.length,
      "duplicate capability",
    ),
  scope: AgentScope,
  location: Location.optional(),
  kind: AgentKind,
  endpoint: AgentEndpoint.optional(),
  publicKey: z.string().optional(),
  status: AgentStatus,
  verified: z.boolean(),
});
export type AgentCard = z.infer<typeof AgentCard>;

export function effectiveAllowedIntents(
  card: Pick<AgentCard, "capabilities" | "scope">,
): string[] {
  return [
    ...new Set([
      ...card.capabilities.flatMap((cap) => CAPABILITY_INTENTS[cap]),
      ...card.scope.allowedIntents,
    ]),
  ];
}
