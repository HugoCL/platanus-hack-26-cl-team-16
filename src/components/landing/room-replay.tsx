"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UiSpec } from "@/shared/genui";
import { liveAnswers } from "../room/live-room";
import { MessageItem } from "../room/message-item";
import {
  countAgentTurns,
  countViolations,
  openingNotice,
  type RoomMessage,
  sessionEnd,
  violationOrdinals,
} from "../room/room-format";
import { RoomHeader } from "../room/room-header";
import {
  REPLAY_CONTRACT,
  REPLAY_PARTICIPANTS,
  REPLAY_SCRIPT,
  REPLAY_VIEWER,
} from "./room-replay-script";
import { buildReplayFrames, REST_MS } from "./room-replay-timeline";

const FRAMES = buildReplayFrames(REPLAY_SCRIPT);
const LAST = FRAMES.length - 1;
const PARTICIPANTS = new Map(
  REPLAY_PARTICIPANTS.map((p) => [p.participantId, p]),
);
const OTHER = REPLAY_PARTICIPANTS.find((p) => p.side === "other");
const SELF = REPLAY_PARTICIPANTS.find((p) => p.side === "self");
const UI_SPECS: Record<string, UiSpec> = Object.fromEntries(
  REPLAY_SCRIPT.flatMap(({ message }) =>
    message.content.kind === "ui"
      ? [[message.messageId, message.content.spec]]
      : [],
  ),
);
const noop = () => {};

// The landing's demo: the real room's parts (header, messages, moderator) playing a
// scripted conversation on a loop. It pauses off screen, and under reduced motion it shows the
// last frame and stays still.
export function RoomReplay() {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(LAST);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setIndex(0);
    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const done = index >= LAST;
    const timer = setTimeout(
      () => setIndex(done ? 0 : index + 1),
      done ? REST_MS : FRAMES[index].holdMs,
    );
    return () => clearTimeout(timer);
  }, [playing, index]);

  const { messages, typing } = FRAMES[index];
  const answers = useMemo(() => liveAnswers(messages), [messages]);
  const ordinals = useMemo(() => violationOrdinals(messages), [messages]);
  const end = sessionEnd(messages);
  const typist = typing ? PARTICIPANTS.get(typing) : undefined;

  return (
    <div
      ref={ref}
      className="landing-replay"
      role="img"
      aria-label="Repetición de una sala: los agentes de tres hermanos reservan una hora al cardiólogo para su mamá con el agente de una clínica. El moderador bloquea un intento de prompt injection, tacha un pedido de datos fuera del contrato y oculta el RUT al resto de la sala."
    >
      <div inert className="landing-replay-room">
        <RoomHeader
          self={SELF}
          other={OTHER}
          viewer={REPLAY_VIEWER}
          participants={REPLAY_PARTICIPANTS}
          contract={REPLAY_CONTRACT}
          status={end?.status ?? "active"}
          turns={countAgentTurns(messages, REPLAY_PARTICIPANTS)}
          faults={countViolations(messages)}
          onlyInterventions={false}
          onOnlyInterventions={noop}
          onOpenAudit={noop}
        />
        <div className="landing-replay-thread">
          <div className="room-thread">
            {messages.map((message, i) => (
              <Entry
                key={message.messageId}
                message={message}
                previous={messages[i - 1]}
                answers={answers}
                fault={ordinals.get(message.messageId)}
              />
            ))}
          </div>
          <p
            data-mine={typist?.side === "self" ? "" : undefined}
            className="room-thread room-typing-line"
          >
            {typist ? (
              <span>
                <span className="room-typing" aria-hidden="true" />{" "}
                {typist.name} está escribiendo…
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

function Entry({
  message,
  previous,
  answers,
  fault,
}: {
  message: RoomMessage;
  previous?: RoomMessage;
  answers: ReturnType<typeof liveAnswers>;
  fault?: number;
}) {
  const { content } = message;
  const answer = content.kind === "ui" ? answers[content.spec.id] : undefined;
  return (
    <div className="landing-replay-entry">
      <MessageItem
        // The slot picker reads its answer only when it mounts, so it remounts once answered.
        key={answer ? "answered" : "open"}
        message={message}
        noticeText={
          content.kind === "system" && content.code === "session_opened"
            ? openingNotice(message.sentAt, REPLAY_CONTRACT.intent.name)
            : undefined
        }
        sender={
          message.senderParticipantId
            ? PARTICIPANTS.get(message.senderParticipantId)
            : undefined
        }
        continued={
          message.senderParticipantId !== null &&
          previous?.senderParticipantId === message.senderParticipantId
        }
        viewer={REPLAY_VIEWER}
        answers={answers}
        uiSpecsByMessage={UI_SPECS}
        fault={
          fault
            ? { ordinal: fault, max: REPLAY_CONTRACT.maxViolations }
            : undefined
        }
        readOnly
        onRespond={noop}
        onShowAudit={noop}
      />
    </div>
  );
}
