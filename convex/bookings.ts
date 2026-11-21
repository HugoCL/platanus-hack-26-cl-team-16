import { ConvexError, v } from "convex/values";
import type { Booking } from "../lib/agents/booking";
import { DEFAULT_CURRENCY } from "../shared/catalog";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";

const SLOT_SCAN_LIMIT = 200;

function invalid(message: string): never {
  throw new ConvexError({ kind: "InvalidArgument", message });
}

// The provider's slots that start after `now` and have a seat left, in start order.
export async function freeSlots(
  ctx: QueryCtx,
  agentId: Id<"agents">,
  now: number,
): Promise<Doc<"availability">[]> {
  const slots = await ctx.db
    .query("availability")
    .withIndex("by_agentId_and_start", (q) =>
      q.eq("agentId", agentId).gt("start", now),
    )
    .take(SLOT_SCAN_LIMIT);
  return slots.filter((slot) => slot.booked < slot.capacity);
}

async function describe(
  ctx: QueryCtx,
  slot: Doc<"availability">,
  total: Doc<"transactions">["total"],
  created: boolean,
): Promise<Booking> {
  const offering = await ctx.db.get("offerings", slot.offeringId);
  if (!offering) invalid("the booked offering is missing");
  return {
    status: "booked",
    offeringId: slot.offeringId,
    offeringName: offering.name,
    start: slot.start,
    end: slot.end,
    total,
    created,
  };
}

export const book = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    agentId: v.id("agents"),
    availabilityId: v.id("availability"),
    now: v.number(),
  },
  handler: async (
    ctx,
    { sessionId, agentId, availabilityId, now },
  ): Promise<Booking> => {
    const member = await ctx.db
      .query("participants")
      .withIndex("by_agentId_and_sessionId", (q) =>
        q.eq("agentId", agentId).eq("sessionId", sessionId),
      )
      .first();
    if (member?.kind !== "agent" || member.role !== "recipient") {
      invalid("the provider is not in this room");
    }

    const existing = await ctx.db
      .query("transactions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .filter((q) =>
        q.and(
          q.eq(q.field("kind"), "booking"),
          q.eq(q.field("agentId"), agentId),
          q.eq(q.field("status"), "confirmed"),
        ),
      )
      .first();
    if (existing) {
      const bookedSlotId = existing.lines[0]?.availabilityId;
      const bookedSlot = bookedSlotId
        ? await ctx.db.get("availability", bookedSlotId)
        : null;
      if (!bookedSlot) invalid("the room's booking has no slot");
      return describe(ctx, bookedSlot, existing.total, false);
    }

    const session = await ctx.db.get("sessions", sessionId);
    if (session?.status !== "active") invalid("the room is not open");
    if (!session.contract?.capabilities.includes("booking")) {
      invalid("the room's contract does not allow booking");
    }
    const slot = await ctx.db.get("availability", availabilityId);
    if (slot?.agentId !== agentId) invalid("the slot is not this provider's");
    const offering = await ctx.db.get("offerings", slot.offeringId);
    if (offering?.agentId !== agentId || offering.kind !== "bookable") {
      invalid("the slot's offering is not bookable");
    }
    if (!offering.active || slot.start <= now || slot.booked >= slot.capacity) {
      return { status: "unavailable", offeringId: slot.offeringId };
    }

    const total = offering.price ?? { amount: 0, currency: DEFAULT_CURRENCY };
    await ctx.db.insert("transactions", {
      sessionId,
      agentId,
      kind: "booking",
      lines: [
        {
          offeringId: offering._id,
          quantity: 1,
          availabilityId,
          unitPrice: offering.price,
        },
      ],
      total,
      status: "confirmed",
    });
    await ctx.db.patch("availability", availabilityId, {
      booked: slot.booked + 1,
    });
    return describe(ctx, slot, total, true);
  },
});
