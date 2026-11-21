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
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
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
import {
  ArrowDownIcon,
  ArrowLeftRightIcon,
  BanIcon,
  BotIcon,
  CheckIcon,
  PanelRightIcon,
  SendHorizontalIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UiResponse, UiSpec } from "@/shared/genui";
import { MAX_TEXT_LENGTH } from "@/shared/messages";
import type { SessionContract, SessionStatus } from "@/shared/session";
import { VerifiedBadge } from "../verified-badge";
import { MODERATOR_MODEL, type RoomFixture } from "./demo-session";
import type { GenUiAnswer } from "./genui-block";
import { MessageItem } from "./message-item";
import { ReasonList } from "./moderation";
import {
  auditMetrics,
  countViolations,
  dataFieldLabel,
  formatLatency,
  formatLongDay,
  formatScore,
  formatTime,
  initials,
  intentLabel,
  REASON_LABELS,
  type RoomMessage,
  type RoomParticipant,
  SESSION_STATUS_LABELS,
  sessionEnd,
  type Viewer,
  violationTone,
} from "./room-format";
import { useDemoRoom } from "./use-demo-room";

const BLOCK_TONE = {
  neutral: "bg-muted text-subtle-foreground",
  warning: "bg-warning/15 text-foreground",
  danger: "bg-destructive-soft text-destructive-text",
} as const;

const ROLE_LABELS: Record<Viewer["role"], string> = {
  owner: "Dueño",
  observer: "Observador",
  operator: "Operador",
};

export function DemoRoom({
  fixture,
  instant = false,
}: {
  fixture: RoomFixture;
  instant?: boolean;
}) {
  const room = useDemoRoom(fixture.script, instant);
  const [role, setRole] = useState<Viewer["role"]>("owner");
  return (
    <RoomView
      participants={fixture.participants}
      viewer={{ ...fixture.viewer, role }}
      contract={fixture.contract}
      status={sessionEnd(room.messages)?.status ?? "active"}
      messages={room.messages}
      answers={room.answers}
      typingName={
        fixture.participants.find((p) => p.participantId === room.typing)?.name
      }
      onRespond={room.respond}
      onSendText={room.sendText}
      onRestart={room.reset}
      onReview={room.review}
      toolbar={
        <DemoToolbar role={role} onRole={setRole} onReset={room.reset} />
      }
    />
  );
}

