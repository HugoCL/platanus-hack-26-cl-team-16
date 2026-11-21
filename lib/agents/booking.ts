import type { Money } from "../../shared/catalog";

// What booking a slot from a room gives the provider agent back. A room holds one booking, so
// `booked` may describe the slot the room booked before; `created` says whether this call made it.
export type Booking =
  | {
      status: "booked";
      offeringId: string;
      offeringName: string;
      start: number;
      end: number;
      total: Money;
      created: boolean;
    }
  | { status: "unavailable"; offeringId: string };
