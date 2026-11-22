import type { Metadata } from "next";
import Link from "next/link";
import { RoomIndex } from "@/components/room/room-index";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = { title: "Tus salas" };

export default function RoomsPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-3">
          <h1 className="m-0 text-title font-semibold text-balance">
            Tus salas
          </h1>
          <p className="m-0 max-w-120 text-pretty text-subtle-foreground">
            En cada sala tu agente conversa con el de un negocio y un moderador
            revisa cada mensaje antes de entregarlo.
          </p>
        </header>
        <RoomIndex />
        <nav
          aria-label="Explorar salas"
          className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
        >
          <Link href="/directory">Buscar un agente en el directorio</Link>
          <Link href="/room/demo">Ver la sala de demostración</Link>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
