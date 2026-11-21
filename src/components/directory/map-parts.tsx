"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import type { LatLng } from "@/shared/geo";
import { isProspect } from "./agent-badges";
import { categoryIcon } from "./directory-format";

export type LocatedCard = DirectoryCard & { location: LatLng };

export type DirectoryMapProps = {
  cards: DirectoryCard[];
  categories: Category[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  origin: LatLng | null;
  radiusKm: number | null;
  className?: string;
};

/** Cards with a location, grouped by exact coordinate: one pin per address. */
export function useMapPins(cards: DirectoryCard[], selectedId: string | null) {
  const located = useMemo(
    () => cards.filter((c): c is LocatedCard => !!c.location),
    [cards],
  );
  const pins = useMemo(() => {
    const groups = new Map<string, LocatedCard[]>();
    for (const card of located) {
      const key = `${card.location.lat},${card.location.lng}`;
      groups.set(key, [...(groups.get(key) ?? []), card]);
    }
    return [...groups.values()];
  }, [located]);
  const selectedPin = pins.find((pin) =>
    pin.some((c) => c.agentId === selectedId),
  );
  const selected = selectedPin?.find((c) => c.agentId === selectedId);
  return { located, pins, selectedPin, selected };
}

export function revealCard(onSelect: (agentId: string) => void) {
  return (agentId: string) => {
    onSelect(agentId);
    document.getElementById(`agent-${agentId}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  };
}

/** What a pin shows and which card a click on it selects: the next one at that address. */
export function pinState(pin: LocatedCard[], selectedId: string | null) {
  const card = pin.find((c) => c.agentId === selectedId) ?? pin[0];
  const isSelected = card.agentId === selectedId;
  const prospect = pin.every(isProspect);
  return {
    card,
    isSelected,
    prospect,
    next: pin[(pin.indexOf(card) + (isSelected ? 1 : 0)) % pin.length],
    label:
      pin.length > 1
        ? `${pin.length} agentes en la misma dirección: ${pin.map((c) => c.name).join(", ")}`
        : `${card.name}${prospect ? " (sin reclamar)" : ""}`,
  };
}

/** The pin's look; the map that places it decides what receives the click. */
export function PinMark({
  pin,
  selectedId,
  categories,
  className = "",
  style,
}: {
  pin: LocatedCard[];
  selectedId: string | null;
  categories: Category[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const { card, isSelected, prospect } = pinState(pin, selectedId);
  const Icon = categoryIcon(card.categories, categories);
  return (
    <span
      aria-hidden
      className={`relative grid size-9 origin-bottom-left translate-x-1/2 place-items-center rounded-[50%_50%_50%_0] transition-[scale] duration-200 ease-[var(--ease-out)] [rotate:-45deg] motion-reduce:transition-none ${
        isSelected
          ? "z-20 scale-[1.2] bg-primary text-primary-foreground shadow-[0_0_0_3px_color-mix(in_oklch,var(--ui-primary)_20%,transparent)]"
          : prospect
            ? "z-10 border-2 border-foreground bg-card text-foreground active:scale-[0.92]"
            : "z-10 bg-card text-foreground shadow-card active:scale-[0.92]"
      } ${className}`}
      style={style}
    >
      <Icon size={16} className="rotate-45" />
      {pin.length > 1 ? (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 rotate-45 place-items-center rounded-full bg-foreground px-1 text-[11px] font-medium text-background tabular-nums"
        >
          {pin.length}
        </span>
      ) : null}
    </span>
  );
}

export function PinButton({
  pin,
  selectedId,
  categories,
  onSelect,
  className = "",
  style,
}: {
  pin: LocatedCard[];
  selectedId: string | null;
  categories: Category[];
  onSelect: (agentId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { next, label, isSelected } = pinState(pin, selectedId);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isSelected}
      onClick={() => onSelect(next.agentId)}
      className={`${isSelected ? "z-20" : "z-10"} cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
      style={style}
    >
      <PinMark pin={pin} selectedId={selectedId} categories={categories} />
    </button>
  );
}

export function SelectedCard({
  pin,
  selected,
  onSelect,
  className = "",
  style,
}: {
  pin: LocatedCard[];
  selected: LocatedCard;
  onSelect: (agentId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`flex w-70 flex-col gap-2 rounded-3xl bg-card p-4 text-foreground shadow-card transition-[opacity,scale] duration-200 ease-[var(--ease-out)] starting:scale-[0.96] starting:opacity-0 motion-reduce:transition-none ${className}`}
      style={style}
    >
      <span className="text-[15px] font-medium">{selected.name}</span>
      <span className="line-clamp-2 text-[13px] leading-normal text-subtle-foreground">
        {selected.purpose}
      </span>
      {pin.length > 1 ? (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <span className="text-xs text-subtle-foreground">
            También en esta dirección
          </span>
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto overscroll-contain">
            {pin
              .filter((c) => c !== selected)
              .map((c) => (
                <button
                  key={c.agentId}
                  type="button"
                  onClick={() => onSelect(c.agentId)}
                  className="shrink-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-medium text-foreground underline-offset-3 hover:underline"
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>
      ) : null}
      <Link
        href={`/directory/${selected.slug}`}
        className="press inline-flex h-8 items-center self-start rounded-full border border-input px-3 text-[13px] font-medium text-foreground no-underline hover:bg-muted"
      >
        Ver ficha
      </Link>
    </div>
  );
}

export function MapLegend({ origin }: { origin: LatLng | null }) {
  return (
    <div className="absolute bottom-4 left-4 flex gap-3.5 rounded-2xl bg-card px-3 py-2 text-xs text-subtle-foreground shadow-card">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-foreground" />
        Activo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full border-2 border-foreground" />
        Sin reclamar
      </span>
      {origin ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--sm-map-you)]" />
          Tú
        </span>
      ) : null}
    </div>
  );
}

export function EmptyMapNote({ cards }: { cards: DirectoryCard[] }) {
  return (
    <p className="pointer-events-none absolute inset-0 m-0 grid place-items-center text-subtle-foreground">
      {cards.length === 0
        ? "Sin resultados."
        : "Ningún resultado tiene ubicación."}
    </p>
  );
}
