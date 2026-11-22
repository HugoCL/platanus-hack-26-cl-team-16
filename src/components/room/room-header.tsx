"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemIndicator,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";
import type { SessionContract, SessionStatus } from "@/shared/session";
import { Ledger, scopeRows } from "../ledger";
import { VerifiedBadge } from "../verified-badge";
import {
  intentLabel,
  type RoomParticipant,
  SESSION_STATUS_LABELS,
  type Viewer,
} from "./room-format";

const ROLE_LABELS: Record<Viewer["role"], string> = {
  owner: "Dueño",
  observer: "Observador",
  operator: "Operador",
};

// Past this many, the meter stops drawing one bar per fault; the count beside it still says it.
const MAX_FAULT_BARS = 10;

export function RoomHeader({
  self,
  other,
  viewer,
  participants,
  contract,
  status,
  turns,
  faults,
  onlyInterventions,
  onOnlyInterventions,
  onOpenAudit,
  onCloseRoom,
}: {
  self?: RoomParticipant;
  other?: RoomParticipant;
  viewer: Viewer;
  participants: RoomParticipant[];
  contract: SessionContract | null;
  status: SessionStatus;
  turns: number;
  faults: number;
  onlyInterventions: boolean;
  onOnlyInterventions: (only: boolean) => void;
  onOpenAudit: () => void;
  onCloseRoom?: () => unknown;
}) {
  const [closing, setClosing] = useState(false);
  const closed = status !== "active";

  return (
    <header className="room-col room-head">
      <div className="min-w-0 flex-1 max-sm:basis-full">
        <h1 className="m-0 flex min-w-0 items-center gap-1 text-lg leading-tight font-semibold tracking-[-0.02em]">
          <span className="truncate" title={other?.name}>
            {other?.name ?? "Sala"}
          </span>
          {other?.verified && <VerifiedBadge />}
        </h1>
        <p className="room-strip">
          {contract ? (
            <>
              <span>
                turno <b>{Math.min(turns, contract.maxTurns)}</b> de{" "}
                {contract.maxTurns}
              </span>
              <span>
                faltas <b>{faults}</b> de {contract.maxViolations}
                {contract.maxViolations <= MAX_FAULT_BARS ? (
                  <span aria-hidden="true" className="room-faults">
                    {Array.from({ length: contract.maxViolations }, (_, i) => (
                      <i
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length meter bars
                        key={i}
                        data-on={i < faults || undefined}
                      />
                    ))}
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <span>contrato no disponible</span>
          )}
          {closed ? (
            <span>{SESSION_STATUS_LABELS[status].toLowerCase()}</span>
          ) : null}
        </p>
      </div>

      {contract ? (
        <Popover>
          <PopoverTrigger className="room-head-btn">
            Contrato
            <ChevronDownIcon size={16} />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            collisionPadding={16}
            className="room-hpop w-[360px]"
          >
            <PopoverTitle className="sr-only">Contrato de la sala</PopoverTitle>
            <p className="m-0 break-words text-caption text-pretty text-subtle-foreground">
              {viewer.role === "observer"
                ? `${self?.name ?? "El agente"} pidió:`
                : "Tu agente pidió:"}{" "}
              “{contract.intent.description}”
            </p>
            <Ledger
              className="text-caption"
              rows={[
                {
                  label: "Intención",
                  value: intentLabel(contract.intent.name),
                },
                ...scopeRows({
                  requests: contract.recipientRequests,
                  shares: contract.recipientShares,
                  forbidden: contract.forbiddenTopics,
                  requestsLabel: "Puede pedirte",
                }),
              ]}
            />
          </PopoverContent>
        </Popover>
      ) : null}

      <Popover>
        <PopoverTrigger className="room-head-btn">
          <UserIcon size={16} />
          <span className="tabular-nums">{participants.length}</span>
          <span className="sr-only">participantes</span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="room-hpop w-[300px]"
        >
          <PopoverTitle className="sr-only">Participantes</PopoverTitle>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {participants.map((p) => (
              <li
                key={p.participantId}
                className="flex min-w-0 items-baseline gap-2"
              >
                <b className="truncate font-medium" title={p.name}>
                  {p.name}
                </b>
                <small className="ml-auto flex-none text-xs text-subtle-foreground">
                  {p.kind === "agent"
                    ? "Agente"
                    : viewer.ownParticipantIds.includes(p.participantId)
                      ? ROLE_LABELS[viewer.role]
                      : "Persona"}
                </small>
              </li>
            ))}
          </ul>
          {viewer.role === "owner" ? (
            <Button data-size="sm" className="self-start" disabled>
              Invitar a un observador
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

      <Menu>
        <MenuTrigger
          aria-label="Más acciones"
          className="room-head-btn room-head-icon"
        >
          <EllipsisIcon size={16} />
        </MenuTrigger>
        <MenuContent align="end" sideOffset={6} className="room-menu">
          <MenuCheckboxItem
            value="only-interventions"
            checked={onlyInterventions}
            onCheckedChange={onOnlyInterventions}
            closeOnSelect
          >
            <MenuItemIndicator>
              <CheckIcon size={14} />
            </MenuItemIndicator>
            Mostrar solo intervenciones
          </MenuCheckboxItem>
          <MenuItem value="audit" onSelect={onOpenAudit}>
            Auditoría de la sala
          </MenuItem>
          {onCloseRoom ? (
            <MenuItem
              value="close"
              destructive
              disabled={closed}
              onSelect={async () => {
                setClosing(true);
                try {
                  await onCloseRoom();
                } finally {
                  setClosing(false);
                }
              }}
            >
              {closing ? "Cerrando…" : "Cerrar sala"}
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
    </header>
  );
}
