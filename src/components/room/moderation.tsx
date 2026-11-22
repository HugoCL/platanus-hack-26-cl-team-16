"use client";

import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "@ui-sdk/react/meter";
import {
  createPopoverController,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import {
  CheckIcon,
  MinusIcon,
  ShieldAlertIcon,
  ShieldBanIcon,
  ShieldCheckIcon,
  ShieldEllipsisIcon,
  ShieldIcon,
  ShieldMinusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { ModerationReason, ModerationStatus } from "@/shared/moderation";
import {
  formatLatency,
  primaryReason,
  REASON_LABELS,
  type RoomMessage,
  STAGE_LABELS,
  STATUS_LABELS,
} from "./room-format";

// One panel serves every shield in the room: each shield passes its message id as the payload.
// The panel lives outside the thread's live region, so opening it is not read out as a new message.
export type ShieldController = ReturnType<
  typeof createPopoverController<string>
>;

export function createShieldController(): ShieldController {
  return createPopoverController<string>();
}

// A message rendered on its own (a test, a preview) still gets a working trigger.
const ShieldContext = createContext<ShieldController>(createShieldController());

export const ShieldProvider = ShieldContext.Provider;

const SHIELDS: Record<
  ModerationStatus,
  { icon: ReactNode; dot?: string; label: string }
> = {
  allowed: {
    icon: <ShieldCheckIcon size={16} />,
    label: "Aprobado: ver razones del moderador",
  },
  pending: {
    icon: <ShieldEllipsisIcon size={16} />,
    label: "Revisando: ver el estado del moderador",
  },
  redacted: {
    icon: <ShieldMinusIcon size={16} />,
    dot: "bg-warning",
    label: "Editado: ver razones del moderador",
  },
  escalated: {
    icon: <ShieldAlertIcon size={16} />,
    dot: "bg-warning",
    label: "Requiere aprobación: ver razones del moderador",
  },
  blocked: {
    icon: <ShieldBanIcon size={16} />,
    dot: "bg-destructive",
    label: "Bloqueado: ver razones del moderador",
  },
};

const DOTS: Record<ModerationStatus, string> = {
  allowed: "bg-success",
  pending: "bg-muted-foreground",
  redacted: "bg-warning",
  escalated: "bg-warning",
  blocked: "bg-destructive",
};

/** The moderator beside a message: always there, muted, with a dot when it changed the message. */
export function ModeratorShield({ message }: { message: RoomMessage }) {
  const controller = useContext(ShieldContext);
  const shield = SHIELDS[message.status];
  return (
    <PopoverTrigger
      controller={controller}
      payload={message.messageId}
      aria-label={shield.label}
      data-status={message.status}
      className="room-shield"
    >
      {shield.icon}
      {shield.dot ? (
        <span aria-hidden="true" className={`room-shield-dot ${shield.dot}`} />
      ) : null}
    </PopoverTrigger>
  );
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

function isModeratorError(message: RoomMessage) {
  return primaryReason(message.reasons)?.code === "moderator_error";
}

// Why the moderator ruled as it did, in words. Under the bubble and in the panel.
function rulingReason(message: RoomMessage, faultText?: string) {
  const reason = primaryReason(message.reasons);
  if (message.status === "blocked" && isModeratorError(message))
    return "Por seguridad no se entregó. No cuenta como falta.";
  return [
    reason ? sentence(REASON_LABELS[reason.code]) : null,
    reason?.detail ? sentence(reason.detail) : null,
    message.status === "blocked" ? faultText : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export type Fault = { ordinal: number; max: number };

const RULING_HEAD: Partial<Record<ModerationStatus, string>> = {
  redacted: "El moderador editó este mensaje.",
  blocked: "El moderador bloqueó este mensaje.",
  escalated: "El moderador pide la aprobación del dueño.",
};

/** What the moderator did to this message, written under it so it never depends on hover. */
export function Ruling({
  message,
  fault,
}: {
  message: RoomMessage;
  fault?: Fault;
}) {
  const head =
    message.status === "blocked" && isModeratorError(message)
      ? "El moderador no pudo revisar este mensaje."
      : RULING_HEAD[message.status];
  if (!head) return null;
  return (
    <p className="room-ruling">
      <span aria-hidden="true" className={`room-dot ${DOTS[message.status]}`} />
      <span>
        <b>{head}</b>{" "}
        {rulingReason(
          message,
          fault && `Falta ${fault.ordinal} de ${fault.max}.`,
        )}
      </span>
    </p>
  );
}

const STAGES = ["deterministic", "injection", "purpose"] as const;

function StageList({ message }: { message: RoomMessage }) {
  const pending = message.status === "pending";
  const blocked = message.status === "blocked";
  // A rule that fails ends the review: the two judges never see the message.
  const stoppedAtRules =
    message.reasons?.some((r) => r.stage === "deterministic") ?? false;
  return (
    <ul className="room-pop-stages" aria-label="Etapas del moderador">
      {STAGES.map((stage, i) => {
        const flagged = message.reasons?.some((r) => r.stage === stage);
        const skipped = stoppedAtRules && stage !== "deterministic";
        return (
          <li key={stage}>
            {pending ? (
              <span
                aria-hidden="true"
                className="room-stage room-dot bg-muted-foreground"
                style={{ animationDelay: `${i * 220}ms` }}
              />
            ) : flagged ? (
              <TriangleAlertIcon
                size={12}
                className={blocked ? "text-destructive-text" : "text-warning"}
              />
            ) : skipped ? (
              <MinusIcon size={12} className="text-muted-foreground" />
            ) : (
              <CheckIcon size={12} className="text-success" />
            )}
            {STAGE_LABELS[stage]}
            <span className="sr-only">
              {pending
                ? ": en revisión"
                : flagged
                  ? ": con hallazgos"
                  : skipped
                    ? ": no se ejecutó"
                    : ": sin hallazgos"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function panelReason(message: RoomMessage, fault?: Fault) {
  if (message.status === "pending")
    return "El mensaje no se entrega hasta que el moderador lo revise.";
  if (message.status === "allowed")
    return sentence(message.verdict?.reason ?? "Dentro del contrato");
  if (isModeratorError(message))
    return "El moderador no pudo revisar este mensaje. Por seguridad no se entregó. No cuenta como falta.";
  return rulingReason(
    message,
    fault && `Cuenta como falta ${fault.ordinal} de ${fault.max}.`,
  );
}

/** The one moderator panel of a room. Every shield opens it with its message. */
export function ModeratorPanel({
  controller,
  messages,
  faults,
  maxFaults,
  onShowAudit,
}: {
  controller: ShieldController;
  messages: RoomMessage[];
  faults: Map<string, number>;
  maxFaults?: number;
  onShowAudit: (messageId: string) => void;
}) {
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.messageId, m])),
    [messages],
  );
  return (
    <Popover controller={controller} openOnHover delay={250} closeDelay={150}>
      <PopoverContent<string>
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="room-pop"
      >
        {(state) => {
          const message = state.payload ? byId.get(state.payload) : undefined;
          if (!message) return <PopoverTitle>Moderador</PopoverTitle>;
          const ordinal = faults.get(message.messageId);
          const fault =
            ordinal && maxFaults ? { ordinal, max: maxFaults } : undefined;
          return (
            <>
              <PopoverTitle className="sr-only">Moderador</PopoverTitle>
              <p className="room-pop-verdict">
                <span
                  aria-hidden="true"
                  className={`room-dot ${DOTS[message.status]}`}
                />
                {STATUS_LABELS[message.status]}
                {message.audit ? (
                  <span>{formatLatency(message.audit.latencyMs)}</span>
                ) : null}
              </p>
              <p className="room-pop-reason">{panelReason(message, fault)}</p>
              <StageList message={message} />
              <div className="room-pop-acts">
                <PopoverClose
                  className="room-pop-act"
                  onClick={() => onShowAudit(message.messageId)}
                >
                  <ShieldIcon size={14} />
                  Ver la auditoría del mensaje
                </PopoverClose>
              </div>
            </>
          );
        }}
      </PopoverContent>
    </Popover>
  );
}

/** Codes, stages and scores: the technical record, shown only in the message audit. */
export function ReasonList({ reasons }: { reasons: ModerationReason[] }) {
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-2 rounded-2xl bg-muted p-3 text-xs">
      {reasons.map((reason) => (
        <li
          key={`${reason.stage}-${reason.code}`}
          className="flex flex-col gap-1.5"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{REASON_LABELS[reason.code]}</span>
            <code className="font-mono text-subtle-foreground">
              {reason.code}
            </code>
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

// The three moderation stages light up in order while a message is pending.
export function PendingStages() {
  return (
    <p className="room-ruling">
      <span
        aria-hidden="true"
        className="room-stage room-dot bg-muted-foreground"
      />
      <span>
        <b>Revisando…</b>{" "}
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          {STAGES.map((stage, i) => (
            <span key={stage} className="inline-flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">→</span> : null}
              <span
                className="room-stage"
                style={{ animationDelay: `${i * 220}ms` }}
              >
                {STAGE_LABELS[stage]}
              </span>
            </span>
          ))}
        </span>
      </span>
    </p>
  );
}
