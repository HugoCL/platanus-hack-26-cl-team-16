"use client";

import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Textarea } from "@ui-sdk/react/textarea";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UiSpec } from "@/shared/genui";
import { MAX_TEXT_LENGTH } from "@/shared/messages";
import type { SessionContract, SessionStatus } from "@/shared/session";
import {
  DEMO_CONTRACT,
  DEMO_PARTICIPANTS,
  DEMO_VIEWER,
  MODERATOR_MODEL,
} from "./demo-session";
import {
  ArrowDownIcon,
  CheckIcon,
  PanelIcon,
  SendIcon,
  ShieldIcon,
  SwapIcon,
  UserIcon,
} from "./icons";
import { MessageItem } from "./message-item";
import { ReasonList } from "./moderation";
import {
  auditMetrics,
  dataFieldLabel,
  formatLongDay,
  formatTime,
  intentLabel,
  REASON_LABELS,
  type RoomMessage,
  type RoomParticipant,
  SESSION_STATUS_LABELS,
  type Viewer,
  violationTone,
} from "./room-format";
import { useDemoRoom } from "./use-demo-room";

const STATUS_CHIP: Record<SessionStatus, string> = {
  requested: "bg-muted text-subtle-foreground",
  active: "bg-success/15 text-foreground",
  closed: "bg-muted text-foreground",
  terminated: "bg-destructive-soft text-destructive-text",
};

const TONE_CHIP = {
  neutral: "bg-muted text-foreground",
  warning: "bg-warning/20 text-foreground",
  danger: "bg-destructive-soft text-destructive-text",
} as const;

const ROLE_LABELS: Record<Viewer["role"], string> = {
  owner: "Dueño",
  observer: "Observador",
  operator: "Operador",
};

