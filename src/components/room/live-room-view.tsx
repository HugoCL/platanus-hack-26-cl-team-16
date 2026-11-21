"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Component, type ReactNode, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SendableContent } from "@/shared/messages";
import { liveAnswers, mapLiveRoom, sendError } from "./live-room";
import type { RoomMessage } from "./room-format";
import { RoomView } from "./room-view";

function RoomState({ children }: { children: ReactNode }) {
  return (
    <main className="m-auto flex max-w-lg flex-col items-start gap-4 p-8">
      <h1 className="text-xl">Sala moderada</h1>
      {children}
      <a href="/directory">Volver al directorio</a>
    </main>
  );
}

class RoomBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <RoomState>
        <p>No tienes acceso a esta sala</p>
      </RoomState>
    ) : (
      this.props.children
    );
  }
}

export function LiveRoom({ sessionId }: { sessionId: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading)
    return (
      <RoomState>
        <p>Cargando sala…</p>
      </RoomState>
    );
  if (!isAuthenticated)
    return (
      <RoomState>
        <p>Inicia sesión para entrar a esta sala.</p>
        <SignInButton mode="modal">
          <Button data-variant="solid">Iniciar sesión</Button>
        </SignInButton>
      </RoomState>
    );
  return (
    <RoomBoundary key={sessionId}>
      <ConnectedRoom sessionId={sessionId as Id<"sessions">} />
    </RoomBoundary>
  );
}

function ConnectedRoom({ sessionId }: { sessionId: Id<"sessions"> }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const args = !isLoading && isAuthenticated ? { sessionId } : "skip";
  const view = useQuery(api.rooms.view, args);
  const history = useQuery(api.gate.history, args);
  const sessions = useQuery(api.rooms.mine, args === "skip" ? "skip" : {});
  const send = useAction(api.gate.send);
  const close = useMutation(api.rooms.close);
  const [pending, setPending] = useState<RoomMessage | null>(null);
  const [error, setError] = useState<string>();
  const sending = useRef(false);
  if (view === null)
    return (
      <RoomState>
        <p>La sala no existe</p>
      </RoomState>
    );
  if (!view || !history)
    return (
      <RoomState>
        <p>Cargando sala…</p>
      </RoomState>
    );
  const mapped = mapLiveRoom(
    view.session,
    view.participantNames,
    view.humanParticipantId,
  );

  async function sendContent(
    content: SendableContent,
    recipient: "all" | Id<"participants">,
  ) {
    if (!view || sending.current || view.session.status !== "active") return false;
    sending.current = true;
    setError(undefined);
    setPending({
      messageId: "optimistic",
      sessionId,
      senderParticipantId: view.humanParticipantId,
      recipient,
      content,
      sentAt: Date.now(),
      status: "pending",
      verdict: null,
    });
    try {
      await send({ sessionId, recipient, content });
      return true;
    } catch (error) {
      setError(sendError(error));
      return false;
    } finally {
      sending.current = false;
      setPending(null);
    }
  }

  return (
    <RoomView
      {...mapped}
      messages={[...history, ...(pending ? [pending] : [])]}
      answers={liveAnswers(history)}
      error={error}
      sending={pending !== null}
      sessions={sessions?.map((s) => ({
        sessionId: s.sessionId,
        name: s.provider.name,
        intent: s.intent,
      }))}
      onSendText={(text) => sendContent({ kind: "text", text }, "all")}
      onRespond={(response, inReplyTo) => {
        const target = history.find((m) => m.messageId === inReplyTo);
        if (!target?.senderParticipantId || target.content.kind !== "ui") {
          setError("InvalidArgument: No se encontró la tarjeta.");
          return;
        }
        void sendContent(
          { kind: "ui_response", inReplyTo, response },
          target.senderParticipantId as Id<"participants">,
        );
      }}
      onCloseRoom={() => {
        setError(undefined);
        void close({ sessionId }).catch((error) => setError(sendError(error)));
      }}
    />
  );
}
