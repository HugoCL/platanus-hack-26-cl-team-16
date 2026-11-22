"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import {
  formatDay,
  formatTime,
  intentLabel,
  SESSION_STATUS_LABELS,
} from "./room-format";

type Status = keyof typeof SESSION_STATUS_LABELS;

/** Colour only as a dot beside the status word. */
const STATUS_DOT: Record<Status, string> = {
  requested: "bg-warning",
  active: "bg-success",
  closed: "bg-muted-foreground",
  terminated: "bg-destructive",
};

export function RoomIndex() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const rooms = useQuery(
    api.rooms.mine,
    !isLoading && isAuthenticated ? {} : "skip",
  );
  if (isLoading || (isAuthenticated && !rooms)) return <RoomsSkeleton />;
  if (!isAuthenticated)
    return (
      <div className="flex flex-col items-start gap-4 border-t border-border pt-6">
        <p className="m-0 max-w-120 text-pretty">
          Las salas se guardan en tu cuenta. Inicia sesión para ver las tuyas, o
          mira cómo es una en la sala de demostración.
        </p>
        <SignInButton mode="modal">
          <Button data-variant="solid">Iniciar sesión</Button>
        </SignInButton>
      </div>
    );
  if (!rooms?.length)
    return (
      <p className="m-0 max-w-120 border-t border-border pt-6 text-pretty">
        Todavía no abres ninguna sala. Elige un agente en el directorio y
        conversa con él: la sala queda guardada aquí.
      </p>
    );
  return (
    <ul className="m-0 list-none border-t border-border p-0">
      {rooms.map((room) => (
        <li key={room.sessionId} className="guide-row !block !px-0">
          <div className="guide-line">
            <Link
              href={`/room/${room.sessionId}`}
              data-select
              className="min-w-0 truncate text-lead font-medium tracking-[-0.01em] text-foreground no-underline outline-none before:absolute before:inset-0"
            >
              {room.provider.name}
            </Link>
            <span aria-hidden className="leader" />
            <span className="guide-where">
              {formatDay(room.lastActivityTime)} ·{" "}
              {formatTime(room.lastActivityTime)}
            </span>
          </div>
          <p className="m-0 mt-px flex items-center gap-1.5 text-caption text-subtle-foreground">
            <span className="truncate">{intentLabel(room.intent)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex flex-none items-center gap-1.5">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${STATUS_DOT[room.status]}`}
              />
              {SESSION_STATUS_LABELS[room.status]}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function RoomsSkeleton() {
  return (
    <div className="border-t border-border">
      <span className="sr-only">Cargando salas…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          className="guide-row !block !px-0 motion-safe:animate-pulse"
        >
          <span className="flex items-center gap-2 py-1">
            <span className="h-3.5 w-2/5 rounded-sm bg-muted" />
            <span className="leader !mt-0 self-center" />
            <span className="h-3 w-24 rounded-sm bg-muted" />
          </span>
          <span className="mt-1.5 mb-1 block h-3 w-1/3 rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  );
}
