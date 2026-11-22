"use client";

import { Button } from "@ui-sdk/react/button";
import { Textarea } from "@ui-sdk/react/textarea";
import { ArrowUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_TEXT_LENGTH } from "@/shared/messages";

/**
 * The foot of the room. While the agent speaks there is no text field: one sentence and
 * "Tomar control". Taking control swaps that for the field, under a band that says who you speak as.
 */
export function RoomComposer({
  readOnly,
  sending = false,
  closedLabel,
  control,
  canControl,
  selfName,
  onTakeControl,
  onReturnControl,
  onSend,
  onRestart,
}: {
  readOnly: boolean;
  sending?: boolean;
  closedLabel?: string;
  control: boolean;
  canControl: boolean;
  selfName: string;
  onTakeControl: () => void;
  onReturnControl: () => void;
  onSend: (text: string) => void | Promise<boolean | void>;
  onRestart?: () => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const take = useRef<HTMLButtonElement>(null);
  const live = control && canControl && !readOnly;
  const wasLive = useRef(live);

  // Focus follows the swap: into the field on taking control, back to the button on returning it.
  useEffect(() => {
    if (live === wasLive.current) return;
    wasLive.current = live;
    if (live) input.current?.focus();
    else take.current?.focus();
  }, [live]);

  if (readOnly) {
    return (
      <div className="room-composer bg-muted">
        <div className="room-col flex flex-wrap items-center gap-3 py-3">
          <span className="flex-1 text-pretty">
            {closedLabel ?? "Sala cerrada"}
          </span>
          {onRestart ? (
            <Button data-size="sm" onClick={onRestart}>
              Abrir nueva sala
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!canControl) {
    return (
      <div className="room-composer">
        <p className="room-col m-0 py-4 text-pretty text-subtle-foreground">
          Estás observando esta sala. Solo el dueño o un operador puede
          escribir.
        </p>
      </div>
    );
  }

  if (!live) {
    return (
      <div className="room-composer">
        <div className="room-col room-composer-idle">
          <p className="m-0 text-subtle-foreground">
            Tu agente está hablando por ti.
          </p>
          <Button
            ref={take}
            data-variant="solid"
            data-size="xl"
            onClick={onTakeControl}
          >
            Tomar control
          </Button>
        </div>
      </div>
    );
  }

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    const accepted = await onSend(value);
    if (accepted !== false) setText("");
  };
  const nearLimit = text.length >= MAX_TEXT_LENGTH * 0.9;

  return (
    <div className="room-composer room-composer-live">
      <div className="bg-brand text-brand-ink">
        <div className="room-col flex items-center justify-between gap-2 py-1.5 text-caption">
          <span className="min-w-0 truncate">
            Estás hablando como <b className="font-semibold">{selfName}</b>
          </span>
          <Button
            data-variant="ghost"
            data-size="sm"
            className="room-return"
            onClick={onReturnControl}
          >
            Devolver control
          </Button>
        </div>
      </div>
      <form
        className="room-col flex flex-col gap-1 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={input}
            disabled={sending}
            aria-label="Mensaje"
            value={text}
            onValueChange={setText}
            maxLength={MAX_TEXT_LENGTH}
            autoResize
            submitShortcut="enter"
            rows={1}
            placeholder="Escribe un mensaje"
            className="room-composer-input min-w-0 flex-1"
          />
          <Button
            type="submit"
            data-variant="solid"
            aria-label={sending ? "Enviando" : "Enviar"}
            disabled={sending || !text.trim()}
            className="!h-11 !w-11 flex-none !p-0"
          >
            <ArrowUpIcon size={16} />
          </Button>
        </div>
        {sending || nearLimit ? (
          <p className="m-0 flex justify-between text-micro text-subtle-foreground">
            <span role="status">{sending ? "Enviando…" : ""}</span>
            {nearLimit ? (
              <span className="tabular-nums">
                {text.length} / {MAX_TEXT_LENGTH}
              </span>
            ) : null}
          </p>
        ) : null}
      </form>
    </div>
  );
}
