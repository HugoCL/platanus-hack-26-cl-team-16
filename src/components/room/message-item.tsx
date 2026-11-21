"use client";

import { Button } from "@ui-sdk/react/button";
import {
  BanIcon,
  LockIcon,
  ReplyIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { UiResponse, UiSpec } from "@/shared/genui";
import { type GenUiAnswer, GenUiBlock } from "./genui-block";
import { ModerationBadge, PendingStages } from "./moderation";
import {
  canSeeContent,
  describeUiResponse,
  formatTime,
  primaryReason,
  REASON_LABELS,
  type RoomMessage,
  type RoomParticipant,
  splitRedacted,
  type Viewer,
} from "./room-format";

type MessageItemProps = {
  message: RoomMessage;
  sender?: RoomParticipant;
  viewer: Viewer;
  answers: Record<string, GenUiAnswer>;
  // UI specs by the id of the message that carried them; `ui_response.inReplyTo` points there.
  uiSpecsByMessage: Record<string, UiSpec>;
  highlighted?: boolean;
  readOnly?: boolean;
  onRespond: (response: UiResponse) => void;
  onShowAudit: (messageId: string) => void;
  onReview?: (messageId: string, approve: boolean) => void;
};

export function MessageItem(props: MessageItemProps) {
  const { message } = props;
  if (message.content.kind === "system") {
    return (
      <SystemNotice
        id={message.messageId}
        code={message.content.code}
        text={message.content.text}
      />
    );
  }
  return <Bubble {...props} />;
}

function Bubble({
  message,
  sender,
  viewer,
  answers,
  uiSpecsByMessage,
  highlighted,
  onRespond,
  onShowAudit,
  onReview,
  readOnly,
}: MessageItemProps) {
  const self = sender?.side === "self";
  const { content, status } = message;
  const isUi = content.kind === "ui";
  const visible = canSeeContent(status, message.senderParticipantId, viewer);
  const reason = primaryReason(message.reasons);
  const canAct =
    !readOnly && (viewer.role === "owner" || viewer.role === "operator");

  const frame =
    status === "blocked"
      ? "border-2 border-destructive"
      : status === "escalated"
        ? "border-2 border-warning"
        : "";

  let body: ReactNode;
  if (status === "pending" && !visible) {
    body = (
      <p className="m-0 text-subtle-foreground">
        El moderador está revisando este mensaje
      </p>
    );
  } else if (!visible || (status === "blocked" && content.kind !== "ui")) {
    body = (
      <BlockedBody
        reasonLabel={reason ? REASON_LABELS[reason.code] : undefined}
        score={reason?.score}
        moderatorError={reason?.code === "moderator_error"}
        senderSees={visible}
        text={visible && content.kind === "text" ? content.text : undefined}
        onShowAudit={() => onShowAudit(message.messageId)}
      />
    );
  } else if (content.kind === "text") {
    body =
      status === "redacted" && message.redactedText ? (
        <RedactedText text={message.redactedText} />
      ) : (
        <p className="m-0 whitespace-pre-wrap break-words">{content.text}</p>
      );
  } else if (content.kind === "ui") {
    body = (
      <GenUiBlock
        spec={content.spec}
        answer={answers[content.spec.id]}
        canInteract={canAct && status !== "pending"}
        onRespond={onRespond}
      />
    );
  } else if (content.kind === "ui_response") {
    const target = uiSpecsByMessage[content.inReplyTo];
    body = (
      <a
        href={`#msg-${content.inReplyTo}`}
        className="inline-flex items-center gap-1.5 text-inherit !no-underline"
      >
        <ReplyIcon size={14} className="shrink-0 opacity-70" />
        {describeUiResponse(content.response, target)}
      </a>
    );
  } else {
    body = (
      <p className="m-0 inline-flex items-center gap-1.5 text-subtle-foreground">
        <LockIcon size={14} />
        Mensaje cifrado
      </p>
    );
  }

  const compact = content.kind === "ui_response";

  return (
    <article
      id={`msg-${message.messageId}`}
      data-testid="room-message"
      data-status={status}
      aria-label={`${sender?.name ?? "Desconocido"}, ${formatTime(message.sentAt)}`}
      className={`flex scroll-mt-24 flex-col gap-1 ${self ? "items-end" : "items-start"} ${highlighted ? "room-highlight" : ""}`}
    >
      <header
        className={`flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-subtle-foreground ${self ? "flex-row-reverse" : ""}`}
      >
        <SenderName sender={sender} />
        <time dateTime={new Date(message.sentAt).toISOString()}>
          {formatTime(message.sentAt)}
        </time>
        <ModerationBadge status={status} reasons={message.reasons} />
      </header>
      <div
        className={`room-bubble flex max-w-[min(560px,92%)] flex-col gap-2 ${
          isUi && visible && status !== "blocked"
            ? ""
            : `rounded-3xl px-4 py-2.5 ${compact ? "text-sm" : ""} ${
                self
                  ? "bg-primary text-primary-foreground"
                  : "bg-card shadow-card"
              } ${frame}`
        } ${status === "pending" ? "room-pending" : ""}`}
      >
        {body}
      </div>
      {status === "pending" ? <PendingStages /> : null}
      {status === "redacted" && reason ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs">
          Se ocultó: {REASON_LABELS[reason.code]}
          {reason.detail ? ` · ${reason.detail}` : ""}
        </span>
      ) : null}
      {status === "escalated" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {reason?.detail ? (
            <span className="text-subtle-foreground">{reason.detail}</span>
          ) : null}
          {canAct && onReview ? (
            <>
              <Button
                data-size="sm"
                data-variant="solid"
                onClick={() => onReview(message.messageId, true)}
              >
                Aprobar
              </Button>
              <Button
                data-size="sm"
                onClick={() => onReview(message.messageId, false)}
              >
                Rechazar
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SenderName({ sender }: { sender?: RoomParticipant }) {
  if (!sender) return <span>Desconocido</span>;
  if (sender.kind === "human") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <UserIcon size={13} />
        {sender.name}
        {sender.onBehalfOf ? (
          <span className="font-normal text-subtle-foreground">
            (en nombre de {sender.onBehalfOf})
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      title={sender.name}
      className="max-w-[min(28rem,100%)] min-w-0 truncate font-medium text-foreground"
    >
      {sender.name}
    </span>
  );
}

function RedactedText({ text }: { text: string }) {
  return (
    <p className="m-0 whitespace-pre-wrap break-words">
      {splitRedacted(text).map((part) =>
        part.hidden ? (
          <span
            key={part.at}
            className="rounded-sm bg-current align-middle text-[0.7em] tracking-[-0.1em] select-none"
          >
            <span className="sr-only">[texto oculto por el moderador]</span>
            <span aria-hidden="true">{part.text}</span>
          </span>
        ) : (
          <span key={part.at}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function BlockedBody({
  reasonLabel,
  score,
  moderatorError,
  senderSees,
  text,
  onShowAudit,
}: {
  reasonLabel?: string;
  score?: number;
  moderatorError: boolean;
  senderSees: boolean;
  text?: string;
  onShowAudit: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-foreground">
      <p className="m-0 inline-flex items-center gap-1.5 font-medium text-destructive-text">
        <BanIcon size={15} />
        {moderatorError
          ? "No se pudo verificar, por seguridad no se entregó"
          : "Este mensaje no fue entregado"}
      </p>
      {senderSees && text ? (
        <p className="m-0 text-sm text-subtle-foreground line-through decoration-1">
          {text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {reasonLabel ? (
          <span className="font-mono text-subtle-foreground">
            {reasonLabel}
            {score !== undefined ? ` · ${score.toFixed(2)}` : ""}
          </span>
        ) : null}
        <Button data-size="sm" onClick={onShowAudit}>
          Ver detalle
        </Button>
      </div>
    </div>
  );
}

const SYSTEM_ICONS: Partial<Record<string, ReactNode>> = {
  message_blocked: <BanIcon size={13} />,
  escalation_requested: <TriangleAlertIcon size={13} />,
  session_terminated: <BanIcon size={13} />,
  human_joined: <UserIcon size={13} />,
  human_took_control: <UserIcon size={13} />,
};

export function SystemNotice({
  id,
  code,
  text,
}: {
  id: string;
  code: string;
  text: string;
}) {
  const strong = code === "session_closed" || code === "session_terminated";
  const danger = code === "session_terminated" || code === "message_blocked";
  return (
    <p
      id={`msg-${id}`}
      data-testid="system-notice"
      data-code={code}
      className={`mx-auto my-1 inline-flex max-w-[90%] items-center gap-1.5 self-center rounded-full px-3 py-1 text-center text-xs ${
        strong ? "font-medium" : ""
      } ${
        code === "session_terminated"
          ? "bg-destructive-soft text-destructive-text"
          : strong
            ? "bg-muted text-foreground"
            : danger
              ? "text-destructive-text"
              : "text-subtle-foreground"
      }`}
    >
      {SYSTEM_ICONS[code] ?? <ShieldCheckIcon size={13} />}
      {text}
    </p>
  );
}