export function DemoRoom() {
  const room = useDemoRoom();
  const [role, setRole] = useState<Viewer["role"]>("owner");
  const [panelOpen, setPanelOpen] = useState(true);
  const [control, setControl] = useState(false);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const viewer: Viewer = { ...DEMO_VIEWER, role };
  const participants = useMemo(
    () => new Map(DEMO_PARTICIPANTS.map((p) => [p.participantId, p])),
    [],
  );
  const other = DEMO_PARTICIPANTS.find(
    (p) => p.side === "other" && p.kind === "agent",
  );
  const self = DEMO_PARTICIPANTS.find(
    (p) => p.side === "self" && p.kind === "agent",
  );

  const uiSpecsByMessage = useMemo(() => {
    const map: Record<string, UiSpec> = {};
    for (const m of room.messages)
      if (m.content.kind === "ui") map[m.messageId] = m.content.spec;
    return map;
  }, [room.messages]);

  const status: SessionStatus = room.messages.some(
    (m) => m.content.kind === "system" && m.content.code === "session_closed",
  )
    ? "closed"
    : "active";
  const violations = room.messages.filter(
    (m) => m.status === "blocked" && m.senderParticipantId !== null,
  ).length;
  const readOnly = status !== "active";
  const canControl = role !== "observer";

  function jumpTo(messageId: string) {
    document
      .getElementById(`msg-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(messageId);
    window.setTimeout(() => setHighlighted(null), 1600);
  }

  const auditMessage = room.messages.find((m) => m.messageId === auditFor);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <DemoToolbar role={role} onRole={setRole} onReset={room.reset} />
      <div className="flex min-h-0 flex-1">
        <SessionList
          otherName={other?.name ?? ""}
          intent={DEMO_CONTRACT.intent.name}
          lastAt={room.messages.at(-1)?.sentAt}
          status={status}
        />
        <main className="flex min-w-0 flex-1 flex-col border-x border-border">
          <SessionHeader
            self={self}
            other={other}
            contract={DEMO_CONTRACT}
            status={status}
            violations={violations}
            role={role}
            control={control}
            canControl={canControl && !readOnly}
            panelOpen={panelOpen}
            onTakeControl={() => setControl(true)}
            onTogglePanel={() => setPanelOpen((o) => !o)}
          />
          <p className="m-0 flex items-center gap-1.5 border-b border-border bg-muted px-4 py-1.5 text-xs text-subtle-foreground">
            <ShieldIcon size={13} />
            Moderada · cada mensaje es revisado antes de entregarse
          </p>
          <Thread
            messages={room.messages}
            typingName={
              room.typing ? participants.get(room.typing)?.name : undefined
            }
          >
            {room.messages.map((message) => (
              <MessageItem
                key={message.messageId}
                message={message}
                sender={
                  message.senderParticipantId
                    ? participants.get(message.senderParticipantId)
                    : undefined
                }
                viewer={viewer}
                answers={room.answers}
                uiSpecsByMessage={uiSpecsByMessage}
                highlighted={highlighted === message.messageId}
                onRespond={(response) =>
                  room.respond(response, message.messageId)
                }
                onShowAudit={setAuditFor}
              />
            ))}
          </Thread>
          <Composer
            readOnly={readOnly}
            control={control}
            canControl={canControl}
            selfName={self?.name ?? "tu agente"}
            onTakeControl={() => setControl(true)}
            onReturnControl={() => setControl(false)}
            onSend={room.sendText}
            onRestart={room.reset}
          />
        </main>
        {panelOpen ? (
          <aside
            aria-label="Contrato y auditoría"
            className="hidden w-[340px] shrink-0 flex-col overflow-y-auto lg:flex"
          >
            <SidePanel
              contract={DEMO_CONTRACT}
              otherName={other?.name ?? "el proveedor"}
              messages={room.messages}
              participants={DEMO_PARTICIPANTS}
              role={role}
              onJump={jumpTo}
            />
          </aside>
        ) : null}
      </div>
      <Dialog
        open={auditFor !== null}
        onOpenChange={(open) => {
          if (!open) setAuditFor(null);
        }}
      >
        <DialogBackdrop />
        <DialogContent className="max-w-md">
          <DialogTitle>Auditoría del mensaje</DialogTitle>
          <DialogDescription>
            {auditMessage
              ? `${participants.get(auditMessage.senderParticipantId ?? "")?.name ?? "Sistema"} · ${formatTime(auditMessage.sentAt)} · ${auditMessage.audit?.model ?? MODERATOR_MODEL} · ${auditMessage.audit?.latencyMs ?? "—"} ms`
              : null}
          </DialogDescription>
          {auditMessage?.reasons?.length ? (
            <ReasonList reasons={auditMessage.reasons} />
          ) : null}
          <div className="mt-4 flex justify-end">
            <DialogClose>Cerrar</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DemoToolbar({
  role,
  onRole,
  onReset,
}: {
  role: Viewer["role"];
  onRole: (role: Viewer["role"]) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2 text-xs">
      <span className="font-medium">Demo sin backend</span>
      <span className="text-subtle-foreground">
        Datos del seed · el guion sigue specs/sala-moderada.md §11
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Select
          value={role}
          onValueChange={(value) => {
            if (value) onRole(value as Viewer["role"]);
          }}
        >
          <SelectLabel className="sr-only">Ver como</SelectLabel>
          <SelectTrigger className="!h-8 !text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">Ver como dueño</SelectItem>
            <SelectItem value="observer">Ver como observador</SelectItem>
          </SelectContent>
        </Select>
        <Button data-size="sm" onClick={onReset}>
          Reiniciar demo
        </Button>
      </div>
    </div>
  );
}

function Avatar({
  participant,
  size = 32,
}: {
  participant?: RoomParticipant;
  size?: number;
}) {
  const initials = (participant?.name ?? "?")
    .split(/\s+/)
    .filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-2 ring-background ${
        participant?.side === "self"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground"
      }`}
    >
      {participant?.kind === "human" ? <UserIcon size={14} /> : initials}
    </span>
  );
}

