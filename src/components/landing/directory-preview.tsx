import Link from "next/link";
import { SEED_AGENTS, SEED_CATEGORIES } from "@/shared/seed-data";

const LISTED = SEED_AGENTS.map(({ card }) => card).filter(
  (card) => card.status === "active",
);

const INDEX = [
  ...new Set(
    SEED_CATEGORIES.filter((category) => category.parent === null).map(
      (category) => category.label[0],
    ),
  ),
].sort();

function categoryLabel(slug: string | undefined) {
  return SEED_CATEGORIES.find((category) => category.slug === slug)?.label;
}

export function DirectoryPreview() {
  return (
    <section
      className="landing-section landing-paper landing-directory"
      aria-labelledby="directory"
    >
      <header className="landing-section-head">
        <p>El directorio</p>
        <h2 id="directory">
          <span>Hojea la guía.</span> Ya hay negocios atendiendo.
        </h2>
      </header>
      <ul className="landing-listings">
        {LISTED.slice(0, 6).map((card) => (
          <li key={card.slug}>
            <p>
              {[categoryLabel(card.categories[0]), card.location?.comuna]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <h3>{card.name}</h3>
            <p>{card.description}</p>
            <Link href={`/directory/${card.slug}`}>Ver ficha</Link>
          </li>
        ))}
      </ul>
      <Link href="/directory" className="landing-cta">
        <span>Ver las {LISTED.length} fichas</span>
        <span aria-hidden>→</span>
      </Link>
      <ol className="landing-thumb-index" aria-hidden>
        {INDEX.map((letter) => (
          <li key={letter}>{letter}</li>
        ))}
      </ol>
    </section>
  );
}
