"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { DEMO_KNOWLEDGE, type DemoSeat } from "@/shared/demo-pcb";

// What each seat's holder pastes into their assistant. The manufacturer's own agent replaces
// the hosted one, so its message carries the price list the hosted agent quotes from.
const BOT_PROMPTS: Record<DemoSeat, string> = {
  buyer:
    "Usa agora. Con list_sessions encuentra mi sala abierta con el fabricante de PCB, léela desde el inicio con wait_for_messages y cuéntame en qué quedó y qué me está pidiendo. Cuando te diga qué responder, envíalo con send_message al participantId del agente del fabricante y espera su respuesta con wait_for_messages.",
  merchant: `Usa agora. Eres el agente de ventas de Don Huang, fabricante de PCB en Shenzhen. Con list_sessions encuentra la sala que abrió el comprador y léela desde el inicio con wait_for_messages. Cuando te lo pida, responde al comprador con send_message a toda la sala (recipient "all"), en español y en seis líneas como máximo, y espera su respuesta con wait_for_messages. Cotiza solo con esta lista: da el precio por unidad, el subtotal, el envío, el total en USD y el plazo. Si te doy una oferta distinta de la lista, aplícala y di que la ofrece Don Huang.\n\n${DEMO_KNOWLEDGE.text}`,
};

const SEATS: { seat: DemoSeat; title: string; detail: string }[] = [
  {
    seat: "buyer",
    title: "Comprador",
    detail: "Quiere fabricar 50 PCB a partir de su plano.",
  },
  {
    seat: "merchant",
    title: "Fabricante",
    detail: "Don Huang, que atiende junto a su agente.",
  },
];

function seatError(error: unknown) {
  const kind = (error as { data?: { kind?: string } } | null)?.data?.kind;
  if (kind === "SeatTaken") return "Otra persona ya tomó ese asiento.";
  if (kind === "Forbidden")
    return "Toma un asiento para poder reiniciar la sala.";
  if (kind === "NotYourAgent")
    return "Solo puedes traer un agente vinculado a tu cuenta.";
  if (kind === "NotFound") return "La sala de la demo no está preparada.";
  return "No pudimos hacer el cambio. Inténtalo de nuevo.";
}

export function DemoSeats() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (!isLoaded || (isSignedIn && isLoading))
    return <p role="status">Cargando tu cuenta…</p>;
  if (!isSignedIn)
    return (
      <div className="space-y-4">
        <p>Inicia sesión para tomar un asiento en la demo.</p>
        <SignInButton mode="modal" forceRedirectUrl="/demo">
          <Button data-variant="brand">Iniciar sesión</Button>
        </SignInButton>
      </div>
    );
  if (!isAuthenticated)
    return <p>No pudimos verificar tu cuenta. Vuelve a iniciar sesión.</p>;
  return <Seats />;
}

function Seats() {
  const { user } = useUser();
  const demo = useQuery(api.demo.state, {});
  const ownAgents = useQuery(api.agentRegistration.mine, {});
  const [copied, setCopied] = useState(false);
  const join = useMutation(api.demo.join);
  const leave = useMutation(api.demo.leave);
  const restart = useMutation(api.demo.restart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await change();
    } catch (e) {
      setError(seatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt(seat: DemoSeat) {
    try {
      await navigator.clipboard.writeText(BOT_PROMPTS[seat]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  const name = user?.fullName || user?.username || undefined;

  if (demo === undefined) return <p role="status">Cargando la demo…</p>;
  if (demo === null)
    return (
      <p>
        La sala de la demo no está preparada. Alguien del equipo tiene que
        ejecutar <code>pnpm demo:reset</code> una vez.
      </p>
    );

  return (
    <div className="space-y-6">
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        {SEATS.map(({ seat, title, detail }) => {
          const holder = demo.seats.find((s) => s.seat === seat);
          const mine = demo.mySeat === seat;
          const brought = demo.agents[seat];
          return (
            <li
              key={seat}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
            >
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="m-0 text-subtle-foreground">{detail}</p>
              <p className="m-0 text-sm">
                {mine
                  ? "Este es tu asiento."
                  : holder?.taken
                    ? `Lo tiene ${holder.displayName}.`
                    : "Está libre."}
              </p>
              {mine ? (
                <Button
                  data-size="sm"
                  className="self-start"
                  disabled={busy}
                  onClick={() => run(() => leave({}))}
                >
                  Dejar el asiento
                </Button>
              ) : (
                <Button
                  data-variant="brand"
                  data-size="sm"
                  className="self-start"
                  disabled={busy || holder?.taken}
                  onClick={() => run(() => join({ seat, name }))}
                >
                  Entrar como {title.toLowerCase()}
                </Button>
              )}
              {mine || !holder?.taken ? (
                <div className="flex flex-col items-start gap-2 border-t border-border pt-3">
                  {brought && mine ? (
                    <>
                      <p className="m-0 text-sm">
                        Hablas desde tu agente <strong>{brought.name}</strong>
                        {seat === "buyer"
                          ? ": la sala muestra lo que conversó con el fabricante."
                          : ": reemplaza al agente de Don Huang, así que cotiza él con la lista de precios del mensaje."}{" "}
                        Pega este mensaje en tu asistente para seguir desde ahí.
                      </p>
                      <p className="m-0 max-h-48 w-full overflow-y-auto whitespace-pre-line rounded-md bg-muted p-3 text-sm">
                        {BOT_PROMPTS[seat]}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button data-size="sm" onClick={() => copyPrompt(seat)}>
                          {copied ? "Mensaje copiado" : "Copiar el mensaje"}
                        </Button>
                        <Button
                          data-size="sm"
                          disabled={busy}
                          onClick={() => run(() => join({ seat, name }))}
                        >
                          Volver a hablar desde la web
                        </Button>
                      </div>
                    </>
                  ) : ownAgents?.length ? (
                    ownAgents.toReversed().map((agent) => (
                      <Button
                        key={agent.agentId}
                        data-size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            join({ seat, name, agentId: agent.agentId }),
                          )
                        }
                      >
                        {mine ? "Hablar" : "Entrar"} desde mi agente{" "}
                        {agent.name}
                      </Button>
                    ))
                  ) : (
                    <p className="m-0 text-sm text-subtle-foreground">
                      Para hablar desde tu propio asistente, conéctalo con
                      «Conecta tu agente a Agora» en la{" "}
                      <Link href="/" className="underline">
                        portada
                      </Link>{" "}
                      y vincúlalo a tu cuenta.
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {demo.mySeat ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/room/${demo.sessionId}`}
            className="font-medium underline"
          >
            Abrir la sala
          </Link>
          <Button
            data-size="sm"
            disabled={busy}
            onClick={() => run(() => restart({}))}
          >
            Reiniciar la sala
          </Button>
        </div>
      ) : (
        <p className="m-0 text-subtle-foreground">
          Toma un asiento para abrir la sala o reiniciarla.
        </p>
      )}
      <p className="m-0">
        <Link href="/room/demo/watch" className="font-medium underline">
          Ver como observador
        </Link>
        <span className="text-subtle-foreground">
          {" "}
          — la sala en vivo y en solo lectura, sin ocupar un asiento, para
          compartir pantalla.
        </span>
      </p>
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
