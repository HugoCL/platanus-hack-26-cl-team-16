"use client";

import { useEffect } from "react";

const THRESHOLD = 300;
const DURATION = 800;
const QUIET = 220;
const KEYS: Record<string, 1 | -1> = {
  ArrowDown: 1,
  PageDown: 1,
  " ": 1,
  ArrowUp: -1,
  PageUp: -1,
};

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOut(t: number) {
  return 1 - (1 - t) ** 3;
}

export function SectionScroll() {
  useEffect(() => {
    const query = matchMedia(
      "(min-width: 48rem) and (min-height: 40rem) and (prefers-reduced-motion: no-preference)",
    );
    const root = document.documentElement;
    let accumulated = 0;
    let lastWheel = 0;
    let lastDelta = 0;
    let settling = false;
    let target: number | null = null;
    let frame = 0;

    const nextStop = (from: number, direction: 1 | -1) => {
      const stops = [
        ...document.querySelectorAll<HTMLElement>(
          ".landing > header, .landing-section",
        ),
      ].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const top = Math.round(rect.top + scrollY);
        const bottom = Math.round(rect.bottom + scrollY - innerHeight);
        const positions = [top];
        for (
          let position = top + innerHeight;
          position < bottom;
          position += innerHeight
        ) {
          positions.push(position);
        }
        if (bottom > top) positions.push(bottom);
        return positions;
      });
      stops.push(root.scrollHeight - innerHeight);
      stops.sort((a, b) => a - b);
      return direction > 0
        ? stops.find((stop) => stop > from + 2)
        : stops.findLast((stop) => stop < from - 2);
    };

    const move = (direction: 1 | -1) => {
      const to = nextStop(target ?? scrollY, direction);
      if (to === undefined) return;
      const curve = target === null ? easeInOut : easeOut;
      const start = scrollY;
      const began = performance.now();
      cancelAnimationFrame(frame);
      target = to;
      root.style.scrollSnapType = "none";
      const step = (now: number) => {
        const progress = Math.min((now - began) / DURATION, 1);
        scrollTo(0, start + (to - start) * curve(progress));
        if (progress < 1) {
          frame = requestAnimationFrame(step);
          return;
        }
        root.style.scrollSnapType = "";
        target = null;
      };
      frame = requestAnimationFrame(step);
    };

    const onWheel = (event: WheelEvent) => {
      if (!query.matches || event.ctrlKey) return;
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const quiet = event.timeStamp - lastWheel > QUIET;
      const decaying =
        !quiet &&
        Math.sign(delta) === Math.sign(lastDelta) &&
        Math.abs(delta) < Math.abs(lastDelta);
      lastWheel = event.timeStamp;
      lastDelta = delta;
      if (quiet) {
        accumulated = 0;
        settling = false;
      }
      if (settling && decaying) return;
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;
      if (Math.abs(accumulated) < THRESHOLD) return;
      accumulated = 0;
      settling = true;
      move(delta > 0 ? 1 : -1);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!query.matches || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, button, [contenteditable]",
        )
      ) {
        return;
      }
      const key = KEYS[event.key];
      if (!key) return;
      event.preventDefault();
      move(event.key === " " && event.shiftKey ? -1 : key);
    };

    addEventListener("wheel", onWheel, { passive: false });
    addEventListener("keydown", onKeyDown);
    return () => {
      removeEventListener("wheel", onWheel);
      removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
      root.style.scrollSnapType = "";
    };
  }, []);

  return null;
}
