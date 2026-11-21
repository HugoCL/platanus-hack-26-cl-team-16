import { ConvexError, v } from "convex/values";
import { DEFAULT_CURRENCY, type Money } from "../shared/catalog";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";

export const SLOT_SCAN_LIMIT = 200;
const ROOM_BOOKING_LIMIT = 50;

export type BookingResult =
  | {
      status: "booked";
      transactionId: Id<"transactions">;
      offeringName: string;
      start: number;
      end: number;
      total: Money;
    }
  | { status: "unavailable" };

function invalid(message: string): never {
  throw new ConvexError({ kind: "InvalidArgument", message });
}

export async function freeSlots(
  ctx: QueryCtx,
  agentId: Id<"agents">,
): Promise<Doc<"availability">[]> {
  const slots = await ctx.db
    .query("availability")
    .withIndex("by_agentId_and_start", (q) => q.eq("agentId", agentId))
    .take(SLOT_SCAN_LIMIT);
  return slots.filter((slot) => slot.booked < slot.capacity);
}

export const book = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    agentId: v.id("agents"),
    availabilityId: v.id("availability"),
  },
  handler: async (
    ctx,
    { sessionId, agentId, availabilityId },
  ): Promise<BookingResult> => {
    const session = await ctx.db.get("sessions", sessionId);
    if (session?.status !== "active") invalid("the room is not open");
    const member = await ctx.db
      .query("participants")
      .withIndex("by_agentId_and_sessionId", (q) =>
        q.eq("agentId", agentId).eq("sessionId", sessionId),
      )
      .first();
    if (member?.kind !== "agent" || member.role !== "recipient") {
      invalid("the provider is not in this room");
    }
    const slot = await ctx.db.get("availability", availabilityId);
    if (slot?.agentId !== agentId) invalid("the slot is not this provider's");
    const offering = await ctx.db.get("offerings", slot.offeringId);
    if (!offering) invalid("the slot's offering is missing");

    const booked = (transactionId: Id<"transactions">, total: Money) => ({
      status: "booked" as const,
      transactionId,
      offeringName: offering.name,
      start: slot.start,
      end: slot.end,
      total,
    });
    const roomBookings = await ctx.db
      .query("transactions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(ROOM_BOOKING_LIMIT);
    const existing = roomBookings.find(
      (tx) =>
        tx.status === "confirmed" &&
        tx.lines.some((line) => line.availabilityId === availabilityId),
    );
    if (existing) return booked(existing._id, existing.total);
    if (slot.booked >= slot.capacity) return { status: "unavailable" };

    const total = offering.price ?? { amount: 0, currency: DEFAULT_CURRENCY };
    const transactionId = await ctx.db.insert("transactions", {
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
    return booked(transactionId, total);
  },
});
