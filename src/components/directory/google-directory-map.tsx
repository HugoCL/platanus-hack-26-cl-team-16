"use client";

import {
  AdvancedMarker,
  APIProvider,
  Circle,
  ColorScheme,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";
import { useEffect, useMemo } from "react";
import type { LatLng } from "@/shared/geo";
import {
  type DirectoryMapProps,
  EmptyMapNote,
  MapLegend,
  PinMark,
  pinState,
  revealCard,
  SelectedCard,
  useMapPins,
} from "./map-parts";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
const SANTIAGO = { lat: -33.4372, lng: -70.6506 };
const YOU = "#3b82f6";
// Centers the selected pin lower than the middle so its card, drawn above it, stays in view.
const POPUP_LIFT_PX = 110;

export default function GoogleDirectoryMap({
  cards,
  categories,
  selectedId,
  onSelect,
  origin,
  radiusKm,
  className = "",
}: DirectoryMapProps) {
  const { resolvedTheme } = useTheme();
  const scheme =
    resolvedTheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT;
  const { located, pins, selectedPin, selected } = useMapPins(
    cards,
    selectedId,
  );
  const select = revealCard(onSelect);

  return (
    <section
      aria-label="Mapa de resultados"
      className={`relative min-h-[520px] overflow-hidden bg-[var(--sm-map-land)] lg:min-h-0 ${className}`}
    >
      <APIProvider apiKey={API_KEY} language="es" region="CL">
        <GoogleMap
          key={scheme}
          mapId={MAP_ID}
          colorScheme={scheme}
          defaultCenter={SANTIAGO}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          className="absolute inset-0"
        >
          <FitBounds
            points={located.map((c) => c.location)}
            origin={origin}
            radiusKm={radiusKm}
          />
          <PanToSelected at={selected?.location ?? null} />

          {origin ? (
            <>
              {radiusKm ? (
                <Circle
                  center={origin}
                  radius={radiusKm * 1000}
                  strokeColor={YOU}
                  strokeOpacity={0.7}
                  strokeWeight={1.5}
                  fillColor={YOU}
                  fillOpacity={0.06}
                  clickable={false}
                />
              ) : null}
              <AdvancedMarker
                position={origin}
                anchorLeft="-50%"
                anchorTop="-50%"
              >
                <span
                  aria-hidden
                  className="block size-4.5 rounded-full border-3 border-card bg-[var(--sm-map-you)] shadow-card"
                />
              </AdvancedMarker>
            </>
          ) : null}

          {pins.map((pin) => {
            const { isSelected, next, label } = pinState(pin, selectedId);
            return (
              <AdvancedMarker
                key={pin[0].agentId}
                position={pin[0].location}
                title={label}
                zIndex={isSelected ? 20 : 10}
                onClick={() => select(next.agentId)}
              >
                <PinMark
                  pin={pin}
                  selectedId={selectedId}
                  categories={categories}
                />
              </AdvancedMarker>
            );
          })}

          {selectedPin && selected ? (
            <AdvancedMarker
              position={selected.location}
              zIndex={30}
              anchorLeft="-50%"
              anchorTop="calc(-100% - 60px)"
            >
              <SelectedCard
                key={selected.agentId}
                className="origin-bottom"
                pin={selectedPin}
                selected={selected}
                onSelect={select}
              />
            </AdvancedMarker>
          ) : null}
        </GoogleMap>
      </APIProvider>

      {located.length === 0 ? <EmptyMapNote cards={cards} /> : null}
      <MapLegend origin={origin} />
    </section>
  );
}

/** Re-fits the view when the set of points changes, not on every render. */
function FitBounds({
  points,
  origin,
  radiusKm,
}: {
  points: LatLng[];
  origin: LatLng | null;
  radiusKm: number | null;
}) {
  const map = useMap();
  const all = useMemo(() => {
    const list = [...points];
    if (origin) {
      const dLat = (radiusKm ?? 0) / 110.574;
      list.push(
        origin,
        { lat: origin.lat + dLat, lng: origin.lng },
        { lat: origin.lat - dLat, lng: origin.lng },
      );
    }
    return list;
  }, [points, origin, radiusKm]);
  const key = all.map((p) => `${p.lat},${p.lng}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only when the coordinates change
  useEffect(() => {
    if (!map || all.length === 0) return;
    if (all.length === 1) {
      map.setCenter(all[0]);
      map.setZoom(15);
      return;
    }
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      { top: 72, bottom: 72, left: 48, right: 48 },
    );
  }, [map, key]);
  return null;
}

function PanToSelected({ at }: { at: LatLng | null }) {
  const map = useMap();
  const lat = at?.lat;
  const lng = at?.lng;
  useEffect(() => {
    if (!map || lat === undefined || lng === undefined) return;
    map.panTo({ lat, lng });
    map.panBy(0, -POPUP_LIFT_PX);
  }, [map, lat, lng]);
  return null;
}