export function RoomView({
  participants: people,
  viewer,
  contract,
  status,
  messages,
  answers,
  violationCount,
  typingName,
  onRespond,
  onSendText,
  onCloseRoom,
  onRestart,
  onReview,
  toolbar,
  error,
  sessions,
  sending = false,
  answersReadOnly = false,
}: {
  participants: RoomParticipant[];
  viewer: Viewer;
  contract: SessionContract | null;
  status: SessionStatus;
  messages: RoomMessage[];
  answers: Record<string, GenUiAnswer>;
  violationCount?: number;
  typingName?: string;
  sessions?: { sessionId: string; name: string; intent: string }[];
  onRespond: (response: UiResponse, inReplyTo: string) => void;
  onSendText: (text: string) => void | Promise<boolean | void>;
  onCloseRoom?: () => void;
  onRestart?: () => void;
  onReview?: (messageId: string, approve: boolean) => void;
  toolbar?: ReactNode;
  error?: string;
  sending?: boolean;
  answersReadOnly?: boolean;
}) {
  const role = viewer.role;
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [control, setControl] = useState(false);
  const [auditFor, setAuditFor] = useState<string | null>(null);
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

  const blocked = violationCount ?? countViolations(messages);
  const readOnly = status !== "active";
  const canControl = role !== "observer";

  function jumpTo(messageId: string) {
    setSheetOpen(false);
    document
      .getElementById(`msg-${messageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(messageId);
    window.setTimeout(() => setHighlighted(null), 1600);
  }

  const auditMessage = messages.find((m) => m.messageId === auditFor);

  const sidePanel = contract ? (
    <SidePanel
      contract={contract}
      blocked={blocked}
      messages={messages}
      participants={people}
      role={role}
      onJump={jumpTo}
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <SessionList
          self={self}
          other={other}
          intent={contract?.intent.name ?? ""}
          lastAt={messages.at(-1)?.sentAt}
          status={status}
          sessions={sessions}
        />
        <main className="flex min-w-0 flex-1 flex-col border-x border-border">
          {contract ? (
            <SessionHeader
              self={self}
              other={other}
              panelOpen={panelOpen}
              onTogglePanel={() => {
                if (window.matchMedia("(min-width: 64rem)").matches)
                  setPanelOpen((o) => !o);
                else setSheetOpen(true);
              }}
            />
          ) : (
            <p className="px-4">
              Contrato no disponible · {SESSION_STATUS_LABELS[status]}
            </p>
          )}
          {onCloseRoom ? (
            <Button
              className="self-end"
              disabled={readOnly}
              onClick={onCloseRoom}
            >
              Cerrar sala
            </Button>
          ) : null}
          <Thread messages={messages} typingName={typingName} blocked={blocked}>
            {messages.map((message, i) => {
              const prev = messages[i - 1];
              const day = formatLongDay(message.sentAt);
              const newDay = !prev || formatLongDay(prev.sentAt) !== day;
              return (
                <Fragment key={message.messageId}>
                  {newDay ? <DayDivider label={day} /> : null}
                  <MessageItem
                    message={message}
                    continued={
                      !newDay &&
                      message.senderParticipantId !== null &&
                      prev?.senderParticipantId === message.senderParticipantId
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
          {error ? (
            <p role="alert" className="m-0 px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {contract && blocked > 0 && !readOnly ? (
            <BlockNotice blocked={blocked} max={contract.maxViolations} />
          ) : null}
          <Composer
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
        {contract ? (
          <aside
            aria-label="Contrato y auditoría"
            data-open={panelOpen || undefined}
            inert={!panelOpen}
            className="room-panel hidden shrink-0 overflow-hidden lg:block"
          >
            <div className="room-panel-inner flex h-full w-[340px] flex-col overflow-y-auto">
              {sidePanel}
            </div>
          </aside>
        ) : null}
      </div>
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerBackdrop />
        <DrawerContent className="max-h-[85dvh] overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            <DrawerTitle className="font-medium text-sm">
              Contrato y auditoría
            </DrawerTitle>
            <DrawerClose data-size="sm">Cerrar</DrawerClose>
          </div>
          {sidePanel}
        </DrawerContent>
      </Drawer>
      <Dialog
        open={auditFor !== null}
        onOpenChange={(open) => {
          if (!open) setAuditFor(null);
        }}
      >
        <DialogBackdrop className="room-dialog-backdrop" />
        <DialogContent className="room-dialog max-w-md">
          <DialogTitle>Auditoría del mensaje</DialogTitle>
          <DialogDescription>
            {auditMessage
              ? `${participants.get(auditMessage.senderParticipantId ?? "")?.name ?? "Sistema"} · ${formatTime(auditMessage.sentAt)} · ${auditMessage.audit?.model ?? MODERATOR_MODEL} · ${auditMessage.audit ? formatLatency(auditMessage.audit.latencyMs) : "—"}`
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-primary px-4 py-1.5 text-xs text-primary-foreground">
      <span className="font-semibold">Demo</span>
      <span className="hidden opacity-80 sm:inline">
        Sin backend: datos del seed y una conversación guionada
      </span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Select
          value={role}
          onValueChange={(value) => {
            if (value) onRole(value as Viewer["role"]);
          }}
        >
          <SelectLabel className="sr-only">Ver como</SelectLabel>
          <SelectTrigger className="!h-7 !border-transparent !text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">Ver como dueño</SelectItem>
            <SelectItem value="observer">Ver como observador</SelectItem>
          </SelectContent>
        </Select>
        <Button
          data-size="sm"
          className="!h-7 !border-transparent"
          onClick={onReset}
        >
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
  const letters = initials(participant?.name ?? "");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full text-micro font-semibold ring-2 ring-background ${
        participant?.side === "self"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground"
      }`}
    >
      {participant?.kind === "human" ? (
        <UserIcon size={14} />
      ) : (
        letters || <BotIcon size={14} />
      )}
    </span>
  );
}

