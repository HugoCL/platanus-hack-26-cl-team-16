"use client";

import { useEffect, useState } from "react";
import {
  FIXTURE_LABELS,
  FIXTURE_STATES,
  type FixtureState,
} from "./worst-case-fixture";

const PARAM = "data";

export function useFixtureState() {
  const [state, setState] = useState<FixtureState>("demo");
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const value = new URLSearchParams(window.location.search).get(PARAM);
    if (FIXTURE_STATES.includes(value as FixtureState))
      setState(value as FixtureState);
  }, []);
  function select(next: FixtureState) {
    const url = new URL(window.location.href);
    if (next === "demo") url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, next);
    window.history.replaceState(null, "", url);
    setState(next);
  }
  return [state, select] as const;
}

export function FixtureToggle({
  state,
  onChange,
}: {
  state: FixtureState;
  onChange: (state: FixtureState) => void;
}) {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <fieldset
      aria-label="Datos de prueba"
      style={{ fontFamily: "system-ui, sans-serif" }}
      className="fixed top-1 left-1/2 z-50 m-0 flex border-0 -translate-x-1/2 gap-0.5 rounded-full bg-neutral-200 p-0.5 text-[11px] text-neutral-700 shadow"
    >
      {FIXTURE_STATES.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={state === key}
          onClick={() => onChange(key)}
          className={`rounded-full border-0 px-2.5 py-1 ${state === key ? "bg-white text-neutral-900" : "bg-transparent"}`}
        >
          {FIXTURE_LABELS[key]}
        </button>
      ))}
    </fieldset>
  );
}
