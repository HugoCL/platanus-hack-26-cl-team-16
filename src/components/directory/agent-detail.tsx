"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { useQuery } from "convex/react";
import { ChevronDownIcon, ChevronLeftIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { Ledger, type LedgerRow, scopeRows } from "../ledger";
import { SiteFooter } from "../site-footer";
import { VerifiedBadge } from "../verified-badge";
import { isProspect, ProspectBadge } from "./agent-badges";
import {
  categoryIcon,
  categoryLabels,
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
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-4 pt-6 pb-18 sm:px-6">
        <nav aria-label="Ruta" className="text-caption">
          <Link
            href="/directory"
            className="inline-flex items-center gap-1 text-subtle-foreground no-underline hover:text-foreground"
          >
            <ChevronLeftIcon aria-hidden size={14} />
            Directorio
          </Link>
        </nav>
        {card === undefined || categories === undefined ? (
          <DetailSkeleton />
        ) : card === null ? (
          <div className="flex flex-col items-start gap-3">
            <h1 className="m-0 text-title font-semibold text-balance">
              No encontramos este agente
            </h1>
            <p className="m-0 text-subtle-foreground">
              Su ficha ya no está publicada o la dirección cambió.{" "}
              <Link href="/directory">Volver al directorio</Link>
            </p>
          </div>
        ) : (
          <Detail card={card} categories={categories} />
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

/** First sentence in the foreground, the rest quieter: the landing's two-tone headline. */
function splitPurpose(purpose: string): [string, string | null] {
  const match = purpose.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return match ? [match[1], match[2]] : [purpose, null];
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
  const own = card.slug === CONSUMER_AGENT_SLUG;
  const location = card.location;
  const address = location
    ? [location.address, location.comuna, location.region]
        .filter(Boolean)
        .join(", ")
    : null;
  const [lead, rest] = splitPurpose(card.purpose);
  const categoryText = categoryLabels(card.categories, categories);
  const blocked = prospect
    ? "Su dueño todavía no reclama este agente, así que aún no puede conversar."
    : own
      ? "Este es tu agente: habla por ti con los demás agentes del directorio."
      : null;

  const technical: LedgerRow[] = [
    {
      label: "Identificador",
      value: <span className="font-mono text-xs">{card.slug}</span>,
    },
    { label: "Tipo", value: kindLabel(card) },
    ...(card.allowedIntents.length
      ? [
          {
            label: "Intenciones",
            value: (
              <span className="font-mono text-xs">
                {card.allowedIntents.join(" · ")}
              </span>
            ),
          },
        ]
      : []),
    ...(card.endpoint
      ? [
          {
            label: "Protocolo",
            value: PROTOCOL_LABELS[card.endpoint.protocol],
          },
          {
            label: "Endpoint",
            value: (
              <span className="font-mono text-xs break-all">
                {card.endpoint.url}
              </span>
            ),
          },
        ]
      : []),
    ...(card.publicKey
      ? [
          {
            label: "Clave pública",
            value: (
              <span className="font-mono text-xs break-all">
                {card.publicKey}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1
          className={`m-0 text-title font-semibold text-balance ${prospect ? "text-subtle-foreground" : ""}`}
        >
          {card.name}
          {!prospect && card.verified ? (
            <VerifiedBadge
              size={22}
              className="ml-1.5 !inline-grid !h-7 !w-7 place-items-center align-[0.02em] [&>svg]:!size-[22px]"
            />
          ) : null}
        </h1>
        <p className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 font-mono text-xs font-medium text-subtle-foreground">
          {prospect ? <ProspectBadge /> : null}
          {!prospect && card.entityName && card.entityName !== card.name ? (
            <span>{card.entityName}</span>
          ) : null}
          {categoryText ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon aria-hidden size={14} />
              {categoryText}
            </span>
          ) : null}
          {location ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPinIcon aria-hidden size={14} />
              {location.comuna}
            </span>
          ) : null}
          <span>{kindLabel(card)}</span>
        </p>
        <p
          className={`m-0 mt-3 text-xl leading-[1.3] font-medium tracking-[-0.02em] text-pretty sm:text-2xl sm:leading-[1.3] ${prospect ? "text-subtle-foreground" : ""}`}
        >
          {lead}
          {rest ? <span className="text-headline-muted"> {rest}</span> : null}
        </p>

        {blocked ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-6">
            <Button data-variant="brand" data-size="xl" disabled>
              Conversar con este agente
            </Button>
            <p className="m-0 flex-[1_1_260px] text-caption text-pretty text-subtle-foreground">
              {blocked}
            </p>
          </div>
        ) : (
          // On a phone the action stays within thumb reach.
          <div className="mt-6 flex max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:mt-0 max-sm:bg-background max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:shadow-[0_-1px_0_var(--ui-border)]">
            <Button
              data-variant="brand"
              data-size="xl"
              className="max-sm:flex-1"
              onClick={() => setConverse(card)}
            >
              Conversar con este agente
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-10 border-t border-border pt-10">
        <section aria-labelledby="f-contract" className="flex flex-col gap-3">
          <h2
            id="f-contract"
            className="m-0 text-xl font-semibold tracking-tight"
          >
            Contrato
          </h2>
          <p className="m-0 -mt-1.5 text-pretty text-subtle-foreground">
            Lo que este agente puede hacer y pedir en una sala. Es lo mismo que
            verás antes de abrir una.
          </p>
          <Ledger
            rows={scopeRows({
              intents: card.allowedIntents,
              requests: card.scope.dataItRequests,
              shares: card.scope.dataItShares,
              forbidden: card.scope.forbiddenTopics,
            })}
          />
        </section>

        <section
          aria-labelledby="f-description"
          className="flex flex-col gap-3"
        >
          <h2
            id="f-description"
            className="m-0 text-xl font-semibold tracking-tight"
          >
            Descripción
          </h2>
          <p className="m-0 text-pretty text-subtle-foreground">
            {card.description}
          </p>
        </section>

        {location && address ? (
          <section aria-labelledby="f-location" className="flex flex-col gap-3">
            <h2
              id="f-location"
              className="m-0 text-xl font-semibold tracking-tight"
            >
              Ubicación
            </h2>
            <div
              aria-hidden
              className="relative h-50 overflow-hidden rounded-2xl bg-[var(--sm-map-land)] shadow-card [background-image:linear-gradient(var(--sm-map-grid)_1px,transparent_1px),linear-gradient(90deg,var(--sm-map-grid)_1px,transparent_1px)] [background-size:48px_48px]"
            >
              <span className="absolute top-1/2 left-1/2 grid size-8 -translate-1/2 place-items-center rounded-full bg-brand text-brand-ink shadow-selected">
                <Icon size={16} />
              </span>
            </div>
            <a
              href={`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=17/${location.lat}/${location.lng}`}
              target="_blank"
              rel="noreferrer"
              className="self-start text-caption"
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
            <ChevronDownIcon
              aria-hidden
              size={16}
              className="transition-transform group-data-[open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <Ledger rows={technical} className="mt-1 text-caption" />
          </CollapsiblePanel>
        </Collapsible>
      </div>

      <OpenSessionDialog card={converse} onClose={() => setConverse(null)} />
    </>
  );
}

const bar = "rounded-lg bg-muted motion-safe:animate-pulse";

/** The page's shape while the card loads: title, meta, purpose, action, four ledger rows. */
function DetailSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <span className="sr-only">Cargando agente…</span>
      <span aria-hidden className={`h-9 w-4/5 ${bar}`} />
      <span aria-hidden className={`h-4 w-3/5 ${bar}`} />
      <span aria-hidden className={`mt-3 h-7 w-full ${bar}`} />
      <span aria-hidden className={`h-7 w-2/3 ${bar}`} />
      <span aria-hidden className={`mt-6 h-12 w-64 max-w-full ${bar}`} />
      <div
        aria-hidden
        className="mt-7 flex flex-col border-t border-border pt-10"
      >
        <span className={`mb-4 h-6 w-28 ${bar}`} />
        {["w-full", "w-11/12", "w-full", "w-4/5"].map((width, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            key={index}
            className="flex h-10 items-center border-b border-border last:border-b-0"
          >
            <span className={`h-3.5 ${width} ${bar}`} />
          </span>
        ))}
      </div>
    </div>
  );
}
