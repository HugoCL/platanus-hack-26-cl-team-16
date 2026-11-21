"use client";

import { useQuery } from "convex/react";
import DirectoryList from "@/components/DirectoryList";
import { api } from "@/convex/_generated/api";

export default function DirectoryPage() {
  const cards = useQuery(api.directory.search, {})?.agents;
  const categories = useQuery(api.directory.categories, {});

  return (
    <main className="p-4 sm:p-8 flex flex-col gap-6 w-full max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold">Directorio de agentes</h1>
      {cards === undefined || categories === undefined ? (
        <p className="text-muted-foreground" data-testid="loading">
          Cargando…
        </p>
      ) : (
        <DirectoryList cards={cards} categories={categories} />
      )}
    </main>
  );
}
