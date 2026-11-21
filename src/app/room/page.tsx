import type { Metadata } from "next";
import Link from "next/link";
import { RoomIndex } from "@/components/room/room-index";

export const metadata: Metadata = { title: "Tus salas" };

export default function RoomsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-4">
        <p className="eyebrow">Salas</p>
        <h1 className="m-0 text-title font-medium">
          Tus salas <span className="text-headline-muted">con moderador.</span>
        </h1>
      </header>
      <RoomIndex />
      <nav aria-label="Explorar salas" className="flex gap-4 text-sm">
        <Link href="/directory">Ir al directorio</Link>
        <Link href="/room/demo">Ver demo</Link>
      </nav>
    </main>
  );
}
