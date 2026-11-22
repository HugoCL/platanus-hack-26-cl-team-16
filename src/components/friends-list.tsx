"use client";

import { SignInButton, useAuth, useUser } from "@clerk/nextjs";
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
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";

const FAILED = "No pudimos guardar el cambio. Inténtalo de nuevo.";

function useDisplayName() {
  const { user } = useUser();
  return user?.fullName || user?.username || undefined;
}

function SignedIn({
  children,
  prompt,
  redirectUrl,
}: {
  children: ReactNode;
  prompt: string;
  redirectUrl: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (!isLoaded || (isSignedIn && isLoading))
    return <p role="status">Cargando tu cuenta…</p>;
  if (!isSignedIn)
    return (
      <div className="space-y-4">
        <p>{prompt}</p>
        <SignInButton mode="modal" forceRedirectUrl={redirectUrl}>
          <Button data-variant="brand">Iniciar sesión</Button>
        </SignInButton>
      </div>
    );
  if (!isAuthenticated)
    return <p>No pudimos verificar tu cuenta. Vuelve a iniciar sesión.</p>;
  return children;
}

export function FriendsList() {
  return (
    <SignedIn
      prompt="Inicia sesión para agregar amigos y coordinar con sus agentes."
      redirectUrl="/friends"
    >
      <RoomInvitations />
      <InviteLink />
      <Friends />
    </SignedIn>
  );
}

// Requests to bring one of your agents into a friend's room. Approving takes you there.
function RoomInvitations() {
  const invitations = useQuery(api.roomInvitations.inbox, {});
  const respond = useMutation(api.roomInvitations.respond);
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (!invitations?.length) return null;
  async function answer(
    { invitationId, sessionId }: (typeof invitations & object)[number],
    approve: boolean,
  ) {
    setPending(true);
    setError("");
    try {
      await respond({ invitationId, approve });
      if (approve) router.push(`/room/${sessionId}`);
    } catch {
      setError(
        "No pudimos responder la invitación. Puede que la sala ya esté cerrada.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mb-8 rounded-lg border border-border bg-card p-5">
      <h2 className="text-xl font-semibold">Invitaciones a salas</h2>
      <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
        {invitations.map((invitation) => (
          <li
            key={invitation.invitationId}
            className="flex flex-wrap items-center gap-3"
          >
            <p className="m-0 min-w-0 flex-1 basis-64 break-words text-pretty">
              <b className="font-medium">{invitation.inviterName}</b> quiere
              sumar a <b className="font-medium">{invitation.agentName}</b> a su
              sala
              {invitation.request ? `: “${invitation.request}”` : "."}
            </p>
            <div className="flex flex-none gap-2">
              <Button
                disabled={pending}
                onClick={() => answer(invitation, false)}
              >
                Rechazar
              </Button>
              <Button
                data-variant="brand"
                disabled={pending}
                onClick={() => answer(invitation, true)}
              >
                Aprobar y entrar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function InviteLink() {
  const createInvite = useMutation(api.friends.createInvite);
  const displayName = useDisplayName();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  async function create() {
    setPending(true);
    setStatus("");
    try {
      const { code } = await createInvite({ displayName });
      setUrl(`${window.location.origin}/friends/${code}`);
    } catch {
      setStatus("No pudimos crear el enlace. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="invite-heading"
      className="rounded-4xl border border-border bg-card p-6"
    >
      <h2 id="invite-heading" className="text-xl font-semibold">
        Agregar a un amigo
      </h2>
      <p className="mt-2 text-subtle-foreground">
        Crea un enlace y envíaselo. Sirve una vez, por 7 días, y al aceptarlo
        quedan como amigos. Un enlace nuevo anula el anterior.
      </p>
      {url && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            readOnly
            aria-label="Enlace de invitación"
            value={url}
            className="min-w-0 flex-1 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            onClick={() =>
              navigator.clipboard.writeText(url).then(
                () => setStatus("Enlace copiado."),
                () => setStatus("Copia el enlace a mano."),
              )
            }
          >
            Copiar
          </Button>
        </div>
      )}
      <Button
        className="mt-4"
        data-variant={url ? undefined : "brand"}
        disabled={pending}
        onClick={create}
      >
        {url ? "Crear otro enlace" : "Crear enlace de invitación"}
      </Button>
      <p role="status" className="mt-3 text-sm text-subtle-foreground">
        {status}
      </p>
    </section>
  );
}

function Friends() {
  const friends = useQuery(api.friends.list, {});
  if (!friends) return <p role="status">Cargando tus amigos…</p>;
  if (!friends.length)
    return (
      <p className="mt-8 text-subtle-foreground">Todavía no tienes amigos.</p>
    );
  return (
    <ul className="mt-8 space-y-4">
      {friends.map((friend) => (
        <li key={friend.friendshipId}>
          <FriendCard friend={friend} />
        </li>
      ))}
    </ul>
  );
}

function FriendCard({
  friend,
}: {
  friend: FunctionReturnType<typeof api.friends.list>[number];
}) {
  const setAutoApprove = useMutation(api.friends.setAutoApprove);
  const remove = useMutation(api.friends.remove);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await operation();
    } catch {
      setError(FAILED);
    } finally {
      setPending(false);
    }
  }
  const { friendshipId } = friend;
  return (
    <article className="rounded-4xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{friend.name}</h2>
        <Dialog>
          <DialogTrigger data-variant="ghost">Quitar</DialogTrigger>
          <DialogBackdrop />
          <DialogContent>
            <DialogTitle>¿Quitar a {friend.name}?</DialogTitle>
            <DialogDescription>
              Dejan de ser amigos los dos. Ninguno podrá llamar a los agentes
              del otro hasta que vuelvan a aceptar un enlace.
            </DialogDescription>
            <div className="mt-5 flex gap-3">
              <DialogClose disabled={pending}>Cancelar</DialogClose>
              <Button
                data-variant="solid"
                disabled={pending}
                onClick={() => run(() => remove({ friendshipId }))}
              >
                Quitar amigo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="mt-2 text-sm text-subtle-foreground">
        {friend.agents.length
          ? `Agentes: ${friend.agents.map((agent) => agent.name).join(", ")}`
          : "Todavía no tiene agentes."}
      </p>
      <Field className="mt-5 flex items-center justify-between gap-4">
        <div>
          <FieldLabel>Aprobar sus llamadas automáticamente</FieldLabel>
          <FieldDescription>
            {friend.name} podrá sumar tus agentes a sus salas sin pedirte
            permiso cada vez.
          </FieldDescription>
        </div>
        <Switch
          checked={friend.autoApprove}
          disabled={pending}
          onCheckedChange={(autoApprove) =>
            run(() => setAutoApprove({ friendshipId, autoApprove }))
          }
        >
          <SwitchThumb />
        </Switch>
      </Field>
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

export function FriendInvite({ code }: { code: string }) {
  const info = useQuery(api.friends.inviteInfo, { code });
  const accept = useMutation(api.friends.acceptInvite);
  const displayName = useDisplayName();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (info === undefined) return <p role="status">Cargando la invitación…</p>;
  const friendsLink = (
    <Button className="mt-5" render={<Link href="/friends" />}>
      Ver mis amigos
    </Button>
  );
  if (info?.alreadyFriends)
    return (
      <div className="mt-6">
        <p role="status" className="font-medium">
          {info.inviterName} y tú ya son amigos.
        </p>
        {friendsLink}
      </div>
    );
  if (info?.own)
    return (
      <div className="mt-6">
        <p>
          Este es tu propio enlace. Envíaselo a la persona que quieres agregar.
        </p>
        {friendsLink}
      </div>
    );
  // Convex re-runs the query when the invite changes, not when the clock passes `expiresAt`;
  // the mutation is what refuses an expired link.
  if (!info || info.used)
    return (
      <div className="mt-6">
        <p className="font-medium">Este enlace no es válido o ya se usó.</p>
        <p className="mt-2 text-subtle-foreground">
          Cada enlace sirve una vez. Pídele a tu amigo que cree uno nuevo.
        </p>
      </div>
    );
  return (
    <div className="mt-6 space-y-4">
      <p className="max-w-xl text-pretty">
        <strong>{info.inviterName}</strong> quiere agregarte como amigo. Podrán
        llamar a los agentes del otro a una sala, y cada llamada necesita la
        aprobación del dueño del agente.
      </p>
      <SignedIn
        prompt="Inicia sesión para aceptar la invitación."
        redirectUrl={`/friends/${code}`}
      >
        <Button
          data-variant="brand"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await accept({ code, displayName });
            } catch {
              setError(
                "No pudimos aceptar la invitación. Puede que el enlace haya vencido.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          Aceptar invitación
        </Button>
      </SignedIn>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
