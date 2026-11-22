"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { ArrowDownIcon, CalendarIcon, RotateCcwIcon } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UiResponse, UiSpec } from "@/shared/genui";
import type { SessionContract, SessionStatus } from "@/shared/session";
import { DEMO_SESSION_ID, type RoomFixture } from "./demo-session";
import type { GenUiAnswer } from "./genui-block";
import { MessageItem } from "./message-item";
import {
  createShieldController,
  ModeratorPanel,
  ShieldProvider,
} from "./moderation";
import { MessageAuditDialog, RoomAuditDialog } from "./room-audit";
import { RoomComposer } from "./room-composer";
import {
  countAgentTurns,
  countViolations,
  formatLongDay,
  isIntervention,
  openingNotice,
  type RoomMessage,
  type RoomParticipant,
  SESSION_STATUS_LABELS,
  sessionEnd,
  type Viewer,
  violationOrdinals,
} from "./room-format";
import { RoomHeader } from "./room-header";
import { type RoomListItem, RoomSidebar } from "./room-sidebar";
import { useDemoRoom } from "./use-demo-room";

const DEMO_CLOSE_MS = 700;

export function DemoRoom({
  fixture,
  instant = false,
}: {
  fixture: RoomFixture;
  instant?: boolean;
}) {
  const room = useDemoRoom(fixture.script, instant);
  const [role, setRole] = useState<Viewer["role"]>("owner");
  // Closing the demo room cuts the thread where it was and adds the closing notice. It keeps
  // the message count, not a copy, so a verdict still pending at that moment can arrive.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const count = useRef(0);
  const closing = useRef<{ timer: number; done: () => void } | null>(null);
  useEffect(() => {
    count.current = room.messages.length;
  }, [room.messages.length]);
  const closed = closedAt !== null;
  const kept = closed ? room.messages.slice(0, closedAt) : room.messages;
  const messages: RoomMessage[] = closed
    ? [
        ...kept,
        {
          messageId: "demo-closed",
          sessionId: DEMO_SESSION_ID,
          senderParticipantId: null,
          recipient: "all",
          sentAt: (kept.at(-1)?.sentAt ?? 0) + 60_000,
          content: {
            kind: "system",
            code: "session_closed",
            text: "Sala cerrada por su dueño",
          },
          status: "allowed",
          verdict: { decision: "allow", reason: "Aviso de la plataforma" },
        },
      ]
    : kept;
  const cancelClosing = () => {
    if (!closing.current) return;
    window.clearTimeout(closing.current.timer);
    closing.current.done();
    closing.current = null;
  };
  useEffect(
    () => () => {
      if (closing.current) window.clearTimeout(closing.current.timer);
    },
    [],
  );
  const reset = () => {
    cancelClosing();
    setClosedAt(null);
    room.reset();
  };
  return (
    <RoomView
      sessionId={DEMO_SESSION_ID}
      participants={fixture.participants}
      viewer={{ ...fixture.viewer, role }}
      contract={fixture.contract}
      status={sessionEnd(messages)?.status ?? "active"}
      messages={messages}
      answers={room.answers}
      typing={
        closed
          ? undefined
          : fixture.participants.find((p) => p.participantId === room.typing)
      }
      onRespond={room.respond}
      onSendText={room.sendText}
      onRestart={reset}
      onReview={room.review}
      onCloseRoom={() =>
        new Promise<void>((resolve) => {
          cancelClosing();
          const timer = window.setTimeout(() => {
            closing.current = null;
            setClosedAt(count.current);
            resolve();
          }, DEMO_CLOSE_MS);
          closing.current = { timer, done: resolve };
        })
      }
      demoControls={
        <DemoControls role={role} onRole={setRole} onReset={reset} />
      }
    />
  );
}

