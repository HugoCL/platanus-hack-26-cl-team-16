import type { ReactNode } from "react";
import { dataFieldLabel, intentLabel } from "./room/room-format";

export type LedgerRow = {
  label: string;
  value: ReactNode;
  tone?: "forbidden";
};

/** Key and value rows joined by dot leaders. The one way the app draws a contract. */
export function Ledger({
  rows,
  className = "",
}: {
  rows: LedgerRow[];
  className?: string;
}) {
  return (
    <dl className={`ledger ${className}`}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd
            className={row.tone === "forbidden" ? "text-destructive-text" : ""}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Values read as one list, so each drops its capital. Acronyms (RUT) keep theirs. */
const inList = (label: string) =>
  /^\p{Lu}\p{Ll}/u.test(label)
    ? label[0].toLowerCase() + label.slice(1)
    : label;

const join = (items: string[]) => items.map(inList).join(" · ");

/** The scope rows every contract shares. Callers put their own rows before or after. */
export function scopeRows({
  intents,
  requests,
  shares,
  forbidden,
  requestsLabel = "Te va a pedir",
}: {
  intents?: string[];
  requests: string[];
  shares: string[];
  forbidden: string[];
  requestsLabel?: string;
}): LedgerRow[] {
  return [
    ...(intents?.length
      ? [{ label: "Puede", value: join(intents.map(intentLabel)) }]
      : []),
    {
      label: requestsLabel,
      value: requests.length
        ? join(requests.map(dataFieldLabel))
        : "No pide datos",
    },
    {
      label: "Comparte",
      value: shares.length
        ? join(shares.map(dataFieldLabel))
        : "No comparte datos",
    },
    ...(forbidden.length
      ? [
          {
            label: "Nunca habla de",
            value: join(forbidden),
            tone: "forbidden" as const,
          },
        ]
      : []),
  ];
}
