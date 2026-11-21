"use client";

import { useQuery } from "convex/react";
import DirectoryList from "@/components/directory-list";
import { api } from "@/convex/_generated/api";

export default function DirectoryPage() {
  const result = useQuery(api.directory.search, {});
  const categories = useQuery(api.directory.categories, {});

  return (
    <main className="p-4 sm:p-8 flex flex-col gap-6 w-full max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold">Directorio de agentes</h1>
      {result === undefined || categories === undefined ? (
        <p className="text-muted-foreground" data-testid="loading">
          Cargando…
        </p>
      ) : (
        <>
          {result.truncated && (
            <p className="text-muted-foreground" data-testid="partial">
              Resultado parcial: se muestran las primeras {result.agents.length}{" "}
              fichas.
            </p>
          )}
          <DirectoryList cards={result.agents} categories={categories} />
        </>
      )}
    </main>
  );
}
