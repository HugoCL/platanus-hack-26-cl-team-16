import type { Money } from "../../shared/catalog";

// What booking a slot from a room gives the provider agent back. A room holds one booking, so
// `booked` may describe the slot the room booked before.
export type Booking =
  | {
      status: "booked";
      offeringId: string;
      offeringName: string;
      start: number;
      end: number;
      total: Money;
    }
  | { status: "unavailable"; offeringId: string };
