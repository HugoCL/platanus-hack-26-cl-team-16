import { Button } from "@ui-sdk/react/button";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { hasIntentLabel, intentLabel } from "../room/room-format";
import { VerifiedBadge } from "../verified-badge";
import { isProspect, ProspectBadge } from "./agent-badges";
import { categoryIcon, formatKm, KIND_LABELS } from "./directory-format";

export type DirectoryListProps = {
  cards: DirectoryCard[];
  categories: Category[];
  distances?: ReadonlyMap<string, number>;
  selectedId?: string | null;
  onSelect?: (agentId: string) => void;
  onConverse?: (card: DirectoryCard) => void;
};

export default function DirectoryList({
  cards,
  categories,
  distances,
  selectedId,
  onSelect,
  onConverse,
}: DirectoryListProps) {
  const nameCounts = new Map<string, number>();
  for (const card of cards)
    nameCounts.set(card.name, (nameCounts.get(card.name) ?? 0) + 1);
  return (
    <ul className="m-0 list-none p-0" data-testid="directory">
      {cards.map((card) => (
        <AgentResult
          key={card.agentId}
          card={card}
          categories={categories}
          distance={distances?.get(card.agentId)}
          sharesName={(nameCounts.get(card.name) ?? 0) > 1}
          selected={card.agentId === selectedId}
          onSelect={onSelect}
          onConverse={onConverse}
        />
      ))}
    </ul>
  );
}

function AgentResult({
  card,
  categories,
  distance,
  sharesName,
  selected,
  onSelect,
  onConverse,
}: {
  card: DirectoryCard;
  categories: Category[];
  distance?: number;
  sharesName: boolean;
  selected: boolean;
  onSelect?: (agentId: string) => void;
  onConverse?: (card: DirectoryCard) => void;
}) {
  const prospect = isProspect(card);
  const Icon = categoryIcon(card.categories, categories);
  const where = [
    card.comuna,
    distance === undefined ? undefined : formatKm(distance),
  ]
    .filter(Boolean)
    .join(" · ");
  // Two agents with one name are told apart by their address.
  const address = sharesName
    ? (card.location?.address ?? card.entityName)
    : undefined;
  const detailsId = `agent-${card.agentId}-details`;
  const namedIntents = card.allowedIntents.filter(hasIntentLabel);
  const otherIntents = card.allowedIntents.length - namedIntents.length;

  return (
    // A guide row: the name is the row's select button and its ::before stretches over the row,
    // so a click anywhere selects it. The badge and the open row's actions sit above it.
    <li
      id={`agent-${card.agentId}`}
      data-testid="agent-card"
      data-slug={card.slug}
      data-status={card.status}
      data-selected={selected ? "" : undefined}
      className="guide-row scroll-m-4 max-sm:px-4"
    >
      <Icon
        aria-hidden
        size={18}
        className={`mt-0.5 ${prospect ? "text-muted-foreground" : "text-subtle-foreground"}`}
      />
      <div className="guide-line">
        <h2
          className={`m-0 flex min-w-0 gap-1 text-lead ${selected ? "items-start" : "items-center"} leading-[1.4] tracking-[-0.01em] ${prospect ? "font-normal" : "font-medium"} ${prospect && !selected ? "text-subtle-foreground" : ""}`}
        >
          <button
            type="button"
            data-select
            aria-expanded={selected}
            aria-controls={selected ? detailsId : undefined}
            title={card.name}
            onClick={() => onSelect?.(card.agentId)}
            className={`min-w-0 cursor-pointer ${selected ? "text-pretty wrap-anywhere" : "truncate"} border-0 bg-transparent p-0 text-left font-[inherit] tracking-[inherit] text-inherit outline-none before:absolute before:inset-0`}
          >
            {card.name}
          </button>
          {!prospect && card.verified ? (
            <VerifiedBadge className="relative z-10 -my-1 flex-none" />
          ) : null}
          {prospect ? <ProspectBadge className="ml-1 flex-none" /> : null}
        </h2>
        <span aria-hidden className="leader" />
        {where ? <span className="guide-where">{where}</span> : null}
      </div>

      <p
        className={`col-start-2 m-0 ${
          selected
            ? "mt-2.5 text-sm text-pretty"
            : "mt-px truncate text-caption text-subtle-foreground"
        }`}
      >
        {where ? <span className="sm:hidden">{where} · </span> : null}
        {address ? (
          <span className={selected ? "font-medium" : "text-foreground"}>
            {address}
            {" · "}
          </span>
        ) : null}
        {card.purpose}
      </p>

      {selected ? (
        <div
          id={detailsId}
          className="relative z-10 col-start-2 flex flex-col gap-3 pt-2.5 pb-1"
        >
          {!prospect && card.allowedIntents.length > 0 ? (
            <ul
              aria-label="Qué puede hacer"
              className="m-0 flex list-none flex-wrap gap-1.5 p-0"
            >
              {namedIntents.map((intent) => (
                <li key={intent} className="tag">
                  {intentLabel(intent)}
                </li>
              ))}
              {otherIntents > 0 ? (
                <li className="tag text-subtle-foreground">
                  {namedIntents.length > 0
                    ? `+${otherIntents}`
                    : `${otherIntents} ${otherIntents === 1 ? "acción" : "acciones"}`}
                  <span className="sr-only"> más, en la ficha</span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {prospect || card.slug === CONSUMER_AGENT_SLUG ? null : (
              <Button data-variant="solid" onClick={() => onConverse?.(card)}>
                Conversar
              </Button>
            )}
            <Link href={`/directory/${card.slug}`} className="ficha-link">
              Ver ficha
              <span className="sr-only"> de {card.name}</span>
              <ArrowRightIcon aria-hidden size={14} />
            </Link>
            <span className="ml-auto text-xs text-subtle-foreground">
              {KIND_LABELS[card.kind]}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}
