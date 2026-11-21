"use client";

import { Button } from "@ui-sdk/react/button";
import { Minus, Plus } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LatLng } from "@/shared/geo";
import {
  type DirectoryMapProps,
  EmptyMapNote,
  MapLegend,
  PinButton,
  revealCard,
  SelectedCard,
  useMapPins,
} from "./map-parts";

const KM_PER_DEG_LAT = 110.574;
const MIN_SPAN_KM = 2;
const PADDING = { x: 104, top: 64, bottom: 96 };
const MAX_ZOOM = 8;

type Size = { width: number; height: number };
type Point = { x: number; y: number };

const MIDDLE_BUTTON = 1;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * A schematic map: pins sit at their real relative positions (equirectangular, km-scaled), on a
 * plain grid. No tiles, no streets, so nothing on it pretends to be geography it doesn't know.
 */
function useProjection(points: LatLng[], size: Size, zoom: number, pan: Point) {
  return useMemo(() => {
    if (points.length === 0 || size.width === 0) return null;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng0 = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const kmPerDegLng = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    const spanX = Math.max(
      (Math.max(...lngs) - Math.min(...lngs)) * kmPerDegLng,
      MIN_SPAN_KM,
    );
    const spanY = Math.max(
      (Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG_LAT,
      MIN_SPAN_KM,
    );
    const pxPerKm =
      Math.min(
        Math.max(size.width - PADDING.x * 2, 80) / spanX,
        Math.max(size.height - PADDING.top - PADDING.bottom, 80) / spanY,
      ) * zoom;
    const centerY =
      PADDING.top + (size.height - PADDING.top - PADDING.bottom) / 2;
    return {
      pxPerKm,
      project: (p: LatLng) => ({
        x: size.width / 2 + pan.x + (p.lng - lng0) * kmPerDegLng * pxPerKm,
        y: centerY + pan.y - (p.lat - lat0) * KM_PER_DEG_LAT * pxPerKm,
      }),
    };
  }, [points, size, zoom, pan]);
}

export function DirectoryMap({
  cards,
  categories,
  selectedId,
  onSelect,
  origin,
  radiusKm,
  className = "",
}: DirectoryMapProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [zoom, setZoom] = useState(1);
  const { located, pins, selectedPin, selected } = useMapPins(
    cards,
    selectedId,
  );

  const points = useMemo(() => {
    const list: LatLng[] = located.map((c) => c.location);
    if (origin) {
      list.push(origin);
      if (radiusKm) {
        const dLat = radiusKm / KM_PER_DEG_LAT;
        list.push(
          { lat: origin.lat + dLat, lng: origin.lng },
          { lat: origin.lat - dLat, lng: origin.lng },
        );
      }
    }
    return list;
  }, [located, origin, radiusKm]);

  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  // A new result set re-fits the map, so drop the old pan with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on points change only
  useEffect(() => setPan({ x: 0, y: 0 }), [points]);
  const projection = useProjection(points, size, zoom, pan);

  // Zoom around the view's center: the pan scales with the zoom.
  function zoomBy(factor: number) {
    const next = Math.min(Math.max(zoom * factor, 1), MAX_ZOOM);
    const ratio = next / zoom;
    setZoom(next);
    setPan((p) =>
      next === 1 ? { x: 0, y: 0 } : { x: p.x * ratio, y: p.y * ratio },
    );
  }

  // Pan with the middle button anywhere, or the main button on the background (pins stay clickable).
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const middle = event.button === MIDDLE_BUTTON;
    if (!middle && (event.button !== 0 || event.target !== event.currentTarget))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    drag.current = { ...start, x: event.clientX, y: event.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  const labels = useMemo(() => {
    const groups = new Map<string, LatLng[]>();
    for (const card of located) {
      const list = groups.get(card.location.comuna) ?? [];
      list.push(card.location);
      groups.set(card.location.comuna, list);
    }
    return [...groups].map(([comuna, list]) => ({
      comuna,
      lat: list.reduce((sum, p) => sum + p.lat, 0) / list.length,
      lng: list.reduce((sum, p) => sum + p.lng, 0) / list.length,
    }));
  }, [located]);

  const selectedAt = selected && projection?.project(selected.location);
  const select = revealCard(onSelect);

  return (
    <section
      aria-label="Mapa de resultados"
      className={`relative min-h-[520px] overflow-hidden lg:min-h-0 bg-[var(--sm-map-land)] ${className}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-to-pan is a pointer extra; the pins and zoom buttons are the keyboard path */}
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Stops the browser's middle-click autoscroll (and paste on Linux) over the map.
        onMouseDown={(event) => {
          if (event.button === MIDDLE_BUTTON) event.preventDefault();
        }}
        onAuxClick={(event) => event.preventDefault()}
        style={{
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing [background-image:linear-gradient(var(--sm-map-grid)_1px,transparent_1px),linear-gradient(90deg,var(--sm-map-grid)_1px,transparent_1px)] [background-size:48px_48px]"
      >
        {projection ? (
          <>
            {labels.map((label) => {
              const at = projection.project(label);
              return (
                <span
                  key={label.comuna}
                  aria-hidden
                  className="pointer-events-none absolute -translate-x-1/2 translate-y-6 text-[13px] tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase"
                  style={{ left: at.x, top: at.y }}
                >
                  {label.comuna}
                </span>
              );
            })}

            {origin ? (
              <OriginMark
                at={projection.project(origin)}
                radiusPx={radiusKm ? radiusKm * projection.pxPerKm : null}
              />
            ) : null}

            {pins.map((pin) => {
              const at = projection.project(pin[0].location);
              return (
                <PinButton
                  key={pin[0].agentId}
                  pin={pin}
                  selectedId={selectedId}
                  categories={categories}
                  onSelect={select}
                  className="!absolute -translate-x-1/2 -translate-y-full"
                  style={{ left: at.x, top: at.y }}
                />
              );
            })}

            {selectedPin && selected && selectedAt ? (
              <SelectedCard
                pin={selectedPin}
                selected={selected}
                onSelect={select}
                className="absolute z-30"
                style={{
                  left: Math.min(
                    Math.max(selectedAt.x + 32, 16),
                    Math.max(size.width - 296, 16),
                  ),
                  top: Math.min(
                    Math.max(selectedAt.y - 120, 64),
                    Math.max(size.height - 200, 16),
                  ),
                }}
              />
            ) : null}
          </>
        ) : (
          <EmptyMapNote cards={cards} />
        )}
      </div>

      <div className="absolute right-4 bottom-4 flex flex-col overflow-hidden rounded-2xl bg-card shadow-card">
        <Button
          data-variant="ghost"
          aria-label="Acercar"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomBy(1.5)}
          className="!size-10 !rounded-none !p-0"
        >
          <Plus aria-hidden size={16} />
        </Button>
        <Button
          data-variant="ghost"
          aria-label="Alejar"
          disabled={zoom <= 1}
          onClick={() => zoomBy(1 / 1.5)}
          className="!size-10 !rounded-none border-t border-border !p-0"
        >
          <Minus aria-hidden size={16} />
        </Button>
      </div>

      <MapLegend origin={origin} />
    </section>
  );
}

function OriginMark({
  at,
  radiusPx,
}: {
  at: { x: number; y: number };
  radiusPx: number | null;
}) {
  return (
    <>
      {radiusPx ? (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full border-[1.5px] border-dashed border-foreground bg-[color-mix(in_oklch,var(--ui-foreground)_5%,transparent)]"
          style={{
            left: at.x - radiusPx,
            top: at.y - radiusPx,
            width: radiusPx * 2,
            height: radiusPx * 2,
          }}
        />
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute size-4.5 -translate-1/2 rounded-full border-3 border-card bg-[var(--sm-map-you)]"
        style={{ left: at.x, top: at.y }}
      />
    </>
  );
}
