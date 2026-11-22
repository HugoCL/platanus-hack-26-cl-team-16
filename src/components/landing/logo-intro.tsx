"use client";

import { useAnimate } from "motion/react";
import { useEffect } from "react";
import { AGORA_MARK_AGENT, AGORA_MARK_HUMAN } from "@/components/agora-mark";

// Curves and timing from the keynote deck's Logo (hc-monorepo apps/slides/slides/agora).
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
const JOIN = 1.5;
const DELAY = 0.2;
// In mark units (the viewBox is 620 wide): how far each half starts, and how far it presses past the join.
const GAP = 360;
const PRESS = 14;

// The circle (the human) and the rounded square (the agent) start apart, travel toward each
// other, press together and settle; then the wordmark slides in. CSS keeps the parts hidden
// until this runs, and with reduced motion they render settled and nothing animates.
export function LogoIntro() {
  const [scope, animate] = useAnimate<HTMLDivElement>();

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [half, side] of [
      ["human", -1],
      ["agent", 1],
    ] as const) {
      animate(
        `[data-half="${half}"]`,
        { x: [side * GAP, -side * PRESS, 0], opacity: [0, 1, 1] },
        {
          x: {
            duration: JOIN,
            times: [0, 0.74, 1],
            ease: [EASE_IN_OUT, EASE_OUT],
            delay: DELAY,
          },
          opacity: {
            duration: JOIN,
            times: [0, 0.4, 1],
            ease: EASE_OUT,
            delay: DELAY,
          },
        },
      );
    }
    animate(
      "[data-wordmark]",
      { opacity: [0, 1], x: [-16, 0] },
      { duration: 0.7, ease: EASE_OUT, delay: DELAY + JOIN - 0.2 },
    );
  }, [animate]);

  return (
    <div ref={scope} className="landing-logo">
      <svg viewBox="0 0 620 572" fill="currentColor" aria-hidden="true">
        <path data-half="human" fillRule="evenodd" d={AGORA_MARK_HUMAN} />
        <path data-half="agent" fillRule="evenodd" d={AGORA_MARK_AGENT} />
      </svg>
      <span data-wordmark>agora</span>
    </div>
  );
}
