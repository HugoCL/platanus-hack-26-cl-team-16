"use client";

import { useEffect, useRef } from "react";

/*
 * Lights the listing wall around the pointer (the mask lives in landing.css) and pauses the
 * wall's scroll while the hero is off screen.
 */
export function Spotlight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let point = { x: 0, y: 0 };
    const move = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = element.getBoundingClientRect();
        element.style.setProperty("--x", `${point.x - box.left}px`);
        element.style.setProperty("--y", `${point.y - box.top}px`);
      });
    };
    const observer = new IntersectionObserver(([entry]) =>
      element.toggleAttribute("data-paused", !entry.isIntersecting),
    );
    observer.observe(element);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden className="landing-spotlight">
      {children}
    </div>
  );
}
