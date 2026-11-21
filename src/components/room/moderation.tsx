import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "@ui-sdk/react/meter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactNode } from "react";
import type { ModerationReason, ModerationStatus } from "@/shared/moderation";
import {
  AlertIcon,
  BlockIcon,
  CheckIcon,
  ClockIcon,
  PencilIcon,
} from "./icons";
import { REASON_LABELS, STAGE_LABELS } from "./room-format";

const BADGES: Record<
  Exclude<ModerationStatus, "allowed">,
  { label: string; icon: ReactNode; className: string }
> = {
  pending: {
    label: "Revisando…",
    icon: (
      <ClockIcon size={14} className="animate-spin [animation-duration:2.4s]" />
    ),
    className: "bg-muted text-subtle-foreground",
  },
  redacted: {
    label: "Editado",
    icon: <PencilIcon size={14} />,
    className: "bg-warning/15 text-foreground",
  },
  blocked: {
    label: "Bloqueado",
    icon: <BlockIcon size={14} />,
    className: "bg-destructive-soft text-destructive-text",
  },
  escalated: {
    label: "Requiere tu aprobación",
    icon: <AlertIcon size={14} />,
    className: "bg-warning/15 text-foreground",
  },
};

export function ModerationBadge({
  status,
  reasons = [],
}: {
  status: ModerationStatus;
  reasons?: ModerationReason[];
}) {
  if (status === "allowed") {
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label="Aprobado por el moderador"
          data-size="sm"
          data-variant="ghost"
          className="!h-6 !w-6 !p-0 text-success"
        >
          <CheckIcon size={14} />
        </TooltipTrigger>
        <TooltipContent>Aprobado por el moderador</TooltipContent>
      </Tooltip>
    );
  }

  const badge = BADGES[status];
  const pill = (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium ${badge.className}`}
    >
      {badge.icon}
      {badge.label}
    </span>
  );

  if (reasons.length === 0) return pill;

  return (
    <Collapsible className="contents">
      <CollapsibleTrigger
        data-variant="ghost"
        className="!h-auto !p-0 !bg-transparent"
        aria-label={`${badge.label}: ver razones del moderador`}
      >
        {pill}
      </CollapsibleTrigger>
      <CollapsiblePanel className="basis-full">
        <ReasonList reasons={reasons} />
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function ReasonList({ reasons }: { reasons: ModerationReason[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-2 rounded-2xl bg-muted p-3 text-xs">
      {reasons.map((reason) => (
        <li
          key={`${reason.stage}-${reason.code}`}
          className="flex flex-col gap-1.5"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <code className="font-mono font-medium">{reason.code}</code>
            <span className="text-subtle-foreground">
              {STAGE_LABELS[reason.stage]}
            </span>
          </span>
          {reason.detail ? (
            <span className="text-subtle-foreground">{reason.detail}</span>
          ) : null}
          {reason.score !== undefined ? (
            <ScoreBar score={reason.score} label={REASON_LABELS[reason.code]} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <Meter
      value={score}
      min={0}
      max={1}
      format={{ style: "decimal", minimumFractionDigits: 2 }}
      className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1"
    >
      <MeterLabel className="sr-only">{`Score de ${label}`}</MeterLabel>
      <MeterTrack className="h-1.5 bg-background">
        <MeterIndicator />
      </MeterTrack>
      <MeterValue className="font-mono tabular-nums" />
    </Meter>
  );
}

const STAGES = ["deterministic", "injection", "purpose"] as const;

// The three moderation stages light up in order while a message is pending.
export function PendingStages() {
  return (
    <ol
      className="flex items-center gap-1.5 text-[11px] text-subtle-foreground"
      aria-label="Etapas de moderación en curso"
    >
      {STAGES.map((stage, i) => (
        <li key={stage} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">→</span> : null}
          <span
            className="room-stage rounded-full bg-muted px-2 py-0.5"
            style={{ animationDelay: `${i * 220}ms` }}
          >
            {STAGE_LABELS[stage]}
          </span>
        </li>
      ))}
    </ol>
  );
}
