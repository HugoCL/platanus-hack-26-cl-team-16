"use client";

import { useCallback, useEffect, useState } from "react";
import type { UiResponse } from "@/shared/genui";
import type { ScriptStep } from "./demo-session";
import type { GenUiAnswer } from "./genui-block";
import { type RoomMessage, responseTargetId } from "./room-format";

const TYPING_MS = 1000;
const REVIEW_MS = 900;

// A stress dataset starts with every message already delivered and every answered card answered.
function played(script: ScriptStep[]) {
  const messages = script.map((s) => s.message);
  const answers: Record<string, GenUiAnswer> = {};
  for (const m of messages)
    if (m.content.kind === "ui_response")
      answers[responseTargetId(m.content.response)] = {
        response: m.content.response,
        at: m.sentAt,
      };
  return { messages, answers, step: script.length };
}

const EMPTY = { messages: [], answers: {}, step: 0 };

function asPending(message: RoomMessage): RoomMessage {
  return { ...message, status: "pending", verdict: null, reasons: undefined };
}

// Plays DEMO_SCRIPT like a live session: each agent message arrives pending, then gets its verdict.
// The script pauses on a GenUI card until the human answers it. `instant` skips the playback.
export function useDemoRoom(script: ScriptStep[], instant = false) {
  const initial = () => (instant ? played(script) : EMPTY);
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(() => initial().step);
  const [messages, setMessages] = useState<RoomMessage[]>(
    () => initial().messages,
  );
  const [answers, setAnswers] = useState<Record<string, GenUiAnswer>>(
    () => initial().answers,
  );
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
    if (waitingFor || step >= script.length) {
      setTyping(null);
      return;
    }
    const { message, awaitsResponse } = script[step];
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
  }, [step, waitingFor, deliver, run, script]);

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

  // The owner settles a message the moderator escalated.
  const review = useCallback((messageId: string, approve: boolean) => {
    setMessages((list) =>
      list.map((m): RoomMessage => {
        if (m.messageId !== messageId) return m;
        return approve
          ? {
              ...m,
              status: "allowed",
              verdict: { decision: "allow", reason: "Aprobado por el dueño" },
            }
          : {
              ...m,
              status: "blocked",
              verdict: {
                decision: "block",
                rule: "purpose",
                reason: "Rechazado por el dueño",
              },
            };
      }),
    );
  }, []);

  const reset = useCallback(() => {
    const start = instant ? played(script) : EMPTY;
    setMessages(start.messages);
    setAnswers(start.answers);
    setWaitingFor(null);
    setStep(start.step);
    setRun((r) => r + 1);
  }, [instant, script]);

  return {
    messages,
    answers,
    typing,
    finished: step >= script.length && !waitingFor,
    respond,
    review,
    sendText,
    reset,
  };
}
