import type { CSSProperties } from "react";

export function revealAt(index: number) {
  return { "data-reveal": "", style: { "--reveal-i": index } as CSSProperties };
}

export function RevealWords({
  text,
  from = 0,
}: {
  text: string;
  from?: number;
}) {
  return text.split(" ").map((word, index) => (
    <span key={word} className="landing-word" {...revealAt(from + index)}>
      {index > 0 && " "}
      {word}
    </span>
  ));
}
