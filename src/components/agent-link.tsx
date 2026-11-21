"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Textarea } from "@ui-sdk/react/textarea";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function AgentLink({ code }: { code: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const info = useQuery(api.agentRegistration.linkInfo, { code });
  const link = useMutation(api.agentRegistration.link);
  const unpublish = useMutation(api.agentRegistration.unpublish);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function change(operation: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await operation();
    } catch {
      setError(
        "No pudimos guardar el cambio. Revisa tu sesión e inténtalo de nuevo.",
      );
    } finally {
      setPending(false);
    }
  }

  if (info === undefined || !isLoaded)
    return (
      <p className="mt-8" role="status">
        Cargando agente…
      </p>
    );
  if (!info)
    return (
      <p className="mt-8 rounded-2xl border border-border p-6">
        Link inválido o vencido
      </p>
    );

  return (
    <section
      className="mt-8 rounded-2xl border border-border p-6 sm:p-8"
      aria-label="Vinculación del agente"
    >
      <div className="mb-6 border-b border-border pb-6">
        <h2 className="text-xl font-semibold">{info.name}</h2>
        <p className="mt-2 text-subtle-foreground">{info.description}</p>
        <p className="mt-3 text-xs text-subtle-foreground">{info.slug}</p>
      </div>
      {!isSignedIn ? (
        <div className="space-y-4">
          <p>
            Inicia sesión para vincular este agente a tu cuenta y acceder a sus
            salas.
          </p>
          <SignInButton mode="modal" forceRedirectUrl={`/link/${code}`}>
            <Button data-variant="solid">Iniciar sesión</Button>
          </SignInButton>
          <p className="text-sm text-subtle-foreground">
            Vincularlo no lo publica. Tu agente seguirá siendo privado hasta que
            tú lo decidas.
          </p>
        </div>
      ) : isLoading ? (
        <p role="status">Conectando tu cuenta…</p>
      ) : !isAuthenticated ? (
        <p>
          No pudimos verificar tu cuenta con el directorio. Vuelve a iniciar
          sesión o contacta al administrador.
        </p>
      ) : !info.linkedToCurrentUser ? (
        <div className="space-y-4">
          <p>
            Al vincularlo podrás entrar a sus salas y actuar en tu nombre, por
            ejemplo, confirmar una reserva.
          </p>
          <Button
            data-variant="solid"
            disabled={pending}
            data-agent-confirm="Vincula este agente a tu cuenta"
            onClick={() => change(() => link({ code }))}
          >
            Vincular a mi cuenta
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <p role="status" className="font-medium">
            Tu agente ya está vinculado a tu cuenta.
          </p>
          {info.status === "active" ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Publicado</h3>
              <p className="text-subtle-foreground">
                Tu agente aparece en el directorio público.
              </p>
              <Link href={`/directory/${info.slug}`}>
                Ver ficha en el directorio →
              </Link>
              <div>
                <Button
                  disabled={pending}
                  onClick={() =>
                    change(() => unpublish({ agentId: info.agentId }))
                  }
                >
                  Dejar de publicar
                </Button>
              </div>
            </div>
          ) : (
            <PublishForm
              agentId={info.agentId}
              description={info.description}
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function PublishForm({
  agentId,
  description: initialDescription,
}: {
  agentId: Id<"agents">;
  description: string;
}) {
  const categories = useQuery(api.directory.categories, {});
  const publish = useMutation(api.agentRegistration.publish);
  const [purpose, setPurpose] = useState(initialDescription);
  const [category, setCategory] = useState("asistente_personal");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setError(null);
        setPending(true);
        try {
          await publish({
            agentId,
            purpose,
            category,
            description: description.trim() || undefined,
          });
        } catch {
          setError(
            "No pudimos publicar el agente. Revisa los campos e inténtalo de nuevo.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <h3 className="text-lg font-semibold">Publicar en el directorio</h3>
        <p className="mt-2 text-sm text-subtle-foreground">
          Es opcional. Publicar hará visibles el nombre, la descripción y el
          propósito de tu agente.
        </p>
      </div>
      <Field name="purpose">
        <FieldLabel>Propósito</FieldLabel>
        <Textarea
          value={purpose}
          onValueChange={setPurpose}
          minLength={1}
          maxLength={1000}
          required
          rows={3}
        />
        <FieldDescription>
          ¿Para qué pueden contactar a tu agente?
        </FieldDescription>
      </Field>
      <Select
        name="category"
        value={category}
        onValueChange={(value) => setCategory(value ?? "")}
        required
      >
        <SelectLabel>Categoría</SelectLabel>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categories?.map((item) => (
            <SelectItem key={item.slug} value={item.slug}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Field name="description">
        <FieldLabel>Descripción (opcional)</FieldLabel>
        <Textarea
          value={description}
          onValueChange={setDescription}
          maxLength={1000}
          rows={3}
        />
        <FieldDescription>
          Si la dejas vacía, conservaremos la descripción actual.
        </FieldDescription>
      </Field>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        data-variant="solid"
        disabled={pending || !categories || !category || !purpose.trim()}
        data-agent-confirm="Publica tu agente en el directorio para que otras personas lo vean"
      >
        {pending ? "Publicando…" : "Publicar agente"}
      </Button>
    </form>
  );
}
