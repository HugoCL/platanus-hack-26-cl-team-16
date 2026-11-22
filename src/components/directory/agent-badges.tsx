import type { DirectoryCard } from "@/convex/directory";

/** Unclaimed agents: muted text and a dashed tag. The hatch belongs to the moderator. */
export function ProspectBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`tag tag-dashed font-sans font-normal ${className}`}>
      Sin reclamar
    </span>
  );
}

export const isProspect = (card: Pick<DirectoryCard, "status">) =>
  card.status === "prospect";
