import { type CSSProperties, Fragment } from "react";

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
    <Fragment key={word}>
      {index > 0 && " "}
      <span className="landing-word" {...revealAt(from + index)}>
        {word}
      </span>
    </Fragment>
  ));
}
