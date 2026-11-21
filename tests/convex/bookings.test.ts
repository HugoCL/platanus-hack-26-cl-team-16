// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { freeSlots } from "../../convex/bookings";
import schema from "../../convex/schema";
import { Transaction } from "../../shared/catalog";
import { CLINIC_AGENT_SLUG, CONSUMER_AGENT_SLUG } from "../../shared/seedData";
import { agentBySlug, insertRoom } from "./rooms";

const modules = import.meta.glob("../../convex/**/*.ts");
const createTest = () => convexTest(schema, modules);
let t: ReturnType<typeof createTest>;

beforeEach(async () => {
  t = createTest();
  await t.mutation(internal.seed.ensure, {});
});

const room = (providerSlug = CLINIC_AGENT_SLUG, status?: "closed") =>
  t.run((ctx) => insertRoom(ctx, providerSlug, { status }));

const book = (
  r: { sessionId: Id<"sessions">; providerId: Id<"agents"> },
  availabilityId: Id<"availability">,
) =>
  t.mutation(internal.bookings.book, {
    sessionId: r.sessionId,
    agentId: r.providerId,
    availabilityId,
  });

const free = (agentId: Id<"agents">) =>
  t.run(async (ctx) => (await freeSlots(ctx, agentId)).map((s) => s._id));

const slot = (id: Id<"availability">) =>
  t.run(async (ctx) => ctx.db.get("availability", id));

const roomBookings = (sessionId: Id<"sessions">) =>
  t.run((ctx) =>
    ctx.db
      .query("transactions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .collect(),
  );

describe("bookings", () => {
  it("lists a provider's free slots in start order", async () => {
    const r = await room();
    const slots = await t.run(async (ctx) => freeSlots(ctx, r.providerId));
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.start)).toEqual(
      [...slots.map((s) => s.start)].sort((a, b) => a - b),
    );
  });

  it("booking marks the slot as taken and records the room's booking", async () => {
    const r = await room();
    const [first] = await free(r.providerId);

    const result = await book(r, first);

    expect(result).toMatchObject({
      status: "booked",
      offeringName: "Consulta cardiología · Dra. Carolina Muñoz",
      total: { amount: 45000, currency: "CLP" },
    });
    expect((await slot(first))?.booked).toBe(1);
    const [tx] = await roomBookings(r.sessionId);
    expect(tx).toMatchObject({ agentId: r.providerId, status: "confirmed" });
    expect(tx.lines[0].availabilityId).toBe(first);
    expect(Transaction.safeParse(tx).success).toBe(true);
  });

  it("booking the same slot again from the same room returns the same booking", async () => {
    const r = await room();
    const [first] = await free(r.providerId);

    const once = await book(r, first);
    const twice = await book(r, first);

    expect(twice).toEqual(once);
    expect((await slot(first))?.booked).toBe(1);
    expect(await roomBookings(r.sessionId)).toHaveLength(1);
  });

  it("criterion 5: a taken slot is no longer free and another room cannot book it", async () => {
    const a = await room();
    const b = await room();
    const [first, second] = await free(a.providerId);

    await book(a, first);

    expect(await free(b.providerId)).not.toContain(first);
    expect(await free(b.providerId)).toContain(second);
    await expect(book(b, first)).resolves.toEqual({ status: "unavailable" });
    expect((await slot(first))?.booked).toBe(1);
    expect(await roomBookings(b.sessionId)).toEqual([]);
  });

  it("a slot with spare capacity takes one booking per room", async () => {
    const a = await room("hotel-providencia-suites");
    const b = await room("hotel-providencia-suites");
    const [night] = await free(a.providerId);

    await book(a, night);
    await book(b, night);

    expect(await slot(night)).toMatchObject({ booked: 2, capacity: 5 });
    expect(await free(a.providerId)).toContain(night);
  });

  it("refuses another provider's slot, a room without the provider, and a closed room", async () => {
    const clinicRoom = await room();
    const hotelRoom = await room("hotel-providencia-suites");
    const [hotelNight] = await free(hotelRoom.providerId);
    const [clinicSlot] = await free(clinicRoom.providerId);
    const closed = await room(CLINIC_AGENT_SLUG, "closed");
    const consumer = await t.run(
      async (ctx) => (await agentBySlug(ctx, CONSUMER_AGENT_SLUG))._id,
    );

    await expect(book(clinicRoom, hotelNight)).rejects.toThrow(
      "the slot is not this provider's",
    );
    await expect(
      book({ ...hotelRoom, providerId: clinicRoom.providerId }, clinicSlot),
    ).rejects.toThrow("the provider is not in this room");
    await expect(
      book({ ...clinicRoom, providerId: consumer }, clinicSlot),
    ).rejects.toThrow("the provider is not in this room");
    await expect(book(closed, clinicSlot)).rejects.toThrow(
      "the room is not open",
    );
    expect((await slot(clinicSlot))?.booked).toBe(0);
  });
});
