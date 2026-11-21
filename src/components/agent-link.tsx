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
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function useExpired(expiresAt: number | undefined) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (expiresAt === undefined) return () => {};
      const timer = setTimeout(onChange, Math.max(0, expiresAt - Date.now()));
      return () => clearTimeout(timer);
    },
    [expiresAt],
  );
  const snapshot = useCallback(
    () => expiresAt !== undefined && expiresAt <= Date.now(),
    [expiresAt],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function AgentLink({ code }: { code: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const info = useQuery(api.agentRegistration.linkInfo, { code });
  const expired = useExpired(
    info?.linkedToCurrentUser ? undefined : info?.expiresAt,
  );
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
  if (
    !info ||
    (!info.linkedToCurrentUser &&
      (expired || info.usedAt !== undefined || info.alreadyLinked))
  )
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
        info.wantsPublic ? (
          <PublishForm
            agentId={info.agentId}
            description={info.description}
            purpose={info.purpose}
            category={info.category}
            code={code}
          />
        ) : (
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
              Vincular
            </Button>
          </div>
        )
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
              purpose={info.purpose}
              category={info.category}
            />
          )}
          <AgentRooms agentId={info.agentId} />
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

function AgentRooms({ agentId }: { agentId: Id<"agents"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.agentRegistration.rooms,
    { agentId },
    { initialNumItems: 20 },
  );
  return (
    <section className="space-y-4" aria-label="Salas del agente">
      <h3 className="text-lg font-semibold">Salas de tu agente</h3>
      {status === "LoadingFirstPage" ? (
        <p role="status">Cargando salas…</p>
      ) : results.length === 0 ? (
        <p>Tu agente todavía no ha abierto salas.</p>
      ) : (
        <ul className="space-y-3">
          {results.map((room) => (
            <li
              key={room.sessionId}
              className="flex flex-wrap items-center gap-3"
            >
              <Button render={<Link href={`/room/${room.sessionId}`} />}>
                {room.description}
              </Button>
              <span className="text-sm text-subtle-foreground">
                {room.status === "active" || room.status === "requested"
                  ? "Abierta"
                  : "Cerrada"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(20)}
        >
          {status === "LoadingMore" ? "Cargando…" : "Ver más salas"}
        </Button>
      )}
    </section>
  );
}

function PublishForm({
  agentId,
  description: initialDescription,
  purpose: initialPurpose,
  category: initialCategory,
  code,
}: {
  agentId: Id<"agents">;
  description: string;
  purpose: string;
  category: string;
  code?: string;
}) {
  const categories = useQuery(api.directory.categories, {});
  const publish = useMutation(api.agentRegistration.publish);
  const link = useMutation(api.agentRegistration.link);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [category, setCategory] = useState(initialCategory);
  const [description, setDescription] = useState(initialDescription);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(onlyLink = false) {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const values = {
        purpose,
        category,
        description: description.trim() || undefined,
      };
      if (code) await link({ code, ...(onlyLink ? {} : { publish: values }) });
      else await publish({ agentId, ...values });
    } catch {
      setError(
        "No pudimos guardar el cambio. Revisa los campos y tu sesión e inténtalo de nuevo.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <h3 className="text-lg font-semibold">Publicar en el directorio</h3>
        <p className="mt-2 text-sm text-subtle-foreground">
          {code
            ? "Tu agente solicita aparecer en el directorio. Revisa los datos que preparó; puedes editarlos o vincularlo sin publicar."
            : "Tu agente preparó estos datos. Puedes editarlos. Publicar es opcional y permite que otros lo descubran por su propósito."}
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
        data-agent-confirm={
          code
            ? "Vincula este agente a tu cuenta y publica su ficha en el directorio"
            : "Publica tu agente en el directorio para que otras personas lo vean"
        }
      >
        {pending
          ? "Guardando…"
          : code
            ? "Vincular y publicar"
            : "Publicar agente"}
      </Button>
      {code && (
        <Button
          type="button"
          disabled={pending}
          data-agent-confirm="Vincula este agente a tu cuenta sin publicarlo"
          onClick={() => save(true)}
        >
          Solo vincular
        </Button>
      )}
    </form>
  );
}
