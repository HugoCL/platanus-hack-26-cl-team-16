import type { ReactNode } from "react";
import type { SessionStatus } from "@/shared/session";
import { formatLastActivity, intentLabel } from "./room-format";

export type RoomListItem = {
  sessionId: string;
  name: string;
  intent: string;
  status?: SessionStatus;
  lastAt?: number;
};

/** Colour only as a dot beside the status word. */
const STATUS: Record<SessionStatus, { dot: string; label: string }> = {
  requested: { dot: "bg-warning", label: "esperando" },
  active: { dot: "bg-success", label: "activa" },
  closed: { dot: "bg-muted-foreground", label: "cerrada" },
  terminated: { dot: "bg-destructive", label: "terminada" },
};

/** "Tus salas": the open room carries the highlighter, the mark of the selected thing. */
export function RoomSidebar({
  rooms,
  currentId,
  footer,
}: {
  rooms: RoomListItem[];
  currentId: string;
  footer?: ReactNode;
}) {
  return (
    <nav aria-label="Tus salas" className="room-list">
      <h2 className="m-0 px-5 pt-4 pb-2.5 text-sm font-semibold">Tus salas</h2>
      <ul className="m-0 min-h-0 list-none overflow-y-auto p-0">
        {rooms.map((room) => {
          const current = room.sessionId === currentId;
          const status = room.status ? STATUS[room.status] : null;
          return (
            <li key={room.sessionId}>
              <a
                href={current ? "#thread" : `/room/${room.sessionId}`}
                aria-current={current ? "page" : undefined}
                className="room-list-item"
              >
                <span
                  className={`room-list-line ${current ? "highlight" : ""}`}
                >
                  <b className="truncate font-medium" title={room.name}>
                    {room.name}
                  </b>
                  {room.lastAt ? (
                    <time
                      dateTime={new Date(room.lastAt).toISOString()}
                      className="ml-auto flex-none font-mono text-xs font-medium"
                    >
                      {formatLastActivity(room.lastAt)}
                    </time>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-caption text-subtle-foreground">
                  {status ? (
                    <span
                      aria-hidden="true"
                      className={`room-dot ${status.dot}`}
                    />
                  ) : null}
                  <span className="truncate">
                    {intentLabel(room.intent)}
                    {status ? ` · ${status.label}` : ""}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {rooms.length < 2 ? (
        <p className="m-0 px-5 pt-3 text-xs text-pretty text-subtle-foreground">
          Las salas que abra tu agente aparecen aquí.
        </p>
      ) : null}
      {footer ? <div className="mt-auto px-5 py-4">{footer}</div> : null}
    </nav>
  );
}
