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
import { UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { inviteError } from "./live-room";

// Brings a friend's agent into the room. The friend approves it, unless they auto-approve you.
export function InviteAgent({
  sessionId,
  agentIdsInRoom,
}: {
  sessionId: Id<"sessions">;
  agentIdsInRoom: string[];
}) {
  const friends = useQuery(api.friends.list, {});
  const pendingInvitations = useQuery(api.roomInvitations.forRoom, {
    sessionId,
  });
  const invite = useMutation(api.roomInvitations.invite);
  const cancel = useMutation(api.roomInvitations.cancel);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(operation: () => Promise<string>) {
    setBusy(true);
    setStatus("");
    try {
      setStatus(await operation());
    } catch (error) {
      setStatus(inviteError(error));
    } finally {
      setBusy(false);
    }
  }
  const pendingFor = (agentId: string) =>
    pendingInvitations?.find((row) => row.agentId === agentId);
  const withAgents = friends?.filter((friend) => friend.agents.length) ?? [];

  return (
    <Dialog>
      <DialogTrigger className="room-head-btn">
        <UserPlusIcon size={16} />
        <span className="max-sm:sr-only">Invitar agente</span>
      </DialogTrigger>
      <DialogBackdrop />
      <DialogContent>
        <DialogTitle>Invitar al agente de un amigo</DialogTitle>
        <DialogDescription>
          Tu amigo aprueba la invitación antes de que su agente entre, salvo que
          apruebe tus llamadas automáticamente. Al entrar, él y su agente ven la
          conversación desde ese momento.
        </DialogDescription>
        {!friends ? (
          <p role="status" className="mt-4">
            Cargando tus amigos…
          </p>
        ) : !withAgents.length ? (
          <p className="mt-4 text-subtle-foreground">
            Ninguno de tus amigos tiene agentes todavía.{" "}
            <Link href="/friends">Agrega un amigo</Link>.
          </p>
        ) : (
          <ul className="m-0 mt-4 flex list-none flex-col gap-4 p-0">
            {withAgents.map((friend) => (
              <li key={friend.friendshipId}>
                <h3 className="m-0 text-sm font-medium text-subtle-foreground">
                  {friend.name}
                </h3>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {friend.agents.map((agent) => {
                    const pending = pendingFor(agent.agentId);
                    return (
                      <li
                        key={agent.agentId}
                        className="flex min-w-0 items-center gap-3"
                      >
                        <b
                          className="min-w-0 flex-1 truncate font-medium"
                          title={agent.name}
                        >
                          {agent.name}
                        </b>
                        {agentIdsInRoom.includes(agent.agentId) ? (
                          <small className="flex-none text-subtle-foreground">
                            En la sala
                          </small>
                        ) : pending ? (
                          <>
                            <small className="flex-none text-subtle-foreground">
                              Esperando aprobación
                            </small>
                            {pending.mine ? (
                              <Button
                                data-size="sm"
                                className="flex-none"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await cancel({
                                      invitationId: pending.invitationId,
                                    });
                                    return "Invitación cancelada.";
                                  })
                                }
                              >
                                Cancelar
                              </Button>
                            ) : null}
                          </>
                        ) : (
                          <Button
                            data-size="sm"
                            data-variant="solid"
                            className="flex-none"
                            disabled={busy || !pendingInvitations}
                            onClick={() =>
                              run(async () => {
                                const result = await invite({
                                  sessionId,
                                  agentId: agent.agentId,
                                });
                                return result.status === "approved"
                                  ? `${agent.name} ya está en la sala.`
                                  : `Invitación enviada. ${friend.name} la verá en Amigos.`;
                              })
                            }
                          >
                            Invitar
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p
          role="status"
          className="mt-4 min-h-5 text-sm text-subtle-foreground"
        >
          {status}
        </p>
        <DialogClose className="mt-2">Cerrar</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
