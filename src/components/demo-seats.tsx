"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DemoSeat } from "@/shared/demo-pcb";

const SEATS: { seat: DemoSeat; title: string; detail: string }[] = [
  {
    seat: "buyer",
    title: "Comprador",
    detail: "Quiere fabricar 50 PCB a partir de su plano.",
  },
  {
    seat: "merchant",
    title: "Fabricante",
    detail: "Atiende junto al agente de Shenzhen PCB Works.",
  },
];

function seatError(error: unknown) {
  const kind = (error as { data?: { kind?: string } } | null)?.data?.kind;
  if (kind === "SeatTaken") return "Otra persona ya tomó ese asiento.";
  if (kind === "Forbidden")
    return "Toma un asiento para poder reiniciar la sala.";
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
                  onClick={() =>
                    run(() =>
                      join({
                        seat,
                        name: user?.fullName || user?.username || undefined,
                      }),
                    )
                  }
                >
                  Entrar como {title.toLowerCase()}
                </Button>
              )}
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
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
