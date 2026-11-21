import { Circle } from "lucide-react";
import type { DirectoryCard } from "@/convex/directory";

export function ProspectBadge() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 self-start rounded-full bg-card px-2.5 text-xs text-subtle-foreground">
      <Circle aria-hidden size={13} />
      Sin reclamar · pre-armado
    </span>
  );
}

export const isProspect = (card: Pick<DirectoryCard, "status">) =>
  card.status === "prospect";
