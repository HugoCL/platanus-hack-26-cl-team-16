"use client";

import { useEffect, useRef } from "react";

export function Spotlight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      element.style.setProperty("--x", `${event.clientX - box.left}px`);
      element.style.setProperty("--y", `${event.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <div ref={ref} aria-hidden className="landing-spotlight">
      {children}
    </div>
  );
}
