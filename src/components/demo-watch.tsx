"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { liveAnswers, mapLiveRoom } from "./room/live-room";
import { RoomView } from "./room/room-view";

function WatchState({ children }: { children: ReactNode }) {
  return (
    <main className="m-auto flex max-w-lg flex-col items-start gap-4 p-8">
      <h1 className="text-xl">Demo en vivo</h1>
      {children}
      <Link href="/demo">Volver a la demo</Link>
    </main>
  );
}

// The demo room on a shared screen: live and read-only, laid out as the buyer sees it.
export function DemoWatch() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const room = useQuery(
    api.demo.watch,
    !isLoading && isAuthenticated ? {} : "skip",
  );
  if (isLoading || (isAuthenticated && room === undefined))
    return (
      <WatchState>
        <p role="status">Cargando la sala…</p>
      </WatchState>
    );
  if (!isAuthenticated)
    return (
      <WatchState>
        <p>Inicia sesión para ver la sala de la demo.</p>
        <SignInButton mode="modal" forceRedirectUrl="/room/demo/watch">
          <Button data-variant="solid">Iniciar sesión</Button>
        </SignInButton>
      </WatchState>
    );
  if (!room)
    return (
      <WatchState>
        <p>La sala de la demo no está preparada.</p>
      </WatchState>
    );
  const mapped = mapLiveRoom(
    room.session,
    room.participantNames,
    room.seenAsParticipantId,
  );
  return (
    <RoomView
      {...mapped}
      viewer={{ ...mapped.viewer, role: "observer" }}
      sessionId={room.session.sessionId}
      violationCount={room.violationCount}
      turnCount={room.session.turnCount}
      messages={room.history}
      answers={liveAnswers(room.history)}
      answersReadOnly
      onSendText={() => {}}
      onRespond={() => {}}
    />
  );
}
