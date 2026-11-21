"use client";

import { Button } from "@ui-sdk/react/button";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AgentBuilderAccess, builderError } from "./agent-builder-access";

export function AgentBuilderNew() {
  return (
    <AgentBuilderAccess>
      <NewForm />
    </AgentBuilderAccess>
  );
}
function NewForm() {
  const create = useMutation(api.agentBuilder.createDraft);
  const router = useRouter();
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-6 rounded-4xl border border-border bg-card p-6 sm:p-8"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        try {
          const { agentId } = await create({ name, summary });
          router.push(`/agents/${agentId}`);
        } catch (error) {
          setError(builderError(error));
          setPending(false);
        }
      }}
    >
      <Field name="name">
        <FieldLabel>Nombre de tu agente</FieldLabel>
        <Input
          value={name}
          onValueChange={setName}
          required
          maxLength={120}
          placeholder="Por ejemplo: Peluquería de Ana"
        />
        <FieldDescription>
          Puede ser el nombre de tu negocio o proyecto.
        </FieldDescription>
      </Field>
      <Field name="summary">
        <FieldLabel>¿Qué hace tu agente?</FieldLabel>
        <Textarea
          value={summary}
          onValueChange={setSummary}
          required
          maxLength={1000}
          rows={4}
          placeholder="Responde preguntas sobre los horarios y servicios de mi peluquería"
        />
        <FieldDescription>
          Cuéntalo en una frase. Después podrás cambiarlo.
        </FieldDescription>
      </Field>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        data-variant="brand"
        data-size="lg"
        disabled={pending || !name.trim() || !summary.trim()}
      >
        {pending ? "Creando tu borrador…" : "Crear y continuar"}
      </Button>
      <p className="text-sm text-subtle-foreground">
        Todavía no se publicará. En el siguiente paso le darás la información
        que necesita.
      </p>
    </form>
  );
}
