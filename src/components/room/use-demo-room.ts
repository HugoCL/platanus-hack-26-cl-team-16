"use client";

import { useCallback, useEffect, useState } from "react";
import type { UiResponse } from "@/shared/genui";
import { DEMO_SCRIPT } from "./demo-session";
import type { GenUiAnswer } from "./genui-block";
import { type RoomMessage, responseTargetId } from "./room-format";

const TYPING_MS = 1000;
const REVIEW_MS = 900;

function asPending(message: RoomMessage): RoomMessage {
  return { ...message, status: "pending", verdict: null, reasons: undefined };
}

// Plays DEMO_SCRIPT like a live session: each agent message arrives pending, then gets its verdict.
// The script pauses on a GenUI card until the human answers it.
export function useDemoRoom() {
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(0);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [answers, setAnswers] = useState<Record<string, GenUiAnswer>>({});
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);

  const lastAt = messages.at(-1)?.sentAt ?? Date.now();

  const deliver = useCallback((message: RoomMessage, onDone?: () => void) => {
    setMessages((list) => [...list, asPending(message)]);
    return window.setTimeout(() => {
      setMessages((list) =>
        list.map((m) => (m.messageId === message.messageId ? message : m)),
      );
      onDone?.();
    }, REVIEW_MS);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` restarts the script on reset.
  useEffect(() => {
    if (waitingFor || step >= DEMO_SCRIPT.length) {
      setTyping(null);
      return;
    }
    const { message, awaitsResponse } = DEMO_SCRIPT[step];
    const timers: number[] = [];
    setTyping(message.senderParticipantId);
    timers.push(
      window.setTimeout(() => {
        setTyping(null);
        const advance = () => {
          if (awaitsResponse && message.content.kind === "ui")
            setWaitingFor(message.content.spec.id);
          setStep((s) => s + 1);
        };
        if (message.senderParticipantId === null) {
          setMessages((list) => [...list, message]);
          advance();
        } else {
          timers.push(deliver(message, advance));
        }
      }, TYPING_MS),
    );
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [step, waitingFor, deliver, run]);

  const respond = useCallback(
    (response: UiResponse, inReplyTo: string) => {
      const specId = responseTargetId(response);
      const at = lastAt + 60_000;
      setAnswers((a) => ({ ...a, [specId]: { response, at } }));
      deliver(
        {
          messageId: `r-${specId}`,
          sessionId: "demo-session",
          senderParticipantId: "p-juan",
          recipient: "all",
          content: { kind: "ui_response", inReplyTo, response },
          status: "allowed",
          verdict: { decision: "allow", reason: "Respuesta a la tarjeta" },
          sentAt: at,
          audit: { model: "deterministic", latencyMs: 12 },
        },
        () => setWaitingFor((w) => (w === specId ? null : w)),
      );
    },
    [deliver, lastAt],
  );

  const sendText = useCallback(
    (text: string) => {
      deliver({
        messageId: `h-${Date.now()}`,
        sessionId: "demo-session",
        senderParticipantId: "p-juan",
        recipient: "all",
        content: { kind: "text", text },
        status: "allowed",
        verdict: { decision: "allow", reason: "Dentro del contrato" },
        sentAt: lastAt + 30_000,
        audit: { model: "anthropic/claude-haiku-5-5", latencyMs: 420 },
      });
    },
    [deliver, lastAt],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setAnswers({});
    setWaitingFor(null);
    setStep(0);
    setRun((r) => r + 1);
  }, []);

  return {
    messages,
    answers,
    typing,
    finished: step >= DEMO_SCRIPT.length && !waitingFor,
    respond,
    sendText,
    reset,
  };
}
