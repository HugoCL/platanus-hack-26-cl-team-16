import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { BadgeCheckIcon } from "lucide-react";

const LABEL = "Verificada";

/** The verified seal for an agent card: icon only, named by its tooltip and aria-label. */
export function VerifiedBadge({
  size = 15,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={LABEL}
        data-size="sm"
        data-variant="ghost"
        className={`!h-6 !w-6 shrink-0 !p-0 text-brand-ink ${className}`}
      >
        <BadgeCheckIcon size={size} fill="var(--brand-yellow)" />
      </TooltipTrigger>
      <TooltipContent>{LABEL}</TooltipContent>
    </Tooltip>
  );
}
