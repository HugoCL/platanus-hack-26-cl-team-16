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
import { useAction, useQueries, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  Check,
  List,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard, DirectorySearchResult } from "@/convex/directory";
import type { LatLng } from "@/shared/geo";
import { COMUNAS, MAX_QUERY_LENGTH } from "../../../lib/directory";
import { intentLabel } from "../room/room-format";
import { cardDistance, categoryTree, pluralAgents } from "./directory-format";
import DirectoryList from "./directory-list";
import { DirectoryMap } from "./directory-map";
import { FixtureToggle, useFixtureState } from "./fixture-toggle";
import { OpenSessionDialog } from "./open-session-dialog";
import { SiteHeader } from "./site-header";
import { fixtureResult } from "./worst-case-fixture";

const ALL = "all";
const MAX_INTENT_FILTERS = 6;
const DEFAULT_RADIUS_KM = 5;
const PAGE_SIZE = 20;
const FIRST_PAGE = [0];
const INVITE_DISMISSED_KEY = "directory:location-invite-dismissed";

function isLocationInviteDismissed() {
  try {
    return Boolean(localStorage.getItem(INVITE_DISMISSED_KEY));
  } catch {
    return false;
  }
}

const GoogleDirectoryMap = dynamic(() => import("./google-directory-map"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1 bg-[var(--sm-map-land)]" />,
});
const MapView = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  ? GoogleDirectoryMap
  : DirectoryMap;

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    setDesktop(query.matches);
    const onChange = () => setDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

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
  const [withinRadius, setWithinRadius] = useState(true);
  const [sort, setSort] = useState<Sort>("relevance");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [converse, setConverse] = useState<DirectoryCard | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [fixture, setFixture] = useFixtureState();
  const origin = geo.state === "on" ? geo.origin : null;
  const near = sort === "distance" ? origin : null;
  // Changing only the order keeps how many pages the visitor loaded.
  const filterKey = `${category}|${comuna}|${verifiedOnly}|${includeProspects}`;
  const [more, setMore] = useState({ key: filterKey, pages: 1 });
  const pages = more.key === filterKey ? more.pages : 1;
  const {
    result: liveResult,
    loadingMore,
    loadedPages,
  } = usePagedSearch(
    { category, comuna, near, verifiedOnly, includeProspects },
    pages,
  );
  const result =
    fixture === "demo" ? liveResult : fixtureResult(fixture, liveResult);
  const categories = useQuery(api.directory.categories, {});

  const radiusFilter = origin && withinRadius ? radiusKm : null;

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
        (radiusFilter === null ||
          (distances.get(card.agentId) ?? Infinity) <= radiusFilter),
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
    distances,
    radiusFilter,
    sort,
  ]);

  const categoryLabel = categories?.find((c) => c.slug === category)?.label;

  const isDesktop = useIsDesktop();
  const [offerLocation, setOfferLocation] = useState(false);

  // Locate right away when the visitor already allowed it; otherwise offer it, never prompt on load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") startLocating(false);
        else if (status.state === "prompt" && !isLocationInviteDismissed())
          setOfferLocation(true);
      })
      .catch(() => {});
  }, []);

  function locate() {
    if (geo.state === "on" || geo.state === "locating") {
      setGeo({ state: "off" });
      if (sort === "distance") setSort("relevance");
      return;
    }
    startLocating(true);
  }

  // `filter` false only reorders by distance, as the invite promises; true also applies the radius.
  function startLocating(filter: boolean) {
    setOfferLocation(false);
    setWithinRadius(filter);
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
    setWithinRadius(true);
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
            label: radiusFilter ? `A ${radiusFilter} km de ti` : "Cerca de ti",
            remove: radiusFilter
              ? () => setWithinRadius(false)
              : () => setGeo({ state: "off" }),
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
    radiusFilter ? `a ${radiusFilter} km de ti` : origin ? "cerca de ti" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`flex min-h-dvh flex-col bg-background lg:h-dvh lg:min-h-0 lg:overflow-hidden ${view === "map" ? "max-lg:h-dvh max-lg:min-h-0 max-lg:overflow-hidden" : ""}`}
    >
      <SiteHeader current="directory" />

      <section
        aria-label="Búsqueda"
        className={`flex flex-col gap-3.5 border-b border-border px-4 sm:px-6 ${view === "map" ? "py-3 lg:py-5 [&>:not(:first-child)]:max-lg:hidden" : "py-5"}`}
      >
        <TextSearch
          onInterpreted={({ category, comuna }) => {
            setCategory(category);
            setComuna(comuna);
          }}
          trailing={
            view === "map" ? null : (
              <Button
                data-size="icon"
                className="relative !size-12 flex-none sm:!hidden"
                aria-expanded={filtersOpen}
                aria-controls="directory-filters"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal aria-hidden size={18} />
                <span className="sr-only">
                  Filtros{active.length > 0 ? ` · ${active.length}` : ""}
                </span>
                {active.length > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-micro font-medium text-primary-foreground tabular-nums"
                  >
                    {active.length}
                  </span>
                ) : null}
              </Button>
            )
          }
        />

        <div
          id="directory-filters"
          className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 sm:flex`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {categories ? (
              <Select
                value={category ?? ALL}
                onValueChange={(value) =>
                  setCategory(!value || value === ALL ? null : value)
                }
              >
                <SelectLabel className="sr-only">Categoría</SelectLabel>
                <SelectTrigger
                  className={`!h-9 !text-caption ${category ? "!border-foreground" : ""}`}
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
                className={`!h-9 !text-caption ${comuna ? "!border-foreground" : ""}`}
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
              className="inline-flex !h-9 items-center gap-1.5 !rounded-lg !px-3 text-caption data-pressed:!border-primary data-pressed:!bg-primary data-pressed:!text-primary-foreground"
            >
              <LocateFixed aria-hidden size={15} />
              {geo.state === "locating" ? "Ubicando…" : "Cerca de mí"}
            </Toggle>

            {origin ? (
              <div className="inline-flex h-9 items-center gap-2.5 rounded-lg bg-muted px-3.5">
                <span
                  id="radius-label"
                  className="text-caption text-subtle-foreground"
                >
                  Radio
                </span>
                <Slider
                  min={1}
                  max={50}
                  value={radiusKm}
                  onValueChange={(value) => {
                    setRadiusKm(Array.isArray(value) ? value[0] : value);
                    setWithinRadius(true);
                  }}
                  className="w-30"
                >
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb aria-labelledby="radius-label" />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
                <span className="min-w-12 text-caption tabular-nums">
                  {withinRadius ? `${radiusKm} km` : "Sin límite"}
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
              <label className="inline-flex min-h-9 items-center gap-2 text-caption text-subtle-foreground">
                <Switch
                  checked={verifiedOnly}
                  onCheckedChange={setVerifiedOnly}
                >
                  <SwitchThumb />
                </Switch>
                Solo verificados
              </label>
              <label className="inline-flex min-h-9 items-center gap-2 text-caption text-subtle-foreground">
                <Switch
                  checked={includeProspects}
                  onCheckedChange={setIncludeProspects}
                >
                  <SwitchThumb />
                </Switch>
                Incluir sin reclamar
              </label>
            </div>
          </div>

          {intentOptions.length > 0 ? (
            <fieldset className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0">
              <legend className="float-left mr-1.5 text-xs text-subtle-foreground">
                Qué puede hacer
              </legend>
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
                    className="inline-flex !h-8 items-center gap-1.5 !rounded-lg !px-3 text-caption text-subtle-foreground data-pressed:text-foreground"
                  >
                    {pressed ? (
                      <Check aria-hidden size={13} strokeWidth={2} />
                    ) : null}
                    {intentLabel(intent)}
                  </Toggle>
                );
              })}
            </fieldset>
          ) : null}
        </div>

        {offerLocation && geo.state === "off" ? (
          <div className="flex items-center gap-x-3 self-start rounded-2xl bg-muted py-1.5 pr-1.5 pl-3.5 text-caption max-sm:self-stretch">
            <LocateFixed aria-hidden size={15} className="flex-none" />
            <span className="min-w-0 flex-1">
              <span className="sm:hidden">¿Ver lo cercano?</span>
              <span className="max-sm:hidden">
                Comparte tu ubicación y te mostramos primero lo que está cerca.
              </span>
            </span>
            <div className="flex flex-none gap-1">
              <Button
                data-variant="solid"
                data-size="sm"
                onClick={() => startLocating(false)}
              >
                Usar mi ubicación
              </Button>
              <Button
                data-variant="ghost"
                data-size="sm"
                aria-label="Ahora no"
                onClick={() => {
                  setOfferLocation(false);
                  try {
                    localStorage.setItem(INVITE_DISMISSED_KEY, "1");
                  } catch {
                    // The invite is dismissed for this visit without storage.
                  }
                }}
                className="max-sm:!w-8 max-sm:!px-0"
              >
                <X aria-hidden size={14} className="sm:hidden" />
                <span className="max-sm:hidden">Ahora no</span>
              </Button>
            </div>
          </div>
        ) : null}

        {geo.state === "error" ? (
          <p role="alert" className="m-0 text-caption text-destructive-text">
            {geo.message}
          </p>
        ) : null}

        {active.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-caption">
            <span className="mr-0.5 text-xs text-subtle-foreground">
              Activos
            </span>
            {active.map((filter) => (
              <span
                key={filter.key}
                className="inline-flex h-7 items-center gap-0.5 rounded-lg bg-muted pr-1 pl-2.5"
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
              className="m-0 text-caption text-subtle-foreground"
            >
              {result === undefined ? (
                "Buscando…"
              ) : (
                <>
                  <span className="font-mono text-xs font-bold tracking-wider text-foreground uppercase tabular-nums">
                    {pluralAgents(cards.length, result.truncated)}
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
              <SelectTrigger className="!h-8 !text-caption">
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
              <div data-testid="loading" className="flex flex-col gap-3">
                <span className="sr-only">Cargando…</span>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="flex animate-pulse flex-col gap-3 rounded-3xl bg-card p-4 shadow-card"
                  >
                    <div className="flex items-start gap-3">
                      <span className="size-10 flex-none rounded-2xl bg-muted" />
                      <div className="flex flex-1 flex-col gap-2 pt-1">
                        <span className="h-4 w-3/5 rounded-sm bg-muted" />
                        <span className="h-3 w-2/5 rounded-sm bg-muted" />
                      </div>
                    </div>
                    <span className="h-3 w-full rounded-sm bg-muted" />
                    <div className="flex gap-2">
                      <span className="h-9 flex-1 rounded-2xl bg-muted" />
                      <span className="h-9 flex-1 rounded-2xl bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {cards.length === 0 ? (
                  <div className="flex flex-col items-start gap-2 py-6">
                    <p className="m-0 font-medium">
                      {active.length > 0
                        ? "No hay agentes con estos filtros."
                        : "Todavía no hay agentes en el directorio."}
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
                {result.nextOffset !== undefined ? (
                  <Button
                    data-testid="load-more"
                    className="self-center"
                    aria-busy={loadingMore}
                    disabled={loadingMore}
                    onClick={() =>
                      setMore({ key: filterKey, pages: loadedPages + 1 })
                    }
                  >
                    <span className="grid">
                      <span
                        className={`[grid-area:1/1] ${loadingMore ? "invisible" : ""}`}
                      >
                        Ver más agentes
                      </span>
                      {loadingMore ? (
                        <LoaderCircle
                          aria-label="Cargando"
                          size={16}
                          className="m-auto animate-spin [grid-area:1/1]"
                        />
                      ) : null}
                    </span>
                  </Button>
                ) : null}
                {radiusFilter && radiusFilter < 50 ? (
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

        {view === "map" || isDesktop ? (
          <MapView
            cards={cards}
            categories={categories ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
            origin={origin}
            radiusKm={radiusFilter}
            className="flex-1"
          />
        ) : null}
      </div>

      <Button
        data-variant="solid"
        data-size="xl"
        onClick={() => setView((v) => (v === "list" ? "map" : "list"))}
        className="fixed bottom-7 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 shadow-float lg:!hidden"
      >
        {view === "list" ? (
          <MapIcon aria-hidden size={18} />
        ) : (
          <List aria-hidden size={18} />
        )}
        {view === "list" ? "Ver mapa" : "Ver lista"}
      </Button>

      <OpenSessionDialog card={converse} onClose={() => setConverse(null)} />
      <FixtureToggle state={fixture} onChange={setFixture} />
    </div>
  );
}

type Interpretation = { category: string | null; comuna: string | null };

function TextSearch({
  onInterpreted,
  trailing,
}: {
  onInterpreted: (value: Interpretation) => void;
  trailing?: ReactNode;
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
            className="pointer-events-none absolute left-4 hidden text-muted-foreground sm:block"
          />
          <Input
            id="dir-q"
            type="search"
            enterKeyHint="search"
            aria-busy={busy}
            value={text}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder="¿Qué necesitas? ej. hora con cardiólogo en Providencia"
            className="!h-12 w-full !border-foreground !text-lead max-sm:!pr-11 sm:!pl-11"
          />
          <Button
            type="submit"
            data-variant="ghost"
            data-size="icon"
            aria-label="Buscar"
            aria-busy={busy}
            disabled={busy}
            className="absolute right-1 !size-10 !p-0 sm:!hidden"
          >
            {busy ? (
              <LoaderCircle aria-hidden size={18} className="animate-spin" />
            ) : (
              <Search aria-hidden size={18} />
            )}
          </Button>
        </div>
        <Button
          type="submit"
          data-variant="brand"
          data-size="xl"
          className="max-sm:!hidden"
          aria-busy={busy}
          disabled={busy}
        >
          {busy ? "Buscando…" : "Buscar"}
        </Button>
        {trailing}
      </form>
      {note ? (
        <p
          aria-live="polite"
          className="m-0 text-caption text-subtle-foreground"
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

function usePagedSearch(
  filters: {
    category: string | null;
    comuna: string | null;
    near: LatLng | null;
    verifiedOnly: boolean;
    includeProspects: boolean;
  },
  pages: number,
) {
  const { category, comuna, near, verifiedOnly, includeProspects } = filters;
  const args = useMemo(
    () => ({
      ...(category ? { category } : {}),
      ...(comuna ? { comuna } : {}),
      ...(near ? { near: { lat: near.lat, lng: near.lng } } : {}),
      ...(verifiedOnly ? { verifiedOnly } : {}),
      ...(includeProspects ? {} : { includeProspects }),
    }),
    [category, comuna, near, verifiedOnly, includeProspects],
  );
  const argsKey = JSON.stringify(args);
  // Each order pages from its own nextOffset, so the next page is requested once the previous one arrives.
  const [chain, setChain] = useState({ key: argsKey, offsets: FIRST_PAGE });
  const offsets = useMemo(
    () => (chain.key === argsKey ? chain.offsets : FIRST_PAGE).slice(0, pages),
    [chain, argsKey, pages],
  );
  const requests = useMemo(
    () =>
      Object.fromEntries(
        offsets.map((offset, page) => [
          String(page),
          {
            query: api.directory.search,
            args: { ...args, limit: PAGE_SIZE, offset },
          },
        ]),
      ),
    [args, offsets],
  );
  const results = useQueries(requests);
  const loaded: DirectorySearchResult[] = [];
  for (let page = 0; page < offsets.length; page++) {
    const value: DirectorySearchResult | Error | undefined =
      results[String(page)];
    if (value instanceof Error) throw value;
    if (value === undefined) break;
    loaded.push(value);
  }
  // Keep the merged result's identity while no page changed, so the map does not re-fit.
  const cache = useRef<{
    pages: DirectorySearchResult[];
    result: DirectorySearchResult | undefined;
  }>({ pages: [], result: undefined });
  if (
    loaded.length !== cache.current.pages.length ||
    loaded.some((page, i) => page !== cache.current.pages[i])
  ) {
    const last = loaded.at(-1);
    cache.current = {
      pages: loaded,
      result: last && {
        agents: loaded.flatMap((page) => page.agents),
        truncated: last.truncated && last.agents.length > 0,
        nextOffset: last.nextOffset,
      },
    };
  }
  const last = loaded.at(-1);
  const hasNext = last?.nextOffset !== undefined;
  if (loaded.length === offsets.length && offsets.length < pages && hasNext) {
    setChain({ key: argsKey, offsets: [...offsets, last?.nextOffset ?? 0] });
  }
  return {
    result: cache.current.result,
    loadedPages: loaded.length,
    loadingMore:
      loaded.length > 0 &&
      loaded.length < pages &&
      (loaded.length < offsets.length || hasNext),
  };
}
