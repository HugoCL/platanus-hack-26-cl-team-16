import {
  BedDoubleIcon,
  BotIcon,
  CoffeeIcon,
  CroissantIcon,
  DumbbellIcon,
  FileTextIcon,
  HammerIcon,
  HeartPulseIcon,
  IdCardIcon,
  type LucideIcon,
  PawPrintIcon,
  PillIcon,
  ScaleIcon,
  ScissorsIcon,
  SmartphoneIcon,
  SmileIcon,
  StethoscopeIcon,
  StoreIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import { distanceKm, type LatLng } from "@/shared/geo";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  salud: HeartPulseIcon,
  cardiologia: HeartPulseIcon,
  medicina_general: StethoscopeIcon,
  odontologia: SmileIcon,
  hoteleria: BedDoubleIcon,
  cafeteria: CoffeeIcon,
  panaderia: CroissantIcon,
  ferreteria: HammerIcon,
  veterinaria: PawPrintIcon,
  peluqueria: ScissorsIcon,
  abogados: ScaleIcon,
  gasfiteria: WrenchIcon,
  gimnasio: DumbbellIcon,
  farmacia: PillIcon,
  asistente_personal: BotIcon,
};

export function categoryIcon(
  slugs: readonly string[],
  categories: readonly Category[],
): LucideIcon {
  for (const slug of slugs) {
    let current: string | null | undefined = slug;
    while (current) {
      const icon = CATEGORY_ICONS[current];
      if (icon) return icon;
      current = categories.find((c) => c.slug === current)?.parent;
    }
  }
  return StoreIcon;
}

const DATA_FIELD_ICONS: Record<string, LucideIcon> = {
  nombre: UserIcon,
  nombre_paciente: UserIcon,
  rut: IdCardIcon,
  telefono: SmartphoneIcon,
};

export function dataFieldIcon(field: string): LucideIcon {
  return DATA_FIELD_ICONS[field] ?? FileTextIcon;
}

export const KIND_LABELS: Record<DirectoryCard["kind"], string> = {
  hosted: "Hospedado",
  external: "Externo",
};

export const PROTOCOL_LABELS: Record<
  NonNullable<DirectoryCard["endpoint"]>["protocol"],
  string
> = { mcp: "MCP", a2a: "A2A", webhook: "Webhook" };

export function kindLabel(card: Pick<DirectoryCard, "kind" | "endpoint">) {
  const kind = KIND_LABELS[card.kind];
  return card.endpoint
    ? `${kind} · ${PROTOCOL_LABELS[card.endpoint.protocol]}`
    : kind;
}

const kmFormat = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatKm(km: number) {
  return `${kmFormat.format(km)} km`;
}

export function cardDistance(
  card: Pick<DirectoryCard, "location">,
  from: LatLng | null,
) {
  return from && card.location ? distanceKm(from, card.location) : undefined;
}

export function categoryLabels(
  slugs: readonly string[],
  categories: readonly Category[],
) {
  const labels = new Map(categories.map((c) => [c.slug, c.label]));
  return slugs.map((slug) => labels.get(slug) ?? slug).join(" · ");
}

/** Categories ordered as a tree: each root followed by its children. */
export function categoryTree(categories: readonly Category[]) {
  const byLabel = (a: Category, b: Category) =>
    a.label.localeCompare(b.label, "es");
  const roots = categories.filter((c) => c.parent === null).sort(byLabel);
  return roots.flatMap((root) => [
    { category: root, depth: 0 },
    ...categories
      .filter((c) => c.parent === root.slug)
      .sort(byLabel)
      .map((category) => ({ category, depth: 1 })),
  ]);
}

export function pluralAgents(count: number, more = false) {
  return `${count}${more ? "+" : ""} ${count === 1 && !more ? "agente" : "agentes"}`;
}
