"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { intentLabel, SESSION_STATUS_LABELS } from "./room-format";

export function RoomIndex() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const rooms = useQuery(
    api.rooms.mine,
    !isLoading && isAuthenticated ? {} : "skip",
  );
  if (isLoading) return <p>Cargando salas…</p>;
  if (!isAuthenticated)
    return (
      <div className="flex flex-col items-start gap-4">
        <p>Inicia sesión para ver tus salas.</p>
        <SignInButton mode="modal">
          <Button data-variant="solid">Iniciar sesión</Button>
        </SignInButton>
      </div>
    );
  if (!rooms) return <p>Cargando salas…</p>;
  if (!rooms.length)
    return (
      <p>
        Aún no tienes salas.{" "}
        <Link href="/directory">Encuentra un agente en el directorio</Link>.
      </p>
    );
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rooms.map((room) => (
        <li
          key={room.sessionId}
          className="rounded-2xl border border-border p-4"
        >
          <Link href={`/room/${room.sessionId}`} className="font-medium">
            {room.provider.name}
          </Link>
          <p className="m-0 mt-1 text-sm text-subtle-foreground">
            {intentLabel(room.intent)} · {SESSION_STATUS_LABELS[room.status]}
          </p>
        </li>
      ))}
    </ul>
  );
}
