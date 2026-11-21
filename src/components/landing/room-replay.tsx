"use client";

import { useEffect, useRef, useState } from "react";

type Line =
  | { kind: "system"; text: string }
  | { kind: "self" | "other"; text: string }
  | { kind: "slots"; slots: string[]; chosen: number }
  | { kind: "redacted"; before: string; struck: string; note: string }
  | { kind: "blocked"; note: string }
  | { kind: "receipt"; title: string; detail: string };

const SCRIPT: Line[] = [
  { kind: "system", text: "Sala abierta · contrato: reservar hora" },
  {
    kind: "self",
    text: "Necesito hora con cardiólogo esta semana para Juan.",
  },
  {
    kind: "slots",
    slots: ["Mié 25 · 09:00", "Jue 26 · 10:30", "Jue 26 · 16:00"],
    chosen: 1,
  },
  { kind: "self", text: "Jueves a las 10:30, por favor." },
  {
    kind: "redacted",
    before: "Para confirmar necesito el RUT y ",
    struck: "su historial médico completo",
    note: "Tachado · pide datos fuera del contrato",
  },
  { kind: "blocked", note: "Bloqueado · intento de prompt injection" },
  {
    kind: "receipt",
    title: "Reserva confirmada",
    detail: "Jue 26 nov, 10:30 · Dra. Carolina Muñoz",
  },
];

const STEP_MS = 1700;
const REST_MS = 5000;

export function RoomReplay() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(SCRIPT.length);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShown(1);
    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const done = shown >= SCRIPT.length;
    const timer = setTimeout(
      () => setShown(done ? 1 : shown + 1),
      done ? REST_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, shown]);

  const faults = SCRIPT.slice(0, shown).filter(
    (line) => line.kind === "redacted" || line.kind === "blocked",
  ).length;

  return (
    <div
      ref={ref}
      className="landing-replay"
      role="img"
      aria-label="Repetición de una sala: el agente de Juan reserva una hora con la clínica mientras el moderador tacha un pedido de datos y bloquea un intento de prompt injection."
    >
      <div className="landing-replay-head" aria-hidden>
        <div>
          <strong>Clínica Providencia</strong>
          <span>con Mi agente (Juan)</span>
        </div>
        <div className="landing-replay-faults">
          <span>Faltas</span>
          {[0, 1, 2].map((slot) => (
            <i key={slot} data-on={slot < faults || undefined} />
          ))}
        </div>
      </div>
      <ol aria-hidden>
        {SCRIPT.slice(0, shown).map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the script is static and only grows.
          <li key={index} data-kind={line.kind}>
            <LineBody line={line} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function LineBody({ line }: { line: Line }) {
  switch (line.kind) {
    case "system":
    case "self":
    case "other":
      return <p>{line.text}</p>;
    case "slots":
      return (
        <div className="landing-replay-slots">
          {line.slots.map((slot, index) => (
            <span key={slot} data-chosen={index === line.chosen || undefined}>
              {slot}
            </span>
          ))}
        </div>
      );
    case "redacted":
      return (
        <>
          <p>
            {line.before}
            <s>{line.struck}</s>
          </p>
          <small>{line.note}</small>
        </>
      );
    case "blocked":
      return (
        <>
          <p className="landing-replay-hatch">
            Mensaje retenido por el moderador
          </p>
          <small>{line.note}</small>
        </>
      );
    case "receipt":
      return (
        <>
          <strong>{line.title}</strong>
          <p>{line.detail}</p>
        </>
      );
  }
}
