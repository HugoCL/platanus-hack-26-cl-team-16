"use client";

import { SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { Textarea } from "@ui-sdk/react/textarea";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import {
  CheckIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard } from "@/convex/directory";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { SessionIntent } from "@/shared/session";
import { Ledger, scopeRows } from "../ledger";
import { openRoomError } from "../room/live-room";
import { intentLabel } from "../room/room-format";

const MAX_DESCRIPTION = 500;
const MAX_VIOLATIONS = 3;

type Step = "intent" | "contract";

/** Opens a moderated room after reviewing its intent and contract; agents are resolved server-side. */
export function OpenSessionDialog({
  card,
  onClose,
}: {
  card: DirectoryCard | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const openRoom = useAction(api.rooms.openFromCard);
  const self = useQuery(api.directory.get, { slug: CONSUMER_AGENT_SLUG });
  const [step, setStep] = useState<Step>("intent");
  const [intent, setIntent] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const opening = useRef(false);

  useEffect(() => {
    if (!card) return;
    setStep("intent");
    setIntent(card.allowedIntents[0] ?? null);
    setDescription("");
    setError(undefined);
  }, [card]);

  const selfName = self?.name ?? "Tu agente";
  const valid =
    !!intent &&
    !!card?.allowedIntents.includes(intent) &&
    SessionIntent.safeParse({ name: intent, description: description.trim() })
      .success;

  async function confirm() {
    if (!card || !intent || !valid || opening.current || !isAuthenticated)
      return;
    opening.current = true;
    setPending(true);
    setError(undefined);
    try {
      const { sessionId } = await openRoom({
        providerSlug: card.slug,
        intent,
        description: description.trim(),
      });
      router.push(`/room/${sessionId}`);
    } catch (error) {
      setError(openRoomError(error));
    } finally {
      opening.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open={card !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogBackdrop />
      <DialogContent className="flex w-[min(440px,calc(100vw-2rem))] flex-col gap-5">
        {card ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Steps step={step} />
              <DialogClose
                disabled={pending}
                aria-label="Cerrar"
                data-variant="ghost"
                className="!size-8 !p-0 text-subtle-foreground"
              >
                <XIcon aria-hidden size={16} />
              </DialogClose>
            </div>

            {step === "intent" ? (
              <>
                <div className="flex flex-col gap-1">
                  <DialogTitle className="m-0 text-xl font-semibold tracking-tight">
                    ¿Para qué quieres conversar?
                  </DialogTitle>
                  <DialogDescription className="m-0 text-caption text-subtle-foreground">
                    {selfName} habla con {card.name}.
                  </DialogDescription>
                </div>

                {card.allowedIntents.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <span id="open-intent" className="text-caption font-medium">
                      Intención
                    </span>
                    <RadioGroup
                      aria-labelledby="open-intent"
                      value={intent}
                      onValueChange={(value) => setIntent(value)}
                      className="!flex !flex-col !gap-2"
                    >
                      {card.allowedIntents.map((name) => (
                        <label
                          key={name}
                          data-slot="card"
                          className="flex items-center gap-3 border border-input px-3.5 py-3"
                        >
                          <Radio value={name}>
                            <RadioIndicator />
                          </Radio>
                          <span className="flex-1">{intentLabel(name)}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                ) : (
                  <p className="m-0 text-subtle-foreground">
                    Este agente no declara intenciones, así que no se puede
                    abrir una sala con él.
                  </p>
                )}

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="open-description"
                    className="text-caption font-medium"
                  >
                    Descripción corta
                  </label>
                  <Textarea
                    id="open-description"
                    rows={2}
                    maxLength={MAX_DESCRIPTION}
                    value={description}
                    onValueChange={setDescription}
                    placeholder="ej. Hora con cardiólogo esta semana"
                    className="resize-none"
                  />
                  <span className="self-end text-xs text-subtle-foreground tabular-nums">
                    {description.length} / {MAX_DESCRIPTION}
                  </span>
                </div>

                <div className="flex justify-end gap-2">
                  <Button data-size="lg" onClick={onClose}>
                    Cancelar
                  </Button>
                  <Button
                    data-variant="solid"
                    data-size="lg"
                    disabled={!valid}
                    onClick={() => setStep("contract")}
                  >
                    Revisar contrato
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <DialogTitle className="m-0 text-xl font-semibold tracking-tight">
                    Revisa el contrato
                  </DialogTitle>
                  <DialogDescription className="m-0 text-caption text-subtle-foreground">
                    Esto rige la sala. El moderador revisa cada mensaje contra
                    este contrato.
                  </DialogDescription>
                </div>
                {description.trim() ? (
                  <p className="m-0 text-pretty break-words">
                    <span className="text-subtle-foreground">
                      {selfName} va a pedir:
                    </span>{" "}
                    “{description.trim()}”
                  </p>
                ) : null}
                <Ledger
                  className="text-caption"
                  rows={[
                    {
                      label: "Intención",
                      value: intent ? intentLabel(intent) : "",
                    },
                    ...scopeRows({
                      requests: card.scope.dataItRequests,
                      shares: card.scope.dataItShares,
                      forbidden: card.scope.forbiddenTopics,
                    }),
                    { label: "Máximo de bloqueos", value: MAX_VIOLATIONS },
                  ]}
                />
                {error ? (
                  <p role="alert" className="m-0 text-sm text-destructive-text">
                    {error}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    data-size="lg"
                    disabled={pending}
                    onClick={() => setStep("intent")}
                  >
                    Volver
                  </Button>
                  {isAuthenticated ? (
                    <Button
                      data-variant="solid"
                      data-size="lg"
                      aria-busy={pending}
                      disabled={pending || !valid}
                      onClick={confirm}
                      className="inline-flex items-center gap-2"
                    >
                      {pending ? (
                        <LoaderCircleIcon
                          aria-hidden
                          size={16}
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : (
                        <ShieldCheckIcon aria-hidden size={16} />
                      )}
                      {pending ? "Negociando contrato…" : "Abrir sala moderada"}
                    </Button>
                  ) : (
                    <SignInButton mode="modal">
                      <Button
                        data-variant="solid"
                        data-size="lg"
                        disabled={isLoading || !valid}
                      >
                        Iniciar sesión para abrir sala
                      </Button>
                    </SignInButton>
                  )}
                </div>
              </>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Steps({ step }: { step: Step }) {
  const items = [
    { key: "who", label: "Quién", done: true },
    { key: "intent", label: "Para qué", done: step === "contract" },
    { key: "contract", label: "Contrato", done: false },
  ];
  return (
    <ol
      aria-label="Pasos"
      className="m-0 flex list-none items-center gap-1.5 p-0 text-xs whitespace-nowrap tabular-nums"
    >
      {items.map((item, index) => {
        const current = item.key === step;
        return (
          <li
            key={item.key}
            aria-current={current ? "step" : undefined}
            className={`inline-flex items-center gap-1.5 ${current ? "font-medium" : "text-subtle-foreground"}`}
          >
            {index > 0 ? (
              <span aria-hidden className="h-px w-2 bg-input sm:w-4" />
            ) : null}
            <span
              className={`grid size-5.5 place-items-center rounded-full ${
                current
                  ? "bg-primary text-primary-foreground"
                  : item.done
                    ? "bg-muted"
                    : "border border-ring"
              }`}
            >
              {item.done ? <CheckIcon aria-hidden size={12} /> : index + 1}
            </span>
            {item.label}
            {item.done ? <span className="sr-only"> (listo)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
