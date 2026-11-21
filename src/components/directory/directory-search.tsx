"use client";

import { Button } from "@ui-sdk/react/button";
import { Input } from "@ui-sdk/react/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Toggle } from "@ui-sdk/react/toggle";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  Check,
  List,
  LocateFixed,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard } from "@/convex/directory";
import type { LatLng } from "@/shared/geo";
import { COMUNAS, MAX_QUERY_LENGTH } from "../../../lib/directory";
import { intentLabel } from "../room/room-format";
import { cardDistance, categoryTree, pluralAgents } from "./directory-format";
import DirectoryList from "./directory-list";
import { DirectoryMap } from "./directory-map";
import { OpenSessionDialog } from "./open-session-dialog";
import { SiteHeader } from "./site-header";

const ALL = "all";
const MAX_INTENT_FILTERS = 6;
const DEFAULT_RADIUS_KM = 5;

type Sort = "relevance" | "distance" | "name";
type Geo =
  | { state: "off" }
  | { state: "locating" }
  | { state: "on"; origin: LatLng }
  | { state: "error"; message: string };

const SORT_LABELS: Record<Sort, string> = {
  relevance: "Relevancia",
  distance: "Distancia",
  name: "Nombre",
};

export function DirectorySearch() {
  const [category, setCategory] = useState<string | null>(null);
  const [comuna, setComuna] = useState<string | null>(null);
  const [intents, setIntents] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [includeProspects, setIncludeProspects] = useState(true);
  const [geo, setGeo] = useState<Geo>({ state: "off" });
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [sort, setSort] = useState<Sort>("relevance");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [converse, setConverse] = useState<DirectoryCard | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const result = useQuery(api.directory.search, {
    category: category ?? undefined,
    comuna: comuna ?? undefined,
  });
  const categories = useQuery(api.directory.categories, {});

  const origin = geo.state === "on" ? geo.origin : null;

  const distances = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of result?.agents ?? []) {
      const km = cardDistance(card, origin);
      if (km !== undefined) map.set(card.agentId, km);
    }
    return map;
  }, [result, origin]);

  const intentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of result?.agents ?? [])
      for (const intent of card.allowedIntents)
        counts.set(intent, (counts.get(intent) ?? 0) + 1);
    for (const intent of intents)
      if (!counts.has(intent)) counts.set(intent, 0);
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, Math.max(MAX_INTENT_FILTERS, intents.length))
      .map(([intent]) => intent);
  }, [result, intents]);

  const cards = useMemo(() => {
    const list = (result?.agents ?? []).filter(
      (card) =>
        (includeProspects || card.status !== "prospect") &&
        (!verifiedOnly || card.verified) &&
        intents.every((i) => card.allowedIntents.includes(i)) &&
        (!origin || (distances.get(card.agentId) ?? Infinity) <= radiusKm),
    );
    if (sort === "name")
      return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (sort === "distance")
      return [...list].sort(
        (a, b) =>
          (distances.get(a.agentId) ?? Infinity) -
          (distances.get(b.agentId) ?? Infinity),
      );
    return list;
  }, [
    result,
    includeProspects,
    verifiedOnly,
    intents,
    origin,
    distances,
    radiusKm,
    sort,
  ]);

  const categoryLabel = categories?.find((c) => c.slug === category)?.label;

  function locate() {
    if (geo.state === "on" || geo.state === "locating") {
      setGeo({ state: "off" });
      if (sort === "distance") setSort("relevance");
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeo({
        state: "error",
        message: "Tu navegador no comparte ubicación.",
      });
      return;
    }
    setGeo({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGeo({
          state: "on",
          origin: { lat: coords.latitude, lng: coords.longitude },
        });
        setSort("distance");
      },
      () =>
        setGeo({
          state: "error",
          message: "No pudimos obtener tu ubicación. Revisa el permiso.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function clearAll() {
    setCategory(null);
    setComuna(null);
    setIntents([]);
    setVerifiedOnly(false);
    setIncludeProspects(true);
    setGeo({ state: "off" });
    setRadiusKm(DEFAULT_RADIUS_KM);
    setSort("relevance");
  }

  const active: { key: string; label: string; remove: () => void }[] = [
    ...(categoryLabel
      ? [
          {
            key: "category",
            label: categoryLabel,
            remove: () => setCategory(null),
          },
        ]
      : []),
    ...(comuna
      ? [{ key: "comuna", label: comuna, remove: () => setComuna(null) }]
      : []),
    ...(origin
      ? [
          {
            key: "near",
            label: `A ${radiusKm} km de ti`,
            remove: () => setGeo({ state: "off" }),
          },
        ]
      : []),
    ...intents.map((intent) => ({
      key: `intent-${intent}`,
      label: intentLabel(intent),
      remove: () => setIntents((list) => list.filter((i) => i !== intent)),
    })),
    ...(verifiedOnly
      ? [
          {
            key: "verified",
            label: "Solo verificados",
            remove: () => setVerifiedOnly(false),
          },
        ]
      : []),
    ...(!includeProspects
      ? [
          {
            key: "prospects",
            label: "Sin los no reclamados",
            remove: () => setIncludeProspects(true),
          },
        ]
      : []),
  ];

  const summary = [
    categoryLabel,
    comuna,
    origin ? `a ${radiusKm} km de ti` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh">
      <SiteHeader current="directory" />

      <section
        aria-label="Búsqueda"
        className="flex flex-col gap-3.5 border-b border-border px-4 py-5 sm:px-6"
      >
        <TextSearch
          onInterpreted={({ category, comuna }) => {
            setCategory(category);
            setComuna(comuna);
          }}
        />

        <Button
          className="inline-flex items-center gap-1.5 self-start sm:!hidden"
          aria-expanded={filtersOpen}
          aria-controls="directory-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden size={15} />
          Filtros{active.length > 0 ? ` · ${active.length}` : ""}
        </Button>

        <div
          id="directory-filters"
          className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-center gap-2 sm:flex`}
        >
          {categories ? (
            <Select
              value={category ?? ALL}
              onValueChange={(value) =>
                setCategory(!value || value === ALL ? null : value)
              }
            >
              <SelectLabel className="sr-only">Categoría</SelectLabel>
              <SelectTrigger
                className={`!h-9 !text-[13px] ${category ? "!border-foreground" : ""}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las categorías</SelectItem>
                {categoryTree(categories).map(({ category: c, depth }) => (
                  <SelectItem
                    key={c.slug}
                    value={c.slug}
                    className={depth > 0 ? "!ps-6" : ""}
                  >
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Select
            value={comuna ?? ALL}
            onValueChange={(value) =>
              setComuna(!value || value === ALL ? null : value)
            }
          >
            <SelectLabel className="sr-only">Comuna</SelectLabel>
            <SelectTrigger
              className={`!h-9 !text-[13px] ${comuna ? "!border-foreground" : ""}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las comunas</SelectItem>
              {COMUNAS.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Toggle
            pressed={geo.state === "on" || geo.state === "locating"}
            onPressedChange={locate}
            className="inline-flex !h-9 items-center gap-1.5 !rounded-full !px-3 text-[13px] data-pressed:!border-primary data-pressed:!bg-primary data-pressed:!text-primary-foreground"
          >
            <LocateFixed aria-hidden size={15} />
            {geo.state === "locating" ? "Ubicando…" : "Cerca de mí"}
          </Toggle>

          {origin ? (
            <div className="inline-flex h-9 items-center gap-2.5 rounded-full bg-muted px-3.5">
              <span
                id="radius-label"
                className="text-[13px] text-subtle-foreground"
              >
                Radio
              </span>
              <Slider
                min={1}
                max={50}
                value={radiusKm}
                onValueChange={(value) =>
                  setRadiusKm(Array.isArray(value) ? value[0] : value)
                }
                className="w-30"
              >
                <SliderControl>
                  <SliderTrack>
                    <SliderIndicator />
                    <SliderThumb aria-labelledby="radius-label" />
                  </SliderTrack>
                </SliderControl>
              </Slider>
              <span className="min-w-12 text-[13px] tabular-nums">
                {radiusKm} km
              </span>
            </div>
          ) : null}

          {intentOptions.length > 0 ? (
            <>
              <span
                aria-hidden
                className="mx-1 hidden h-6 w-px bg-border sm:block"
              />
              <fieldset className="m-0 inline-flex flex-wrap items-center gap-1.5 border-0 p-0">
                <legend className="sr-only">Intención</legend>
                {intentOptions.map((intent) => {
                  const pressed = intents.includes(intent);
                  return (
                    <Toggle
                      key={intent}
                      pressed={pressed}
                      onPressedChange={(next) =>
                        setIntents((list) =>
                          next
                            ? [...list, intent]
                            : list.filter((i) => i !== intent),
                        )
                      }
                      className="inline-flex !h-8 items-center gap-1.5 !rounded-full !px-3 text-[13px] text-subtle-foreground data-pressed:text-foreground"
                    >
                      {pressed ? (
                        <Check aria-hidden size={13} strokeWidth={2} />
                      ) : null}
                      {intentLabel(intent)}
                    </Toggle>
                  );
                })}
              </fieldset>
            </>
          ) : null}

          <span
            aria-hidden
            className="mx-1 hidden h-6 w-px bg-border sm:block"
          />

          <label className="inline-flex min-h-9 items-center gap-2 text-[13px] text-subtle-foreground">
            <Switch checked={verifiedOnly} onCheckedChange={setVerifiedOnly}>
              <SwitchThumb />
            </Switch>
            Solo verificados
          </label>
          <label className="inline-flex min-h-9 items-center gap-2 text-[13px] text-subtle-foreground">
            <Switch
              checked={includeProspects}
              onCheckedChange={setIncludeProspects}
            >
              <SwitchThumb />
            </Switch>
            Incluir sin reclamar
          </label>
        </div>

        {geo.state === "error" ? (
          <p role="alert" className="m-0 text-[13px] text-destructive-text">
            {geo.message}
          </p>
        ) : null}

        {active.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="mr-0.5 text-xs text-subtle-foreground">
              Activos
            </span>
            {active.map((filter) => (
              <span
                key={filter.key}
                className="inline-flex h-7 items-center gap-0.5 rounded-full bg-muted pr-1 pl-2.5"
              >
                {filter.label}
                <Button
                  data-variant="ghost"
                  aria-label={`Quitar ${filter.label}`}
                  onClick={filter.remove}
                  className="!size-6 !p-0 text-subtle-foreground"
                >
                  <X aria-hidden size={12} strokeWidth={2} />
                </Button>
              </span>
            ))}
            <Button
              data-variant="ghost"
              data-size="sm"
              onClick={clearAll}
              className="underline underline-offset-3"
            >
              Limpiar todo
            </Button>
          </div>
        ) : null}
      </section>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main
          className={`${view === "map" ? "hidden lg:flex" : "flex"} min-h-0 w-full flex-col border-border lg:w-110 lg:flex-none lg:border-r`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <p
              aria-live="polite"
              className="m-0 text-[13px] text-subtle-foreground"
            >
              {result === undefined ? (
                "Buscando…"
              ) : (
                <>
                  <span className="font-medium text-foreground tabular-nums">
                    {pluralAgents(cards.length)}
                  </span>
                  {summary ? ` · ${summary}` : null}
                </>
              )}
            </p>
            <Select
              value={sort}
              onValueChange={(value) => {
                if (value) setSort(value as Sort);
              }}
            >
              <SelectLabel className="sr-only">Orden</SelectLabel>
              <SelectTrigger className="!h-8 !text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                  <SelectItem
                    key={key}
                    value={key}
                    disabled={key === "distance" && !origin}
                  >
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 lg:pb-4">
            {result === undefined || categories === undefined ? (
              <p className="m-0 text-subtle-foreground" data-testid="loading">
                Cargando…
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {result.truncated ? (
                  <p
                    className="m-0 text-[13px] text-subtle-foreground"
                    data-testid="partial"
                  >
                    Resultado parcial: se muestran las primeras{" "}
                    {result.agents.length} fichas.
                  </p>
                ) : null}
                {cards.length === 0 ? (
                  <div className="flex flex-col items-start gap-2 py-6">
                    <p className="m-0 font-medium">
                      No hay agentes con estos filtros.
                    </p>
                    {active.length > 0 ? (
                      <Button data-size="sm" onClick={clearAll}>
                        Limpiar filtros
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <DirectoryList
                    cards={cards}
                    categories={categories}
                    distances={distances}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onConverse={setConverse}
                  />
                )}
                {origin && radiusKm < 50 ? (
                  <p className="m-0 text-center text-xs text-subtle-foreground">
                    No hay más resultados en {radiusKm} km.{" "}
                    <Button
                      data-variant="ghost"
                      data-size="sm"
                      className="!h-auto !p-0 underline underline-offset-3"
                      onClick={() => setRadiusKm((km) => Math.min(km * 2, 50))}
                    >
                      Ampliar a {Math.min(radiusKm * 2, 50)} km
                    </Button>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </main>

        <DirectoryMap
          cards={cards}
          categories={categories ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
          origin={origin}
          radiusKm={origin ? radiusKm : null}
          className={`${view === "map" ? "block" : "hidden"} flex-1 lg:block`}
        />
      </div>

      <Button
        data-variant="solid"
        data-size="xl"
        onClick={() => setView((v) => (v === "list" ? "map" : "list"))}
        className="fixed bottom-7 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 shadow-[0_8px_24px_-6px_oklch(0_0_0/0.35)] lg:!hidden"
      >
        {view === "list" ? (
          <MapIcon aria-hidden size={18} />
        ) : (
          <List aria-hidden size={18} />
        )}
        {view === "list" ? "Ver mapa" : "Ver lista"}
      </Button>

      <OpenSessionDialog card={converse} onClose={() => setConverse(null)} />
    </div>
  );
}

type Interpretation = { category: string | null; comuna: string | null };

function TextSearch({
  onInterpreted,
}: {
  onInterpreted: (value: Interpretation) => void;
}) {
  const searchText = useAction(api.directory.searchText);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const query = text.trim();
    setNote(null);
    if (!query) {
      onInterpreted({ category: null, comuna: null });
      return;
    }
    setBusy(true);
    try {
      const { interpretation } = await searchText({ query });
      onInterpreted({
        category: interpretation.category,
        comuna: interpretation.comuna,
      });
      if (!interpretation.category && !interpretation.comuna) {
        setNote(
          interpretation.diagnostic === "llm_unavailable"
            ? "No reconocí una categoría ni una comuna, y el intérprete con IA no está disponible. Usa los filtros."
            : "No reconocí una categoría ni una comuna. Prueba con otras palabras o usa los filtros.",
        );
      } else if (interpretation.unresolved.length > 0) {
        setNote(
          `No reconocí ${interpretation.unresolved.includes("comuna") ? "la comuna" : "la categoría"}; filtramos por lo que sí entendí.`,
        );
      }
    } catch (error) {
      setNote(
        error instanceof ConvexError &&
          (error.data as { kind?: string })?.kind === "RateLimited"
          ? "Demasiadas búsquedas seguidas. Espera un momento."
          : "No pudimos interpretar la búsqueda. Usa los filtros.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex max-w-240 gap-2">
        <label htmlFor="dir-q" className="sr-only">
          ¿Qué necesitas?
        </label>
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            aria-hidden
            size={18}
            className="pointer-events-none absolute left-4 text-muted-foreground"
          />
          <Input
            id="dir-q"
            type="search"
            value={text}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder="¿Qué necesitas? ej. hora con cardiólogo en Providencia"
            className="!h-12 w-full !border-ring !pl-11 !text-[15px]"
          />
        </div>
        <Button
          type="submit"
          data-variant="solid"
          data-size="xl"
          aria-busy={busy}
          disabled={busy}
        >
          {busy ? "Buscando…" : "Buscar"}
        </Button>
      </form>
      {note ? (
        <p
          aria-live="polite"
          className="m-0 text-[13px] text-subtle-foreground"
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