function SessionList({
  otherName,
  intent,
  lastAt,
  status,
}: {
  otherName: string;
  intent: string;
  lastAt?: number;
  status: SessionStatus;
}) {
  return (
    <nav
      aria-label="Sesiones"
      className="hidden w-[280px] shrink-0 flex-col gap-3 p-3 xl:flex"
    >
      <h2 className="m-0 px-2 pt-1 text-sm font-semibold">Sesiones</h2>
      <a
        href="#thread"
        aria-current="page"
        className="flex items-start gap-3 rounded-3xl bg-card p-3 !no-underline shadow-card"
      >
        <span className="flex -space-x-2">
          <Avatar participant={DEMO_PARTICIPANTS[0]} size={28} />
          <Avatar participant={DEMO_PARTICIPANTS[1]} size={28} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{otherName}</span>
          <span className="truncate text-xs text-subtle-foreground">
            {intentLabel(intent)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 text-xs text-subtle-foreground">
          {lastAt ? formatTime(lastAt) : ""}
          <span
            role="img"
            aria-label={SESSION_STATUS_LABELS[status]}
            className={`size-2 rounded-full ${status === "active" ? "bg-success" : "bg-muted-foreground"}`}
          />
        </span>
      </a>
    </nav>
  );
}

function SessionHeader({
  self,
  other,
  contract,
  status,
  violations,
  role,
  control,
  canControl,
  panelOpen,
  onTakeControl,
  onTogglePanel,
}: {
  self?: RoomParticipant;
  other?: RoomParticipant;
  contract: SessionContract;
  status: SessionStatus;
  violations: number;
  role: Viewer["role"];
  control: boolean;
  canControl: boolean;
  panelOpen: boolean;
  onTakeControl: () => void;
  onTogglePanel: () => void;
}) {
  const tone = violationTone(violations, contract.maxViolations);
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="m-0 flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <Avatar participant={self} size={24} />
          {self?.name}
          <SwapIcon size={14} className="text-subtle-foreground" />
          <Avatar participant={other} size={24} />
          {other?.name}
          <span className="inline-flex items-center gap-0.5 text-xs font-normal text-subtle-foreground">
            <CheckIcon size={12} />
            Verificada
          </span>
        </h1>
        <p className="m-0 truncate text-xs text-subtle-foreground">
          <code className="font-mono">{contract.intent.name}</code> · “
          {contract.intent.description}”
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span
          data-testid="session-status"
          className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${STATUS_CHIP[status]}`}
        >
          {SESSION_STATUS_LABELS[status]}
        </span>
        <span
          data-testid="violations"
          className={`inline-flex h-6 items-center rounded-full px-2.5 font-mono text-xs tabular-nums ${TONE_CHIP[tone]}`}
        >
          <span className="sr-only">Violaciones: </span>
          {violations} / {contract.maxViolations}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
          <UserIcon size={13} />
          {ROLE_LABELS[role]}
        </span>
        {canControl && !control ? (
          <Button data-size="sm" data-variant="solid" onClick={onTakeControl}>
            Tomar control
          </Button>
        ) : null}
        <Button
          data-size="sm"
          data-variant="ghost"
          aria-label={panelOpen ? "Ocultar contrato" : "Mostrar contrato"}
          aria-pressed={panelOpen}
          className="hidden lg:inline-flex"
          onClick={onTogglePanel}
        >
          <PanelIcon />
        </Button>
      </div>
    </header>
  );
}

function Thread({
  messages,
  typingName,
  children,
}: {
  messages: RoomMessage[];
  typingName?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const atBottom = useRef(true);
  const seen = useRef(0);
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

  useEffect(() => {
    const added = messages.length - seen.current;
    seen.current = messages.length;
    if (messages.length === 0) setUnread(0);
    else if (added > 0 && !atBottom.current) setUnread((n) => n + added);
  }, [messages.length]);

  const blocked = messages.filter((m) => m.status === "blocked").length;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        id="thread"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (atBottom.current) setUnread(0);
        }}
        className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-6"
      >
        {messages[0] ? (
          <p className="m-0 self-center text-xs font-medium text-subtle-foreground">
            {formatLongDay(messages[0].sentAt)}
          </p>
        ) : null}
        <section
          ref={content}
          aria-label="Mensajes de la sesión"
          aria-live="polite"
          aria-relevant="additions"
          className="flex flex-col gap-4"
        >
          {children}
        </section>
        <p className="m-0 h-5 shrink-0 text-xs text-subtle-foreground">
          {typingName ? (
            <>
              <span className="room-typing" aria-hidden="true" /> {typingName}{" "}
              está escribiendo…
            </>
          ) : null}
        </p>
        <p className="sr-only" aria-live="assertive">
          {blocked > 0
            ? `El moderador bloqueó ${blocked} ${blocked === 1 ? "mensaje" : "mensajes"}.`
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

function Composer({
  readOnly,
  control,
  canControl,
  selfName,
  onTakeControl,
  onReturnControl,
  onSend,
  onRestart,
}: {
  readOnly: boolean;
  control: boolean;
  canControl: boolean;
  selfName: string;
  onTakeControl: () => void;
  onReturnControl: () => void;
  onSend: (text: string) => void;
  onRestart: () => void;
}) {
  const [text, setText] = useState("");

  if (readOnly) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted px-4 py-3 text-sm">
        <span className="flex-1">Sesión cerrada · objetivo cumplido</span>
        <Button data-size="sm" onClick={onRestart}>
          Abrir nueva sesión
        </Button>
      </div>
    );
  }

  if (!control) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <p className="m-0 flex-1 text-sm text-subtle-foreground">
          Tu agente está conversando. Toma el control para escribir
        </p>
        {canControl ? (
          <Button data-variant="solid" onClick={onTakeControl}>
            Tomar control
          </Button>
        ) : null}
      </div>
    );
  }

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="flex flex-col border-t border-border">
      <div className="flex items-center gap-2 bg-primary px-4 py-1.5 text-xs text-primary-foreground">
        <span className="flex-1">Estás hablando como {selfName}</span>
        <Button
          data-size="sm"
          className="!h-6 !bg-transparent !text-primary-foreground !border-primary-foreground/40"
          onClick={onReturnControl}
        >
          Devolver control
        </Button>
      </div>
      <form
        className="flex flex-col gap-1 px-4 pt-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Mensaje"
            value={text}
            onValueChange={setText}
            maxLength={MAX_TEXT_LENGTH}
            autoResize
            onSubmit={send}
            rows={1}
            placeholder="Escribe un mensaje"
            className="flex-1"
          />
          <Button
            type="submit"
            data-variant="solid"
            aria-label="Enviar"
            disabled={!text.trim()}
            className="!w-10 !p-0"
            data-size="lg"
          >
            <SendIcon />
          </Button>
        </div>
        <div className="flex justify-between text-[11px] text-subtle-foreground">
          <span>Tus mensajes también pasan por el moderador</span>
          <span className="tabular-nums">
            {text.length} / {MAX_TEXT_LENGTH}
          </span>
        </div>
      </form>
    </div>
  );
}

function SidePanel({
  contract,
  otherName,
  messages,
  participants,
  role,
  onJump,
}: {
  contract: SessionContract;
  otherName: string;
  messages: RoomMessage[];
  participants: RoomParticipant[];
  role: Viewer["role"];
  onJump: (messageId: string) => void;
}) {
  return (
    <Tabs defaultValue="contrato" className="flex flex-col gap-3 p-4">
      <TabsList aria-label="Detalles de la sesión">
        <TabsTab value="contrato">Contrato</TabsTab>
        <TabsTab value="auditoria">Auditoría</TabsTab>
        <TabsTab value="participantes">Participantes</TabsTab>
      </TabsList>
      <TabsPanel value="contrato">
        <ContractView contract={contract} otherName={otherName} />
      </TabsPanel>
      <TabsPanel value="auditoria">
        <AuditView messages={messages} onJump={onJump} />
      </TabsPanel>
      <TabsPanel value="participantes">
        <ParticipantsView participants={participants} role={role} />
      </TabsPanel>
    </Tabs>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-medium text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Chips({
  items,
  tone,
  mono,
}: {
  items: string[];
  tone: "success" | "danger" | "neutral";
  mono?: boolean;
}) {
  const cls = {
    success: "bg-success/15 text-foreground",
    danger: "bg-destructive-soft text-destructive-text",
    neutral: "bg-muted text-foreground",
  }[tone];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.map((item) => (
        <li
          key={item}
          className={`rounded-full px-2.5 py-0.5 text-xs ${cls} ${mono ? "font-mono" : ""}`}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function ContractView({
  contract,
  otherName,
}: {
  contract: SessionContract;
  otherName: string;
}) {
  const short = otherName.replace(/^Agendamiento\s+/, "la ");
  return (
    <div className="flex flex-col gap-5 text-sm">
      <Section title="Intención">
        <p className="m-0">
          <span className="font-medium">
            {intentLabel(contract.intent.name)}
          </span>{" "}
          <code className="font-mono text-xs">{contract.intent.name}</code>
        </p>
        <p className="m-0 text-subtle-foreground">
          {contract.intent.description}
        </p>
      </Section>
      <Section title="Intenciones permitidas">
        <Chips items={contract.allowedIntents} tone="success" mono />
      </Section>
      <Section title="Temas prohibidos">
        <Chips items={contract.forbiddenTopics} tone="danger" />
      </Section>
      <Section title={`Qué comparte ${short}`}>
        <Chips
          items={contract.recipientShares.map(dataFieldLabel)}
          tone="neutral"
        />
      </Section>
      <Section title={`Qué pide ${short}`}>
        <Chips items={contract.recipientRequests} tone="neutral" mono />
      </Section>
      <Section title="Máximo de violaciones">
        <p className="m-0">
          {contract.maxViolations} antes de terminar la sesión
        </p>
      </Section>
      <p className="m-0 rounded-2xl bg-muted p-3 text-xs text-subtle-foreground">
        Calculado al abrir la sesión cruzando la intención de tu agente con el
        scope del proveedor.
      </p>
    </div>
  );
}

function AuditView({
  messages,
  onJump,
}: {
  messages: RoomMessage[];
  onJump: (messageId: string) => void;
}) {
  const [onlyInterventions, setOnlyInterventions] = useState(false);
  const metrics = auditMetrics(messages);
  const events = messages.filter(
    (m) =>
      m.senderParticipantId !== null &&
      m.status !== "pending" &&
      (!onlyInterventions || m.status !== "allowed"),
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-3 gap-2">
        {[
          ["Revisados", metrics.reviewed],
          ["Intervenciones", metrics.interventions],
          [
            "Latencia media",
            metrics.averageLatencyMs === null
              ? "—"
              : `${metrics.averageLatencyMs} ms`,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col rounded-2xl bg-card p-2.5 shadow-card"
          >
            <dt className="text-[11px] text-subtle-foreground">{label}</dt>
            <dd className="m-0 text-base font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <label data-slot="label" className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={onlyInterventions}
          onCheckedChange={(checked) => setOnlyInterventions(checked === true)}
        >
          <CheckboxIndicator />
        </Checkbox>
        Solo intervenciones
      </label>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {events.map((m) => (
          <li key={m.messageId}>
            <button
              type="button"
              onClick={() => onJump(m.messageId)}
              className={`flex w-full flex-col gap-1 rounded-2xl border bg-card p-3 text-left text-xs ${
                m.status === "blocked"
                  ? "border-destructive"
                  : m.status === "redacted" || m.status === "escalated"
                    ? "border-warning"
                    : "border-border"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {AUDIT_ACTION[m.status]} · {formatTime(m.sentAt)}
                </span>
                <span className="font-mono tabular-nums text-subtle-foreground">
                  {m.audit?.latencyMs ?? "—"} ms
                </span>
              </span>
              {m.reasons?.length ? (
                <span className="font-mono text-subtle-foreground">
                  {m.reasons
                    .map(
                      (r) =>
                        `${r.code}${r.score !== undefined ? ` ${r.score.toFixed(2)}` : ""}`,
                    )
                    .join(" · ")}
                </span>
              ) : (
                <span className="text-subtle-foreground">
                  Filtros → inyección → propósito: sin hallazgos
                </span>
              )}
              <span className="text-muted-foreground">
                {m.audit?.model ?? MODERATOR_MODEL}
                {m.reasons?.[0] ? ` · ${REASON_LABELS[m.reasons[0].code]}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const AUDIT_ACTION: Record<RoomMessage["status"], string> = {
  pending: "Revisando",
  allowed: "Aprobado",
  redacted: "Editado",
  blocked: "Bloqueado",
  escalated: "Escalado",
};

function ParticipantsView({
  participants,
  role,
}: {
  participants: RoomParticipant[];
  role: Viewer["role"];
}) {
  const agents = participants.filter((p) => p.kind === "agent");
  const humans = participants.filter((p) => p.kind === "human");
  return (
    <div className="flex flex-col gap-5 text-sm">
      <Section title="Agentes">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {agents.map((p) => (
            <li key={p.participantId} className="flex items-center gap-2">
              <Avatar participant={p} size={28} />
              <span className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-subtle-foreground">
                  Hospedado
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Humanos">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {humans.map((p) => (
            <li key={p.participantId} className="flex items-center gap-2">
              <Avatar participant={p} size={28} />
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-subtle-foreground">
                {ROLE_LABELS[role]}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {role === "owner" ? (
        <Button data-size="sm" className="self-start" disabled>
          Invitar a un observador
        </Button>
      ) : null}
    </div>
  );
}
