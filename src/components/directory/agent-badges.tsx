import { BadgeCheck, Circle } from "lucide-react";
import type { DirectoryCard } from "@/convex/directory";

export function VerifiedMark({
  verified,
  size = 14,
}: {
  verified: boolean;
  size?: number;
}) {
  return verified ? (
    <span className="inline-flex items-center gap-1 font-medium text-foreground">
      <BadgeCheck aria-hidden size={size} />
      Verificada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <Circle aria-hidden size={size} />
      Sin verificar
    </span>
  );
}

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
