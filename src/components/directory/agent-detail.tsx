"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { useQuery } from "convex/react";
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { dataFieldLabel, intentLabel } from "../room/room-format";
import { VerifiedBadge } from "../verified-badge";
import { isProspect, ProspectBadge } from "./agent-badges";
import {
  categoryIcon,
  categoryLabels,
  dataFieldIcon,
  kindLabel,
  PROTOCOL_LABELS,
} from "./directory-format";
import { OpenSessionDialog } from "./open-session-dialog";
import { SiteHeader } from "./site-header";

export function AgentDetail({ slug }: { slug: string }) {
  const card = useQuery(api.directory.get, { slug });
  const categories = useQuery(api.directory.categories, {});

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader current="directory" />
      <div className="mx-auto flex w-full max-w-280 flex-col gap-7 px-4 pt-6 pb-16 sm:px-6">
        <nav aria-label="Ruta" className="text-[13px]">
          <Link
            href="/directory"
            className="inline-flex items-center gap-1 text-subtle-foreground no-underline hover:text-foreground"
          >
            <ChevronLeft aria-hidden size={14} />
            Directorio
          </Link>
        </nav>
        {card === undefined || categories === undefined ? (
          <p className="m-0 text-subtle-foreground">Cargando…</p>
        ) : card === null ? (
          <div className="flex flex-col items-start gap-2">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">
              No encontramos este agente
            </h1>
            <p className="m-0 text-subtle-foreground">
              Puede que su ficha ya no esté publicada.
            </p>
          </div>
        ) : (
          <Detail card={card} categories={categories} />
        )}
      </div>
    </div>
  );
}

