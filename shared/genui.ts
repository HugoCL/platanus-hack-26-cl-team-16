import { z } from "zod";
import { Money } from "./catalog";
import { VerdictRule } from "./moderation";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const shortText = z.string().min(1).max(120);
const longText = z.string().max(2000);
const fieldName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/);
const labeledValue = z.object({ label: shortText, value: z.string().max(500) });
const isoDateTime = z.iso.datetime({ offset: true });

export const CardSpec = z.object({
  type: z.literal("card"),
  id,
  title: shortText,
  body: longText.optional(),
  fields: z.array(labeledValue).max(12).optional(),
  actions: z
    .array(z.object({ id, label: shortText }))
    .max(4)
    .optional(),
});

export const FormFieldSpec = z.object({
  name: fieldName,
  label: shortText,
  input: z.enum([
    "text",
    "textarea",
    "email",
    "tel",
    "number",
    "date",
    "select",
    "checkbox",
  ]),
  required: z.boolean(),
  placeholder: z.string().max(120).optional(),
  options: z
    .array(z.object({ value: id, label: shortText }))
    .max(50)
    .optional(),
});

export const FormSpec = z.object({
  type: z.literal("form"),
  id,
  title: shortText,
  description: longText.optional(),
  fields: z.array(FormFieldSpec).min(1).max(12),
  submitLabel: shortText,
});

export const SlotPickerSpec = z.object({
  type: z.literal("slot_picker"),
  id,
  title: shortText,
  timezone: z.string().default("America/Santiago"),
  slots: z
    .array(
      z.object({
        id,
        start: isoDateTime,
        end: isoDateTime,
        label: shortText.optional(),
        detail: shortText.optional(),
      }),
    )
    .min(1)
    .max(24),
});

export const ConfirmationSpec = z.object({
  type: z.literal("confirmation"),
  id,
  title: shortText,
  summary: longText,
  details: z.array(labeledValue).max(12),
  confirmLabel: shortText,
  cancelLabel: shortText,
});

export const ListSpec = z.object({
  type: z.literal("list"),
  id,
  title: shortText.optional(),
  selection: z.enum(["none", "single", "multiple"]),
  items: z
    .array(
      z.object({
        id,
        title: shortText,
        subtitle: z.string().max(200).optional(),
        meta: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const MapPinSpec = z.object({
  type: z.literal("map_pin"),
  id,
  title: shortText,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional(),
});

export const ModeratorAlertSpec = z.object({
  type: z.literal("moderator_alert"),
  id,
  title: shortText,
  rule: VerdictRule,
  reason: z.string().min(1).max(500),
  blockedMessageId: z.string().min(1).optional(),
});

export const UiSpec = z.discriminatedUnion("type", [
  CardSpec,
  FormSpec,
  SlotPickerSpec,
  ConfirmationSpec,
  ListSpec,
  MapPinSpec,
  ModeratorAlertSpec,
]);
export type UiSpec = z.infer<typeof UiSpec>;
export type UiComponentType = UiSpec["type"];

export const AgentUiSpec = z.discriminatedUnion("type", [
  CardSpec,
  FormSpec,
  SlotPickerSpec,
  ConfirmationSpec,
  ListSpec,
  MapPinSpec,
]);
export type AgentUiSpec = z.infer<typeof AgentUiSpec>;

export const Phase1UiSpec = z.discriminatedUnion("type", [
  SlotPickerSpec,
  ConfirmationSpec,
  CardSpec,
  ModeratorAlertSpec,
]);
export type Phase1UiSpec = z.infer<typeof Phase1UiSpec>;
export const PHASE1_UI_COMPONENTS = Phase1UiSpec.options.map(
  (option) => option.shape.type.value,
);

export const UiResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("card_action"), cardId: id, actionId: id }),
  z.object({
    type: z.literal("form_submit"),
    formId: id,
    values: z.record(
      fieldName,
      z.union([z.string().max(2000), z.number(), z.boolean()]),
    ),
  }),
  z.object({ type: z.literal("slot_selected"), pickerId: id, slotId: id }),
  z.object({
    type: z.literal("confirmation"),
    confirmationId: id,
    confirmed: z.boolean(),
  }),
  z.object({
    type: z.literal("list_selected"),
    listId: id,
    itemIds: z.array(id).min(1).max(50),
  }),
]);
export type UiResponse = z.infer<typeof UiResponse>;

const httpsImage = z.url({ protocol: /^https$/ });

export const ProductCardSpec = z.object({
  type: z.literal("product_card"),
  id,
  offeringId: z.string().min(1),
  name: shortText,
  description: longText.optional(),
  imageUrl: httpsImage.optional(),
  price: Money.optional(),
});

export const ProductListSpec = z.object({
  type: z.literal("product_list"),
  id,
  title: shortText.optional(),
  selection: z.enum(["none", "single", "multiple"]),
  items: z
    .array(
      z.object({
        id,
        offeringId: z.string().min(1),
        name: shortText,
        imageUrl: httpsImage.optional(),
        price: Money.optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const OrderSummarySpec = z.object({
  type: z.literal("order_summary"),
  id,
  title: shortText,
  lines: z
    .array(
      z.object({
        label: shortText,
        quantity: z.number().int().positive(),
        unitPrice: Money,
        subtotal: Money,
      }),
    )
    .min(1)
    .max(50),
  total: Money,
  confirmLabel: shortText,
  cancelLabel: shortText,
});

export const PostE8CommerceUiSpec = z.discriminatedUnion("type", [
  ProductCardSpec,
  ProductListSpec,
  OrderSummarySpec,
]);
export type PostE8CommerceUiSpec = z.infer<typeof PostE8CommerceUiSpec>;
