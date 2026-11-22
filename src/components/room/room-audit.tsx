"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import type { SessionContract } from "@/shared/session";
import { Ledger } from "../ledger";
import { MODERATOR_MODEL } from "./demo-session";
import { ReasonList } from "./moderation";
import {
  auditMetrics,
  formatLatency,
  formatTime,
  isIntervention,
  primaryReason,
  REASON_LABELS,
  type RoomMessage,
  type RoomParticipant,
  STATUS_LABELS,
} from "./room-format";

const DOTS: Record<RoomMessage["status"], string> = {
  allowed: "bg-success",
  pending: "bg-muted-foreground",
  redacted: "bg-warning",
  escalated: "bg-warning",
  blocked: "bg-destructive",
};

/** The technical record of one message: model, latency, reason codes and scores. */
export function MessageAuditDialog({
  message,
  senderName,
  onClose,
}: {
  message?: RoomMessage;
  senderName?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={message !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogBackdrop className="room-dialog-backdrop" />
      <DialogContent className="room-dialog max-w-md">
        <DialogTitle>Auditoría del mensaje</DialogTitle>
        <DialogDescription>
          {message
            ? `${senderName ?? "Sistema"} · ${formatTime(message.sentAt)} · ${message.audit?.model ?? MODERATOR_MODEL} · ${message.audit ? formatLatency(message.audit.latencyMs) : "—"}`
            : null}
        </DialogDescription>
        {message ? (
          <p className="m-0 mt-3 flex items-center gap-2 text-sm font-medium">
            <span
              aria-hidden="true"
              className={`room-dot ${DOTS[message.status]}`}
            />
            {STATUS_LABELS[message.status]}
          </p>
        ) : null}
        {message?.reasons?.length ? (
          <ReasonList reasons={message.reasons} />
        ) : message ? (
          <p className="m-0 mt-2 text-caption text-subtle-foreground">
            {message.status === "pending"
              ? "El moderador todavía lo está revisando."
              : "Filtros, inyección y propósito: sin hallazgos."}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <DialogClose>Cerrar</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What the moderator did across the whole room: the totals and every intervention. */
export function RoomAuditDialog({
  open,
  onOpenChange,
  title,
  contract,
  messages,
  participants,
  turns,
  faults,
  onJump,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  contract: SessionContract | null;
  messages: RoomMessage[];
  participants: Map<string, RoomParticipant>;
  turns: number;
  faults: number;
  onJump: (messageId: string) => void;
}) {
  const metrics = auditMetrics(messages);
  const interventions = messages.filter(isIntervention);
  const models = [
    ...new Set(messages.flatMap((m) => (m.audit ? [m.audit.model] : []))),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogBackdrop className="room-dialog-backdrop" />
      <DialogContent className="room-dialog flex max-h-[85dvh] max-w-md flex-col overflow-y-auto">
        <DialogTitle>Auditoría de la sala</DialogTitle>
        <DialogDescription className="break-words">{title}</DialogDescription>
        <Ledger
          className="mt-3 text-caption"
          rows={[
            { label: "Mensajes revisados", value: metrics.reviewed },
            { label: "Intervenciones", value: metrics.interventions },
            ...(contract
              ? [
                  {
                    label: "Faltas",
                    value: `${faults} de ${contract.maxViolations}`,
                  },
                  {
                    label: "Turnos",
                    value: `${Math.min(turns, contract.maxTurns)} de ${contract.maxTurns}`,
                  },
                ]
              : []),
            {
              label: "Latencia media",
              value:
                metrics.averageLatencyMs === null
                  ? "—"
                  : formatLatency(metrics.averageLatencyMs),
            },
            {
              label: "Modelo",
              value: (models.length ? models : [MODERATOR_MODEL]).map(
                (model) => (
                  <span
                    key={model}
                    className="block break-words font-mono text-xs font-normal"
                  >
                    {model}
                  </span>
                ),
              ),
            },
          ]}
        />
        <h3 className="m-0 mt-5 mb-1 text-sm font-semibold">Intervenciones</h3>
        {interventions.length === 0 ? (
          <p className="m-0 text-caption text-subtle-foreground">
            El moderador no ha editado ni bloqueado ningún mensaje.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {interventions.map((m) => {
              const reason = primaryReason(m.reasons);
              return (
                <li key={m.messageId}>
                  <Button
                    className="room-audit-row"
                    onClick={() => onJump(m.messageId)}
                  >
                    <span className="flex items-baseline gap-2">
                      <span
                        aria-hidden="true"
                        className={`room-dot ${DOTS[m.status]}`}
                      />
                      <b className="flex-none font-medium">
                        {STATUS_LABELS[m.status]}
                      </b>
                      <span className="min-w-0 truncate text-subtle-foreground">
                        {participants.get(m.senderParticipantId ?? "")?.name ??
                          "Desconocido"}
                      </span>
                      <span className="ml-auto flex-none font-mono text-xs text-subtle-foreground tabular-nums">
                        {formatTime(m.sentAt)}
                      </span>
                    </span>
                    {reason ? (
                      <span className="pl-3.5 text-xs text-subtle-foreground">
                        {REASON_LABELS[reason.code]}
                        {reason.detail ? `. ${reason.detail}` : ""}
                      </span>
                    ) : null}
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-4 flex justify-end">
          <DialogClose>Cerrar</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
