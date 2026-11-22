"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatLastActivity, intentLabel, SANTIAGO } from "./room-format";
import type { RoomSummary } from "./worst-case-rooms";

const PAGE_SIZE = 20;

/** Colour only as a dot beside the status word; shorter words than the room header's. */
const STATUS: Record<RoomSummary["status"], { dot: string; label: string }> = {
  requested: { dot: "bg-warning", label: "Por aceptar" },
  active: { dot: "bg-success", label: "Activa" },
  closed: { dot: "bg-muted-foreground", label: "Cerrada" },
  terminated: { dot: "bg-destructive", label: "Terminada" },
};

const longDate = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: SANTIAGO,
});

function LastActivity({ at, className }: { at: number; className: string }) {
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={longDate.format(at)}
      className={className}
    >
      {formatLastActivity(at)}
    </time>
  );
}

export function RoomIndex({ fixture }: { fixture?: RoomSummary[] }) {
  const auth = useConvexAuth();
  const isLoading = fixture ? false : auth.isLoading;
  const isAuthenticated = fixture ? true : auth.isAuthenticated;
  const query = usePaginatedQuery(
    api.rooms.minePage,
    !fixture && !isLoading && isAuthenticated ? {} : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  const [shown, setShown] = useState(PAGE_SIZE);
  const rooms = fixture ? fixture.slice(0, shown) : query.results;
  const status = fixture
    ? shown < fixture.length
      ? "CanLoadMore"
      : "Exhausted"
    : query.status;
  const loadMore = () =>
    fixture ? setShown((n) => n + PAGE_SIZE) : query.loadMore(PAGE_SIZE);
  if (isLoading || (isAuthenticated && status === "LoadingFirstPage"))
    return <RoomsSkeleton />;
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
  if (!rooms.length)
    return (
      <p className="m-0 max-w-120 border-t border-border pt-6 text-pretty">
        Todavía no abres ninguna sala. Elige un agente en el directorio y
        conversa con él: la sala queda guardada aquí.
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-4">
      <ul className="m-0 w-full list-none border-t border-border p-0">
        {rooms.map((room) => (
          <li key={room.sessionId} className="guide-row !block !px-0">
            <div className="guide-line">
              <Link
                href={`/room/${room.sessionId}`}
                title={room.provider.name}
                data-select
                className="min-w-0 line-clamp-2 text-lead font-medium tracking-[-0.01em] text-foreground no-underline outline-none [overflow-wrap:anywhere] before:absolute before:inset-0"
              >
                {room.provider.name}
              </Link>
              <span aria-hidden className="leader max-sm:hidden" />
              <LastActivity
                at={room.lastActivityTime}
                className="guide-where max-sm:hidden"
              />
            </div>
            <p className="m-0 mt-px flex items-center gap-1.5 text-caption text-subtle-foreground">
              <LastActivity
                at={room.lastActivityTime}
                className="flex-none tabular-nums sm:hidden"
              />
              <span aria-hidden className="sm:hidden">
                ·
              </span>
              <span className="truncate">{intentLabel(room.intent)}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex flex-none items-center gap-1.5">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${STATUS[room.status].dot}`}
                />
                {STATUS[room.status].label}
              </span>
            </p>
          </li>
        ))}
      </ul>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button onClick={loadMore} disabled={status === "LoadingMore"}>
          {status === "LoadingMore" ? "Cargando salas…" : "Ver más salas"}
        </Button>
      ) : null}
    </div>
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