export function RoomView({
  sessionId,
  participants: people,
  viewer,
  contract,
  status,
  messages,
  answers,
  violationCount,
  turnCount,
  typing,
  onRespond,
  onSendText,
  onCloseRoom,
  onRestart,
  onReview,
  demoControls,
  headerActions,
  error,
  sessions,
  sending = false,
  answersReadOnly = false,
}: {
  sessionId?: string;
  participants: RoomParticipant[];
  viewer: Viewer;
  contract: SessionContract | null;
  status: SessionStatus;
  messages: RoomMessage[];
  answers: Record<string, GenUiAnswer>;
  violationCount?: number;
  // Agent turns so far. The live room has the server's count; the demo counts its own messages.
  turnCount?: number;
  typing?: RoomParticipant;
  sessions?: RoomListItem[];
  onRespond: (response: UiResponse, inReplyTo: string) => void;
  onSendText: (text: string) => void | Promise<boolean | void>;
  onCloseRoom?: () => unknown;
  onRestart?: () => void;
  onReview?: (messageId: string, approve: boolean) => void;
  demoControls?: ReactNode;
  headerActions?: ReactNode;
  error?: string;
  sending?: boolean;
  answersReadOnly?: boolean;
}) {
  const role = viewer.role;
  const [shields] = useState(createShieldController);
  const [control, setControl] = useState(false);
  const [onlyInterventions, setOnlyInterventions] = useState(false);
  const [roomAuditOpen, setRoomAuditOpen] = useState(false);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [jump, setJump] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const participants = useMemo(
    () => new Map(people.map((p) => [p.participantId, p])),
    [people],
  );
  const other = people.find((p) => p.side === "other" && p.kind === "agent");
  const self = people.find((p) => p.side === "self" && p.kind === "agent");

  const uiSpecsByMessage = useMemo(() => {
    const map: Record<string, UiSpec> = {};
    for (const m of messages)
      if (m.content.kind === "ui") map[m.messageId] = m.content.spec;
    return map;
  }, [messages]);
  const ordinals = useMemo(() => violationOrdinals(messages), [messages]);

  const faults = violationCount ?? countViolations(messages);
  const turns = turnCount ?? countAgentTurns(messages, people);
  const readOnly = status !== "active";
  const canControl = role !== "observer";
  const currentId = sessionId ?? "current";

  const shown = onlyInterventions
    ? messages.filter(
        (m) => m.senderParticipantId === null || isIntervention(m),
      )
    : messages;
  const interventions = messages.filter(isIntervention).length;

  const rooms: RoomListItem[] = useMemo(() => {
    const current: RoomListItem = {
      sessionId: currentId,
      name: other?.name ?? "Sala",
      intent: contract?.intent.name ?? "",
      status,
      lastAt: messages.at(-1)?.sentAt,
    };
    if (!sessions?.some((s) => s.sessionId === currentId))
      return [current, ...(sessions ?? [])];
    return sessions.map((s) =>
      s.sessionId === currentId ? { ...current, ...s, status } : s,
    );
  }, [sessions, currentId, other?.name, contract, status, messages]);

  // The room audit lists messages the filter may hide: show everything, then scroll to the one asked for.
  function jumpTo(messageId: string) {
    setOnlyInterventions(false);
    setRoomAuditOpen(false);
    setJump(messageId);
  }

  useEffect(() => {
    if (!jump) return;
    document
      .getElementById(`msg-${jump}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(jump);
    setJump(null);
  }, [jump]);

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setHighlighted(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const auditMessage = messages.find((m) => m.messageId === auditFor);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {demoControls ? (
        <div className="border-b border-border px-4 py-2 lg:hidden">
          {demoControls}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <RoomSidebar
          rooms={rooms}
          currentId={currentId}
          footer={demoControls}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <RoomHeader
            self={self}
            other={other}
            viewer={viewer}
            participants={people}
            contract={contract}
            status={status}
            turns={turns}
            faults={faults}
            onlyInterventions={onlyInterventions}
            onOnlyInterventions={setOnlyInterventions}
            onOpenAudit={() => setRoomAuditOpen(true)}
            onCloseRoom={onCloseRoom}
            actions={headerActions}
          />
          <ShieldProvider value={shields}>
            <Thread
              messages={shown}
              waiting={messages.length === 0 && !typing}
              typing={typing}
              faults={faults}
              maxFaults={contract?.maxViolations}
              filter={
                onlyInterventions ? (
                  <p className="room-filter">
                    <span className="flex-1">
                      Solo intervenciones · {interventions}{" "}
                      {interventions === 1 ? "mensaje" : "mensajes"}
                    </span>
                    <Button
                      data-size="sm"
                      onClick={() => setOnlyInterventions(false)}
                    >
                      Mostrar todo
                    </Button>
                  </p>
                ) : null
              }
            >
              {shown.map((message, i) => {
                const prev = shown[i - 1];
                const day = formatLongDay(message.sentAt);
                const newDay = !prev || formatLongDay(prev.sentAt) !== day;
                // The opening notice carries its own date and names the intent in words.
                const opening =
                  contract &&
                  message.content.kind === "system" &&
                  message.content.code === "session_opened"
                    ? openingNotice(message.sentAt, contract.intent.name)
                    : undefined;
                const ordinal = ordinals.get(message.messageId);
                return (
                  <Fragment key={message.messageId}>
                    {newDay && !opening ? (
                      <p className="room-notice">
                        <CalendarIcon size={13} />
                        <span>{day}</span>
                      </p>
                    ) : null}
                    <MessageItem
                      message={message}
                      noticeText={opening}
                      continued={
                        !newDay &&
                        message.senderParticipantId !== null &&
                        prev?.senderParticipantId ===
                          message.senderParticipantId
                      }
                      sender={
                        message.senderParticipantId
                          ? participants.get(message.senderParticipantId)
                          : undefined
                      }
                      viewer={viewer}
                      answers={answers}
                      readOnly={readOnly || sending || answersReadOnly}
                      uiSpecsByMessage={uiSpecsByMessage}
                      highlighted={highlighted === message.messageId}
                      fault={
                        ordinal && contract
                          ? { ordinal, max: contract.maxViolations }
                          : undefined
                      }
                      onRespond={(response) =>
                        onRespond(response, message.messageId)
                      }
                      onShowAudit={setAuditFor}
                      onReview={onReview}
                    />
                  </Fragment>
                );
              })}
            </Thread>
          </ShieldProvider>
          {error ? (
            <p
              role="alert"
              className="room-col m-0 py-2 text-sm text-destructive-text"
            >
              {error}
            </p>
          ) : null}
          <RoomComposer
            readOnly={readOnly}
            sending={sending}
            closedLabel={
              sessionEnd(messages)?.text ??
              (onRestart ? undefined : SESSION_STATUS_LABELS[status])
            }
            control={control}
            canControl={canControl}
            selfName={self?.name ?? "tu agente"}
            onTakeControl={() => setControl(true)}
            onReturnControl={() => setControl(false)}
            onSend={onSendText}
            onRestart={onRestart}
          />
        </main>
      </div>
      <ModeratorPanel
        controller={shields}
        messages={messages}
        faults={ordinals}
        maxFaults={contract?.maxViolations}
        onShowAudit={setAuditFor}
      />
      <MessageAuditDialog
        message={auditMessage}
        senderName={
          participants.get(auditMessage?.senderParticipantId ?? "")?.name
        }
        onClose={() => setAuditFor(null)}
      />
      <RoomAuditDialog
        open={roomAuditOpen}
        onOpenChange={setRoomAuditOpen}
        title={`${other?.name ?? "Sala"} · ${SESSION_STATUS_LABELS[status]}`}
        contract={contract}
        messages={messages}
        participants={participants}
        turns={turns}
        faults={faults}
        onJump={jumpTo}
      />
    </div>
  );
}

function DemoControls({
  role,
  onRole,
  onReset,
}: {
  role: Viewer["role"];
  onRole: (role: Viewer["role"]) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
      <p className="m-0 text-xs text-muted-foreground">Demo</p>
      <Select
        value={role}
        onValueChange={(value) => {
          if (value) onRole(value as Viewer["role"]);
        }}
      >
        <SelectLabel className="sr-only">Ver como</SelectLabel>
        <SelectTrigger className="h-8 w-auto min-w-0 gap-2 text-xs lg:w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="owner">Ver como dueño</SelectItem>
          <SelectItem value="observer">Ver como observador</SelectItem>
        </SelectContent>
      </Select>
      <Button data-size="sm" onClick={onReset}>
        <RotateCcwIcon size={14} />
        Reiniciar demo
      </Button>
    </div>
  );
}

function Thread({
  faults,
  maxFaults,
  messages,
  waiting,
  typing,
  filter,
  children,
}: {
  faults: number;
  maxFaults?: number;
  // The messages on screen: the unread pill counts what the reader can see arrive.
  messages: RoomMessage[];
  waiting: boolean;
  typing?: RoomParticipant;
  filter?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(new Set<string>());
  const [unread, setUnread] = useState(0);

  // Follow the thread while the reader is at the bottom, including when a pending
  // bubble grows into its final card. Instant jumps keep scroll events honest.
  useEffect(() => {
    const el = ref.current;
    const inner = content.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Count by id: a message that comes back when a filter is lifted is not an arrival.
  useEffect(() => {
    if (messages.length === 0) {
      seen.current.clear();
      setUnread(0);
      return;
    }
    let added = 0;
    for (const { messageId } of messages) {
      if (seen.current.has(messageId)) continue;
      seen.current.add(messageId);
      added += 1;
    }
    if (added > 0 && !atBottom.current) setUnread((n) => n + added);
  }, [messages]);

  return (
    <div className="relative min-h-0 flex-1 border-t border-border">
      <div
        id="thread"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (atBottom.current) setUnread(0);
        }}
        className="flex h-full flex-col overflow-y-auto pb-2"
      >
        {filter ? <div className="room-thread">{filter}</div> : null}
        {waiting ? (
          <p className="m-auto px-4 text-center text-sm text-subtle-foreground">
            Esperando el primer mensaje de los agentes…
          </p>
        ) : null}
        <section
          ref={content}
          aria-label="Mensajes de la sala"
          aria-live="polite"
          aria-relevant="additions"
          className="room-thread"
        >
          {children}
        </section>
        <p
          data-mine={typing?.side === "self" ? "" : undefined}
          className="room-thread room-typing-line"
        >
          {typing ? (
            <span>
              <span className="room-typing" aria-hidden="true" /> {typing.name}{" "}
              está escribiendo…
            </span>
          ) : null}
        </p>
        <p className="sr-only" aria-live="assertive">
          {faults > 0
            ? `El moderador bloqueó ${faults} ${faults === 1 ? "mensaje" : "mensajes"}.${maxFaults ? ` La sala se cierra al llegar a ${maxFaults}.` : ""}`
            : ""}
        </p>
      </div>
      {unread > 0 ? (
        <Button
          data-size="sm"
          data-variant="solid"
          className="!absolute bottom-4 left-1/2 -translate-x-1/2 shadow-card"
          onClick={() => {
            ref.current?.scrollTo({
              top: ref.current.scrollHeight,
              behavior: "smooth",
            });
            setUnread(0);
          }}
        >
          <ArrowDownIcon size={14} />
          {unread} {unread === 1 ? "nuevo" : "nuevos"}
        </Button>
      ) : null}
    </div>
  );
}