function SessionList({
  self,
  other,
  intent,
  lastAt,
  status,
  sessions,
}: {
  self?: RoomParticipant;
  other?: RoomParticipant;
  intent: string;
  lastAt?: number;
  status: SessionStatus;
  sessions?: { sessionId: string; name: string; intent: string }[];
}) {
  return (
    <nav
      aria-label="Salas"
      className="hidden w-[260px] shrink-0 flex-col gap-1 py-4 xl:flex"
    >
      <h2 className="m-0 px-6 pb-2 text-sm font-semibold">Salas</h2>
      {sessions?.map((session) => (
        <a
          key={session.sessionId}
          href={`/room/${session.sessionId}`}
          className="px-6 py-2"
        >
          {session.name} · {intentLabel(session.intent)}
        </a>
      ))}
      <a
        href="#thread"
        aria-current="page"
        className="relative flex items-start gap-3 bg-muted px-6 py-3 !text-foreground !no-underline before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-foreground"
      >
        <span className="flex -space-x-2">
          <Avatar participant={self} size={28} />
          <Avatar participant={other} size={28} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{other?.name}</span>
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
      <p className="m-0 mt-2 px-6 text-xs text-pretty text-subtle-foreground">
        Las salas que abra tu agente aparecen aquí.
      </p>
    </nav>
  );
}

function SessionHeader({
  self,
  other,
  panelOpen,
  onTogglePanel,
}: {
  self?: RoomParticipant;
  other?: RoomParticipant;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        <span className="hidden shrink-0 -space-x-2.5 sm:flex">
          <Avatar participant={self} size={36} />
          <Avatar participant={other} size={36} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 flex min-w-0 items-center gap-1 text-lg leading-tight font-semibold tracking-tight">
            <span className="truncate" title={other?.name}>
              {other?.name}
            </span>
            {other?.verified && <VerifiedBadge />}
          </h1>
          <p className="m-0 flex items-center gap-1.5 text-xs text-subtle-foreground">
            <ShieldCheckIcon size={13} className="shrink-0" />
            Moderada: cada mensaje se revisa antes de entregarse
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Button
          data-size="sm"
          data-variant="ghost"
          aria-label="Contrato y auditoría"
          aria-expanded={panelOpen}
          className="hidden lg:inline-flex"
          onClick={onTogglePanel}
        >
          <PanelRightIcon size={16} />
        </Button>
        <Button
          data-size="sm"
          data-variant="ghost"
          aria-label="Contrato y auditoría"
          aria-haspopup="dialog"
          className="lg:hidden"
          onClick={onTogglePanel}
        >
          <PanelRightIcon size={16} />
        </Button>
      </div>
    </header>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <p className="m-0 flex w-full items-center gap-3 text-xs font-medium text-subtle-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      {label}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </p>
  );
}