function Detail({
  card,
  categories,
}: {
  card: DirectoryCard;
  categories: Category[];
}) {
  const [converse, setConverse] = useState<DirectoryCard | null>(null);
  const Icon = categoryIcon(card.categories, categories);
  const prospect = isProspect(card);
  const location = card.location;
  const address = location
    ? [location.address, location.comuna, location.region]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <>
      <header className="flex flex-wrap items-start gap-5">
        <span
          aria-hidden
          className="grid size-16 flex-none place-items-center rounded-3xl bg-muted"
        >
          <Icon size={30} />
        </span>
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-1.5">
          <h1 className="m-0 flex items-center gap-1.5 text-[28px] leading-tight font-semibold tracking-tight">
            {card.name}
            {!prospect && card.verified ? <VerifiedBadge size={18} /> : null}
          </h1>
          {prospect ? (
            <ProspectBadge />
          ) : card.entityName && card.entityName !== card.name ? (
            <span className="text-subtle-foreground">{card.entityName}</span>
          ) : null}
          <p className="m-0 text-[13px] text-subtle-foreground">
            {[
              categoryLabels(card.categories, categories),
              location ? location.comuna : null,
              kindLabel(card),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <main className="flex min-w-0 flex-[999_1_480px] flex-col gap-8">
          <section aria-labelledby="f-purpose" className="flex flex-col gap-2">
            <h2
              id="f-purpose"
              className="m-0 text-xs font-medium text-subtle-foreground"
            >
              Propósito
            </h2>
            <p className="m-0 font-display text-[26px] leading-snug tracking-tight">
              {card.purpose}
            </p>
          </section>

          {card.allowedIntents.length > 0 ? (
            <section aria-labelledby="f-can" className="flex flex-col gap-3">
              <h2
                id="f-can"
                className="m-0 text-xl font-semibold tracking-tight"
              >
                Qué puede hacer
              </h2>
              <ul className="m-0 list-none rounded-3xl bg-card p-0 shadow-card">
                {card.allowedIntents.map((intent) => (
                  <li
                    key={intent}
                    className="flex flex-wrap justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <span className="font-medium">{intentLabel(intent)}</span>
                    <code className="!bg-transparent !p-0 font-mono text-xs text-subtle-foreground">
                      {intent}
                    </code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
            <section
              aria-labelledby="f-requests"
              className="flex flex-col gap-3 rounded-4xl bg-card p-5 shadow-card"
            >
              <h2 id="f-requests" className="m-0 text-base font-medium">
                Qué datos te va a pedir
              </h2>
              <Chips
                items={card.scope.dataItRequests}
                empty="No pide datos."
                render={(field) => {
                  const FieldIcon = dataFieldIcon(field);
                  return (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px]">
                      <FieldIcon aria-hidden size={14} />
                      {dataFieldLabel(field)}
                    </span>
                  );
                }}
              />
              <p className="m-0 text-[13px] text-subtle-foreground">
                Solo puede pedir estos datos. El moderador bloquea cualquier
                otro.
              </p>
            </section>
            <section
              aria-labelledby="f-shares"
              className="flex flex-col gap-3 rounded-4xl bg-card p-5 shadow-card"
            >
              <h2 id="f-shares" className="m-0 text-base font-medium">
                Qué datos comparte
              </h2>
              <Chips
                items={card.scope.dataItShares}
                empty="No comparte datos."
                render={(field) => (
                  <span className="inline-flex h-7 items-center rounded-full border border-input px-3 text-[13px]">
                    {dataFieldLabel(field)}
                  </span>
                )}
              />
            </section>
          </div>

          {card.scope.forbiddenTopics.length > 0 ? (
            <section
              aria-labelledby="f-forbidden"
              className="flex flex-col gap-2.5"
            >
              <h2 id="f-forbidden" className="m-0 text-base font-medium">
                Temas prohibidos
              </h2>
              <Chips
                items={card.scope.forbiddenTopics}
                empty=""
                render={(topic) => (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-destructive-soft px-3 text-[13px] font-medium text-destructive-text">
                    <Ban aria-hidden size={13} strokeWidth={2} />
                    {topic}
                  </span>
                )}
              />
              <p className="m-0 text-[13px] text-subtle-foreground">
                Si la conversación toca estos temas, el moderador interviene.
              </p>
            </section>
          ) : null}

          <section
            aria-labelledby="f-description"
            className="flex flex-col gap-2"
          >
            <h2 id="f-description" className="m-0 text-base font-medium">
              Descripción
            </h2>
            <p className="m-0 max-w-160 text-subtle-foreground">
              {card.description}
            </p>
          </section>

          {location && address ? (
            <section
              aria-labelledby="f-location"
              className="flex flex-col gap-2.5"
            >
              <h2 id="f-location" className="m-0 text-base font-medium">
                Ubicación
              </h2>
              <div
                aria-hidden
                className="relative h-50 overflow-hidden rounded-2xl bg-[var(--sm-map-land)] shadow-card [background-image:linear-gradient(var(--sm-map-grid)_1px,transparent_1px),linear-gradient(90deg,var(--sm-map-grid)_1px,transparent_1px)] [background-size:48px_48px]"
              >
                <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-full place-items-center rounded-[50%_50%_50%_0] bg-primary text-primary-foreground [rotate:-45deg]">
                  <MapPin size={16} className="rotate-45" />
                </span>
              </div>
              <a
                href={`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`}
                target="_blank"
                rel="noreferrer"
                className="self-start text-[13px]"
              >
                {address}
              </a>
            </section>
          ) : null}

          <Collapsible className="border-t border-border pt-4">
            <CollapsibleTrigger
              data-variant="ghost"
              className="group inline-flex items-center gap-1.5 !px-0 font-medium"
            >
              Detalles técnicos
              <ChevronDown
                aria-hidden
                size={16}
                className="transition-transform group-data-[open]:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
                <dt className="text-subtle-foreground">Tipo</dt>
                <dd className="m-0">{kindLabel(card)}</dd>
                {card.endpoint ? (
                  <>
                    <dt className="text-subtle-foreground">Protocolo</dt>
                    <dd className="m-0">
                      {PROTOCOL_LABELS[card.endpoint.protocol]}
                    </dd>
                    <dt className="text-subtle-foreground">Endpoint</dt>
                    <dd className="m-0 font-mono text-xs break-all">
                      {card.endpoint.url}
                    </dd>
                  </>
                ) : null}
                {card.publicKey ? (
                  <>
                    <dt className="text-subtle-foreground">Clave pública</dt>
                    <dd className="m-0 font-mono text-xs break-all">
                      {card.publicKey}
                    </dd>
                  </>
                ) : null}
                <dt className="text-subtle-foreground">Slug</dt>
                <dd className="m-0 font-mono text-xs">{card.slug}</dd>
              </dl>
            </CollapsiblePanel>
          </Collapsible>
        </main>

        <ConverseAside card={card} onConverse={() => setConverse(card)} />
      </div>

      <OpenSessionDialog card={converse} onClose={() => setConverse(null)} />
    </>
  );
}

function ConverseAside({
  card,
  onConverse,
}: {
  card: DirectoryCard;
  onConverse: () => void;
}) {
  if (isProspect(card)) {
    return (
      <aside
        aria-label="Conversar"
        className="flex max-w-full flex-[0_0_320px] flex-col gap-3.5 rounded-4xl bg-muted p-5.5 [background-image:var(--sm-hatch)] lg:sticky lg:top-6"
      >
        <ProspectBadge />
        <Button data-size="xl" disabled>
          Conversar con este agente
        </Button>
        <p className="m-0 text-[13px] text-subtle-foreground">
          Este agente fue pre-armado y aún no lo reclama su dueño.
        </p>
      </aside>
    );
  }

  const own = card.slug === CONSUMER_AGENT_SLUG;
  return (
    <aside
      aria-label="Conversar"
      className="flex max-w-full flex-[0_0_320px] flex-col gap-3.5 rounded-4xl bg-card p-5.5 shadow-card lg:sticky lg:top-6"
    >
      <Button
        data-variant="solid"
        data-size="xl"
        disabled={own}
        onClick={onConverse}
      >
        Conversar con este agente
      </Button>
      <p className="m-0 flex gap-2 text-[13px] text-subtle-foreground">
        <ShieldCheck aria-hidden size={16} className="mt-0.5 flex-none" />
        {own
          ? "Este es tu agente: habla por ti con los demás agentes del directorio."
          : "Las conversaciones son moderadas: tu agente y este solo pueden hablar dentro del propósito declarado."}
      </p>
      {own ? null : (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3.5 text-[13px]">
          <span className="font-medium">Antes de abrir verás el contrato</span>
          <span className="text-subtle-foreground">
            Intención, datos que pedirá, datos que comparte y temas prohibidos.
          </span>
        </div>
      )}
    </aside>
  );
}

function Chips({
  items,
  empty,
  render,
}: {
  items: string[];
  empty: string;
  render: (item: string) => React.ReactNode;
}) {
  if (items.length === 0)
    return <p className="m-0 text-[13px] text-subtle-foreground">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.map((item) => (
        <li key={item}>{render(item)}</li>
      ))}
    </ul>
  );
}
