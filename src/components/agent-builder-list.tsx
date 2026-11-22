"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { AgentBuilderAccess, builderError } from "./agent-builder-access";

export function AgentBuilderList() {
  return (
    <AgentBuilderAccess>
      <AgentList />
    </AgentBuilderAccess>
  );
}
function AgentList() {
  const agents = useQuery(api.agentBuilder.mine, {});
  if (!agents) return <p role="status">Cargando tus agentes…</p>;
  if (!agents.length)
    return (
      <section className="rounded-4xl border border-dashed border-border bg-card p-8 text-center sm:p-12">
        <h2 className="text-2xl font-semibold">
          Tu primer ayudante empieza aquí
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-subtle-foreground">
          Dale la información de tu negocio o proyecto para que pueda responder
          preguntas. Tú revisas todo antes de compartirlo.
        </p>
        <Button
          className="mt-6"
          data-variant="brand"
          data-size="lg"
          render={<Link href="/agents/new" />}
        >
          Crear mi primer agente
        </Button>
      </section>
    );
  return (
    <>
      <div className="mb-6 flex justify-end">
        <Button data-variant="brand" render={<Link href="/agents/new" />}>
          Crear otro agente
        </Button>
      </div>
      <ul className="space-y-4">
        {agents.map(({ agent, sourceCounts }) => (
          <li key={agent._id}>
            <AgentListCard agent={agent} counts={sourceCounts} />
          </li>
        ))}
      </ul>
    </>
  );
}
function AgentListCard({
  agent,
  counts,
}: {
  agent: Doc<"agents">;
  counts: { ready: number; processing: number; failed: number };
}) {
  const publish = useMutation(api.agentBuilder.publish);
  const unpublish = useMutation(api.agentBuilder.unpublish);
  const remove = useMutation(api.agentBuilder.deleteAgent);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await operation();
      setOpen(false);
    } catch (error) {
      setError(builderError(error));
    } finally {
      setPending(false);
    }
  }
  const active = agent.status === "active";
  return (
    <article className="rounded-4xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{agent.name}</h2>
        <span
          className={`rounded-lg px-3 py-1 text-xs font-medium ${active ? "bg-brand text-brand-ink" : "bg-muted"}`}
        >
          {active ? "Publicado" : "Borrador"}
        </span>
      </div>
      <p className="mt-3 text-subtle-foreground">{agent.description}</p>
      <p className="mt-4 text-sm text-subtle-foreground">
        {counts.ready} fuentes listas · {counts.processing} procesando ·{" "}
        {counts.failed} con problemas
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button render={<Link href={`/agents/${agent._id}`} />}>Editar</Button>
        <Button
          disabled={pending}
          onClick={() =>
            run(() =>
              active
                ? unpublish({ agentId: agent._id })
                : publish({ agentId: agent._id }),
            )
          }
        >
          {active ? "Ocultar" : "Publicar"}
        </Button>
        {active ? (
          <Button render={<Link href={`/directory/${agent.slug}`} />}>
            Ver en el directorio
          </Button>
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>Eliminar</DialogTrigger>
            <DialogBackdrop />
            <DialogContent>
              <DialogTitle>¿Eliminar a {agent.name}?</DialogTitle>
              <DialogDescription>
                Se eliminarán su información y sus archivos. No podrás
                recuperarlos.
              </DialogDescription>
              <div className="mt-5 flex gap-3">
                <DialogClose disabled={pending}>Cancelar</DialogClose>
                <Button
                  data-variant="solid"
                  disabled={pending}
                  onClick={() => run(() => remove({ agentId: agent._id }))}
                >
                  Eliminar definitivamente
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>
      {error && !open && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
