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
import { Check, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { DirectoryCard } from "@/convex/directory";
import { CONSUMER_AGENT_SLUG } from "@/shared/seed-data";
import { SessionIntent } from "@/shared/session";
import { openRoomError } from "../room/live-room";
import { dataFieldLabel, intentLabel } from "../room/room-format";

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
                <X aria-hidden size={16} />
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
                          <code className="!bg-transparent !p-0 font-mono text-xs text-subtle-foreground">
                            {name}
                          </code>
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
                <dl className="m-0 flex flex-col gap-3.5 text-caption">
                  <div className="flex flex-col gap-1">
                    <dt className="text-subtle-foreground">Intención</dt>
                    <dd className="m-0 break-words">
                      <span className="font-medium">
                        {intent ? intentLabel(intent) : ""}
                      </span>{" "}
                      · {description.trim()}
                    </dd>
                  </div>
                  <ChipRow
                    term="Te pedirá"
                    items={card.scope.dataItRequests.map(dataFieldLabel)}
                    className="bg-muted"
                  />
                  <ChipRow
                    term="Comparte"
                    items={card.scope.dataItShares.map(dataFieldLabel)}
                    className="border border-input"
                  />
                  <ChipRow
                    term="Temas prohibidos"
                    items={card.scope.forbiddenTopics}
                    className="bg-destructive-soft font-medium text-destructive-text"
                  />
                  <div className="flex justify-between gap-3 border-t border-border pt-3">
                    <dt className="text-subtle-foreground">
                      Máximo de bloqueos
                    </dt>
                    <dd className="m-0 font-medium tabular-nums">
                      {MAX_VIOLATIONS}
                    </dd>
                  </div>
                </dl>
                {error ? (
                  <p role="alert" className="m-0 text-sm text-destructive">
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
                        <LoaderCircle
                          aria-hidden
                          size={16}
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : (
                        <ShieldCheck aria-hidden size={16} />
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
      className="m-0 flex list-none items-center gap-1.5 p-0 text-xs tabular-nums"
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
              <span aria-hidden className="h-px w-4 bg-input" />
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
              {item.done ? (
                <Check aria-hidden size={12} strokeWidth={2} />
              ) : (
                index + 1
              )}
            </span>
            {item.label}
            {item.done ? <span className="sr-only"> (listo)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ChipRow({
  term,
  items,
  className,
}: {
  term: string;
  items: string[];
  className: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-subtle-foreground">{term}</dt>
      <dd className="m-0 flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-subtle-foreground">Nada</span>
        ) : (
          items.map((item) => (
            <span
              key={item}
              className={`inline-flex h-6.5 items-center rounded-lg px-2.5 ${className}`}
            >
              {item}
            </span>
          ))
        )}
      </dd>
    </div>
  );
}