function Thread({
  blocked,
  messages,
  typingName,
  children,
}: {
  blocked: number;
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
        className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 && !typingName ? (
          <p className="m-auto text-center text-sm text-subtle-foreground">
            Esperando el primer mensaje de los agentes…
          </p>
        ) : null}
        <section
          ref={content}
          aria-label="Mensajes de la sala"
          aria-live="polite"
          aria-relevant="additions"
          className="mx-auto flex w-full max-w-3xl flex-col gap-6"
        >
          {children}
        </section>
        <p className="m-0 mx-auto h-5 w-full max-w-3xl shrink-0 text-xs text-subtle-foreground">
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
  sending,
  closedLabel,
  control,
  canControl,
  selfName,
  onTakeControl,
  onReturnControl,
  onSend,
  onRestart,
}: {
  readOnly: boolean;
  sending?: boolean;
  closedLabel?: string;
  control: boolean;
  canControl: boolean;
  selfName: string;
  onTakeControl: () => void;
  onReturnControl: () => void;
  onSend: (text: string) => void | Promise<boolean | void>;
  onRestart?: () => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (control) input.current?.focus();
  }, [control]);

  if (readOnly) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted px-4 py-3 text-sm">
        <span className="flex-1">{closedLabel ?? "Sala cerrada"}</span>
        {onRestart ? (
          <Button data-size="sm" onClick={onRestart}>
            Abrir nueva sala
          </Button>
        ) : null}
      </div>
    );
  }

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    const accepted = await onSend(value);
    if (accepted !== false) setText("");
  };

  return (
    <div className="flex flex-col border-t border-border">
      {control ? (
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
      ) : null}
      <form
        className="flex flex-col gap-1 px-4 pt-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={input}
            disabled={!control || sending}
            aria-label="Mensaje"
            value={text}
            onValueChange={setText}
            maxLength={MAX_TEXT_LENGTH}
            autoResize
            onSubmit={send}
            rows={1}
            placeholder={
              control
                ? "Escribe un mensaje"
                : canControl
                  ? "Toma el control para escribir"
                  : "Solo el dueño o un operador puede escribir"
            }
            className="room-composer-input min-w-0 flex-1"
          />
          {canControl ? (
            <Button
              type={control ? "submit" : "button"}
              data-variant="solid"
              data-size="xl"
              data-control={control ? "" : undefined}
              aria-label={control ? "Enviar" : undefined}
              disabled={control && (sending || !text.trim())}
              onClick={control ? undefined : onTakeControl}
              className="room-composer-action"
            >
              <span className="room-composer-label">Tomar control</span>
              <SendHorizontalIcon
                size={16}
                aria-hidden="true"
                className="room-composer-icon"
              />
            </Button>
          ) : null}
        </div>
        {control ? (
          <div className="mx-auto flex w-full max-w-3xl justify-between text-micro text-subtle-foreground">
            <span>Tus mensajes también pasan por el moderador</span>
            <span className="tabular-nums">
              {text.length} / {MAX_TEXT_LENGTH}
            </span>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function BlockNotice({ blocked, max }: { blocked: number; max: number }) {
  return (
    <div className="px-4 pt-2">
      <p
        role="status"
        className={`m-0 mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl px-3 py-2 text-xs ${BLOCK_TONE[violationTone(blocked, max)]}`}
      >
        <ShieldAlertIcon size={14} className="shrink-0" />
        <span>
          {blocked} de {max}{" "}
          {max === 1 ? "mensaje bloqueado" : "mensajes bloqueados"}. La sala se
          cierra al llegar a {max}.
        </span>
      </p>
    </div>
  );
}

function SidePanel({
  blocked,
  contract,
  messages,
  participants,
  role,
  onJump,
}: {
  blocked: number;
  contract: SessionContract;
  messages: RoomMessage[];
  participants: RoomParticipant[];
  role: Viewer["role"];
  onJump: (messageId: string) => void;
}) {
  return (
    <Tabs defaultValue="participantes" className="flex flex-col gap-3 p-4">
      <TabsList aria-label="Detalles de la sala">
        <TabsTab value="participantes">Participantes</TabsTab>
        <TabsTab value="contrato">Contrato</TabsTab>
        <TabsTab value="auditoria">Auditoría</TabsTab>
      </TabsList>
      <TabsPanel value="participantes">
        <ParticipantsView participants={participants} role={role} />
      </TabsPanel>
      <TabsPanel value="contrato">
        <ContractView
          contract={contract}
          providerName={
            participants.find((p) => p.kind === "agent" && p.side === "other")
              ?.name ?? "El proveedor"
          }
        />
      </TabsPanel>
      <TabsPanel value="auditoria">
        <AuditView
          blocked={blocked}
          messages={messages}
          maxBlocked={contract.maxViolations}
          onJump={onJump}
        />
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
    <section className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="m-0 text-xs font-medium text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

const andList = new Intl.ListFormat("es", { type: "conjunction" });
const orList = new Intl.ListFormat("es", { type: "disjunction" });
const lower = (label: string) =>
  label === label.toUpperCase() ? label : label.toLowerCase();

function ContractView({
  contract,
  providerName,
}: {
  contract: SessionContract;
  providerName: string;
}) {
  const shares = contract.recipientShares.map((f) => lower(dataFieldLabel(f)));
  const requests = contract.recipientRequests.map((f) =>
    lower(dataFieldLabel(f)),
  );
  const lines = [
    contract.allowedIntents.length > 0 && {
      icon: CheckIcon,
      tone: "text-success",
      text: (
        <>
          Tu agente puede{" "}
          <strong>
            {andList.format(
              contract.allowedIntents.map((i) => lower(intentLabel(i))),
            )}
          </strong>
          .
        </>
      ),
    },
    (shares.length > 0 || requests.length > 0) && {
      icon: ArrowLeftRightIcon,
      tone: "text-subtle-foreground",
      text: (
        <>
          {providerName}
          {shares.length > 0 ? (
            <>
              {" "}
              comparte <strong>{andList.format(shares)}</strong>
            </>
          ) : null}
          {shares.length > 0 && requests.length > 0 ? ", y" : null}
          {requests.length > 0 ? (
            <>
              {" "}
              puede pedirte <strong>{andList.format(requests)}</strong>
            </>
          ) : null}
          .
        </>
      ),
    },
    contract.forbiddenTopics.length > 0 && {
      icon: BanIcon,
      tone: "text-destructive",
      text: (
        <>
          Nunca se habla de{" "}
          <strong>{orList.format(contract.forbiddenTopics)}</strong>.
        </>
      ),
    },
    {
      icon: ShieldIcon,
      tone: "text-subtle-foreground",
      text: (
        <>
          Si se bloquean <strong>{contract.maxViolations} mensajes</strong>, la
          sala se cierra.
        </>
      ),
    },
  ].filter((line) => line !== false);
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-subtle-foreground">Objetivo</span>
        <p className="m-0 text-lg leading-tight font-semibold">
          {intentLabel(contract.intent.name)}
        </p>
        <p className="m-0 break-words text-subtle-foreground">
          “{contract.intent.description}”
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0 leading-relaxed">
        {lines.map(({ icon: Icon, tone, text }) => (
          <li key={Icon.displayName} className="flex gap-3">
            <Icon
              aria-hidden="true"
              className={`mt-[3px] size-4 shrink-0 ${tone}`}
            />
            <span className="min-w-0 break-words [&_strong]:font-medium">
              {text}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-subtle-foreground">
        Lo calculamos al abrir la sala, cruzando tu pedido con lo que ofrece{" "}
        {providerName}.
      </p>
    </div>
  );
}

function AuditView({
  blocked,
  messages,
  maxBlocked,
  onJump,
}: {
  blocked: number;
  messages: RoomMessage[];
  maxBlocked: number;
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
      <dl className="m-0 grid grid-cols-2 gap-y-1 border-y border-border py-1">
        {[
          ["Revisados", metrics.reviewed],
          ["Intervenciones", metrics.interventions],
          ["Bloqueos", `${blocked}/${maxBlocked}`],
          [
            "Latencia media",
            metrics.averageLatencyMs === null
              ? "—"
              : formatLatency(metrics.averageLatencyMs),
          ],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col py-1.5">
            <dt className="text-micro text-subtle-foreground">{label}</dt>
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
                  {m.audit ? formatLatency(m.audit.latencyMs) : "—"}
                </span>
              </span>
              {m.reasons?.length ? (
                <span className="font-mono text-subtle-foreground">
                  {m.reasons
                    .map(
                      (r) =>
                        `${r.code}${r.score !== undefined ? ` ${formatScore(r.score)}` : ""}`,
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
