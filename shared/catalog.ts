import { z } from "zod";
import { Slug } from "./scope";

export const DEFAULT_CURRENCY = "CLP";

export const Money = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code"),
});
export type Money = z.infer<typeof Money>;

export const AttributeDef = z.object({
  key: Slug,
  label: z.string().min(1).max(80),
  type: z.enum(["string", "number", "boolean", "string_list"]),
  required: z.boolean(),
  options: z.array(z.string().min(1)).max(50).optional(),
});
export type AttributeDef = z.infer<typeof AttributeDef>;

export const Category = z.object({
  slug: Slug,
  parent: Slug.nullable(),
  label: z.string().min(1).max(80),
  attributeSchema: z.array(AttributeDef).max(20),
});
export type Category = z.infer<typeof Category>;

export const AttributeValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export const Attributes = z.record(Slug, AttributeValue);
export type Attributes = z.infer<typeof Attributes>;

export const OfferingKind = z.enum(["bookable", "product"]);
export type OfferingKind = z.infer<typeof OfferingKind>;

export const OfferingImage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.url({ protocol: /^https$/ }) }),
  z.object({ kind: z.literal("storage"), storageId: z.string().min(1) }),
]);
export type OfferingImage = z.infer<typeof OfferingImage>;

export const Offering = z
  .object({
    kind: OfferingKind,
    category: Slug,
    name: z.string().min(1).max(120),
    description: z.string().max(1000),
    images: z.array(OfferingImage).max(8),
    price: Money.optional(),
    attributes: Attributes,
    stock: z.number().int().nonnegative().optional(),
    active: z.boolean(),
  })
  .superRefine((offering, ctx) => {
    if (offering.kind === "bookable" && offering.stock !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stock"],
        message: "bookable offerings use availability, not stock",
      });
    }
  });
export type Offering = z.infer<typeof Offering>;

export const AvailabilityUnit = z.enum(["slot", "night"]);
export type AvailabilityUnit = z.infer<typeof AvailabilityUnit>;

export const Availability = z
  .object({
    start: z.number().int(),
    end: z.number().int(),
    unit: AvailabilityUnit,
    capacity: z.number().int().positive(),
    booked: z.number().int().nonnegative(),
  })
  .superRefine((slot, ctx) => {
    if (slot.end <= slot.start) {
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "end must be after start",
      });
    }
    if (slot.booked > slot.capacity) {
      ctx.addIssue({
        code: "custom",
        path: ["booked"],
        message: "booked exceeds capacity",
      });
    }
  });
export type Availability = z.infer<typeof Availability>;

export const TransactionKind = z.enum(["booking", "order"]);
export const TransactionStatus = z.enum(["held", "confirmed", "cancelled"]);

export const TimeRange = z.object({
  start: z.number().int(),
  end: z.number().int(),
});

export const TransactionLine = z.object({
  offeringId: z.string().min(1),
  quantity: z.number().int().positive(),
  availabilityId: z.string().min(1).optional(),
  range: TimeRange.optional(),
  unitPrice: Money.optional(),
});

export const Transaction = z
  .object({
    kind: TransactionKind,
    lines: z.array(TransactionLine).min(1).max(50),
    total: Money,
    status: TransactionStatus,
  })
  .superRefine((tx, ctx) => {
    tx.lines.forEach((line, i) => {
      const timed =
        line.availabilityId !== undefined || line.range !== undefined;
      if (tx.kind === "booking" && !timed) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i],
          message: "a booking line needs an availabilityId or a time range",
        });
      }
      if (tx.kind === "order" && line.availabilityId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "availabilityId"],
          message: "order lines reference products, not availability",
        });
      }
    });
  });
export type Transaction = z.infer<typeof Transaction>;

export function attributeDefsFor(
  categorySlug: string,
  categories: readonly Category[],
): AttributeDef[] {
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const defs: AttributeDef[] = [];
  let current = bySlug.get(categorySlug);
  if (!current) throw new Error(`unknown category ${categorySlug}`);
  while (current) {
    defs.push(...current.attributeSchema);
    current = current.parent ? bySlug.get(current.parent) : undefined;
  }
  return defs;
}

export function attributesSchemaFor(defs: readonly AttributeDef[]) {
  const value = (def: AttributeDef) => {
    if (def.type === "number") return z.number();
    if (def.type === "boolean") return z.boolean();
    if (def.type === "string_list") return z.array(z.string().min(1));
    return def.options
      ? z.enum(def.options as [string, ...string[]])
      : z.string().min(1);
  };
  return z.strictObject(
    Object.fromEntries(
      defs.map((def) => [
        def.key,
        def.required ? value(def) : value(def).optional(),
      ]),
    ),
  );
}

export function validateOfferingAttributes(
  offering: Pick<Offering, "category" | "attributes">,
  categories: readonly Category[],
) {
  return attributesSchemaFor(
    attributeDefsFor(offering.category, categories),
  ).safeParse(offering.attributes);
}
