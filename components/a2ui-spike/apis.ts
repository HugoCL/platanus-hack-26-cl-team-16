import {
  ActionSchema,
  type ComponentApi,
  DynamicStringSchema,
} from "@a2ui/web_core/v1_0";
import { z } from "zod-a2ui";
import { VerdictRule } from "../../shared/moderation";

export const AGENT_CATALOG_ID =
  "https://platanus-hack-26-cl-team-16.dev/a2ui/catalogs/agent/v1.json";
export const PLATFORM_CATALOG_ID =
  "https://platanus-hack-26-cl-team-16.dev/a2ui/catalogs/platform/v1.json";

const shortText = z.string().min(1).max(120);
const labeledValue = z
  .object({ label: shortText, value: z.string().max(500) })
  .strict();

export const SlotPickerApi = {
  name: "SlotPicker",
  schema: z
    .object({
      title: DynamicStringSchema,
      timezone: z.string().max(64).optional(),
      slots: z
        .array(
          z
            .object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
              start: z.string().datetime({ offset: true }),
              end: z.string().datetime({ offset: true }),
              label: shortText.optional(),
              detail: shortText.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(24),
      selected: DynamicStringSchema.optional(),
      action: ActionSchema,
    })
    .strict(),
} satisfies ComponentApi;

export const ConfirmationCardApi = {
  name: "ConfirmationCard",
  schema: z
    .object({
      title: DynamicStringSchema,
      summary: DynamicStringSchema,
      details: z.array(labeledValue).max(12),
      confirmLabel: shortText,
      cancelLabel: shortText,
      confirmAction: ActionSchema,
      cancelAction: ActionSchema,
    })
    .strict(),
} satisfies ComponentApi;

export const InfoCardApi = {
  name: "InfoCard",
  schema: z
    .object({
      title: DynamicStringSchema,
      body: DynamicStringSchema.optional(),
      fields: z.array(labeledValue).max(12).optional(),
    })
    .strict(),
} satisfies ComponentApi;

export const ModeratorAlertApi = {
  name: "ModeratorAlert",
  schema: z
    .object({
      title: shortText,
      rule: z.enum(VerdictRule.options as [VerdictRule, ...VerdictRule[]]),
      reason: z.string().min(1).max(500),
    })
    .strict(),
} satisfies ComponentApi;

export const AGENT_COMPONENT_APIS = [
  SlotPickerApi,
  ConfirmationCardApi,
  InfoCardApi,
] as const;
export const AGENT_COMPONENTS = AGENT_COMPONENT_APIS.map((api) => api.name);
