import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Stress fixtures for the rooms list, shaped like `api.rooms.minePage`. Dev only: `/room?data=worst`.
// provider.name max 120 (shared/agent.ts:15); intent is a slug, max 64 (shared/scope.ts:5).

export type RoomSummary = FunctionReturnType<
  typeof api.rooms.minePage
>["page"][number];

const NOW = Date.now();
const DAY = 86_400_000;
const id = (n: number) => `worst${n}` as Id<"sessions">;
const room = (
  n: number,
  name: string,
  intent: string,
  status: RoomSummary["status"],
  lastActivityTime: number,
): RoomSummary => ({
  sessionId: id(n),
  status,
  intent,
  provider: { name, slug: `agente_${n}` },
  lastActivityTime,
});

const WORST: RoomSummary[] = [
  room(
    1,
    "Agendamiento y Reservas Centro Médico Integral Universidad Católica Sede Providencia–Las Condes–Vitacura",
    "solicitar_presupuesto_ortodoncia_invisible_con_financiamiento",
    "terminated",
    NOW - 5 * 60_000,
  ),
  room(
    2,
    "Agendamiento Clínica Providencia Salud — Sede Pedro de Valdivia",
    "check_availability",
    "requested",
    NOW - 2 * 3_600_000,
  ),
  room(
    3,
    "Agendamiento Clínica Providencia Salud — Sede Manuel Montt",
    "book",
    "active",
    NOW - 3 * 3_600_000,
  ),
  room(4, "Q", "ask_info", "closed", NOW - DAY),
  room(
    5,
    "www.ferreteriaelpernoyherramientasindustriales.cl",
    "request_quote",
    "active",
    NOW - 3 * DAY,
  ),
  room(6, "🐾 Veterinaria La Reina 24/7", "book", "closed", NOW - 6 * DAY),
  room(7, "Phở Sài Gòn Ñuñoa", "place_order", "terminated", NOW - 7 * DAY),
  room(
    8,
    "Restaurant Al Shami مطعم الشام",
    "browse_catalog",
    "closed",
    Date.parse("2026-03-22T12:00:00-03:00"),
  ),
  room(
    9,
    "Centro Dental Ñuñoa",
    "cancel_booking",
    "closed",
    Date.parse("2026-02-22T09:30:00-03:00"),
  ),
  room(
    10,
    "Café Apoquindo",
    "book",
    "closed",
    Date.parse("2025-11-22T10:00:00-03:00"),
  ),
];

const NAMES = [
  "Café Apoquindo",
  "Centro Dental Ñuñoa",
  "Hotel Providencia Suites",
  "Ferretería El Perno",
];
const INTENTS = ["book", "ask_info", "place_order", "request_quote"];
const STATUSES: RoomSummary["status"][] = [
  "active",
  "closed",
  "requested",
  "terminated",
];

// Five pages of api.rooms.minePage.
const MANY: RoomSummary[] = Array.from({ length: 100 }, (_, i) =>
  room(
    100 + i,
    NAMES[i % 4],
    INTENTS[i % 4],
    STATUSES[i % 4],
    NOW - i * 9 * 3_600_000,
  ),
);

export const ROOMS_DATASETS = {
  real: { label: "Real", rooms: undefined },
  worst: { label: "Peor caso", rooms: WORST },
  empty: { label: "Vacía", rooms: [] },
  one: {
    label: "Una",
    rooms: [room(1, "Café Apoquindo", "book", "active", NOW)],
  },
  many: { label: "100 salas", rooms: MANY },
} satisfies Record<string, { label: string; rooms: RoomSummary[] | undefined }>;

export type RoomsDataset = keyof typeof ROOMS_DATASETS;

export function isRoomsDataset(value: unknown): value is RoomsDataset {
  return typeof value === "string" && Object.hasOwn(ROOMS_DATASETS, value);
}
