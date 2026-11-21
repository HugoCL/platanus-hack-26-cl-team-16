import { Button } from "@ui-sdk/react/button";
import Link from "next/link";
import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { intentLabel } from "../room/room-format";
import { isProspect, ProspectBadge, VerifiedMark } from "./agent-badges";
import { categoryIcon, formatKm, KIND_LABELS } from "./directory-format";

const VISIBLE_INTENTS = 3;

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
  return (
    <ul
      className="m-0 flex list-none flex-col gap-3 p-0"
      data-testid="directory"
    >
      {cards.map((card) => (
        <AgentResult
          key={card.agentId}
          card={card}
          categories={categories}
          distance={distances?.get(card.agentId)}
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
  selected,
  onSelect,
  onConverse,
}: {
  card: DirectoryCard;
  categories: Category[];
  distance?: number;
  selected: boolean;
  onSelect?: (agentId: string) => void;
  onConverse?: (card: DirectoryCard) => void;
}) {
  const prospect = isProspect(card);
  const Icon = categoryIcon(card.categories, categories);
  const intents = card.allowedIntents;
  const href = `/directorio/${card.slug}`;
  const meta = [
    card.comuna,
    distance === undefined ? undefined : formatKm(distance),
    KIND_LABELS[card.kind],
  ].filter(Boolean);

  return (
    // Hover and focus only mirror the selection on the map; the card's actions are its links and buttons.
    <li
      id={`agent-${card.agentId}`}
      data-testid="agent-card"
      data-slug={card.slug}
      data-status={card.status}
      onMouseEnter={() => onSelect?.(card.agentId)}
      onFocus={() => onSelect?.(card.agentId)}
      className={`flex scroll-m-4 flex-col gap-3 rounded-4xl p-4.5 transition-shadow ${
        prospect
          ? "bg-muted [background-image:var(--sm-hatch)]"
          : selected
            ? "bg-card shadow-[0_0_0_2px_var(--ui-foreground)]"
            : "bg-card shadow-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`grid size-10 flex-none place-items-center rounded-2xl ${prospect ? "bg-card" : "bg-muted"}`}
        >
          <Icon size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="m-0 text-base leading-snug font-medium tracking-tight">
            {card.name}
          </h2>
          {prospect ? (
            <ProspectBadge />
          ) : (
            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-subtle-foreground">
              {card.entityName ? <span>{card.entityName}</span> : null}
              <VerifiedMark verified={card.verified} />
            </span>
          )}
        </div>
      </div>

      <p
        className={`m-0 line-clamp-2 text-[15px] leading-normal ${prospect ? "text-subtle-foreground" : ""}`}
      >
        {card.purpose}
      </p>

      {!prospect && intents.length > 0 ? (
        <ul
          aria-label="Qué puede hacer"
          className="m-0 flex list-none flex-wrap gap-1.5 p-0"
        >
          {intents.slice(0, VISIBLE_INTENTS).map((intent) => (
            <li
              key={intent}
              className="inline-flex h-6 items-center rounded-full border border-input px-2.5 text-xs"
            >
              {intentLabel(intent)}
            </li>
          ))}
          {intents.length > VISIBLE_INTENTS ? (
            <li className="inline-flex h-6 items-center px-2 text-xs text-subtle-foreground">
              +{intents.length - VISIBLE_INTENTS}
            </li>
          ) : null}
        </ul>
      ) : null}

      {meta.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-subtle-foreground tabular-nums">
          {meta.join(" · ")}
        </p>
      ) : null}

      <div className="flex gap-2">
        {prospect || card.slug === CONSUMER_AGENT_SLUG ? null : (
          <Button
            data-variant="solid"
            data-size="lg"
            className="flex-1"
            onClick={() => onConverse?.(card)}
          >
            Conversar
          </Button>
        )}
        <Link
          href={href}
          className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-input bg-card font-medium text-foreground no-underline hover:bg-muted"
        >
          Ver ficha
          <span className="sr-only"> de {card.name}</span>
        </Link>
      </div>
    </li>
  );
}
