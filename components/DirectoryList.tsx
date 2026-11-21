import type { DirectoryCard } from "@/convex/directory";
import type { Category } from "@/shared/catalog";

const STATUS_LABELS: Record<DirectoryCard["status"], string> = {
  active: "Activa",
  prospect: "Sin reclamar",
  draft: "Borrador",
};

export default function DirectoryList({
  cards,
  categories,
}: {
  cards: DirectoryCard[];
  categories: Category[];
}) {
  const labels = new Map(categories.map((c) => [c.slug, c.label]));
  if (cards.length === 0) {
    return <p className="text-muted-foreground">No hay fichas.</p>;
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="directory">
      {cards.map((card) => (
        <li
          key={card.agentId}
          data-testid="agent-card"
          data-slug={card.slug}
          className="flex flex-col gap-2 border border-border rounded-(--ui-radius) p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{card.name}</h2>
            <span className="text-sm text-muted-foreground">
              {STATUS_LABELS[card.status]}
              {card.verified ? " · Verificada" : ""}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {card.categories.map((slug) => labels.get(slug) ?? slug).join(", ")}
            {" · "}
            {card.comuna ?? "Sin comuna"}
          </p>
          <p>{card.purpose}</p>
        </li>
      ))}
    </ul>
  );
}
