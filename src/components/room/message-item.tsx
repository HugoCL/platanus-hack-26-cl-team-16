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
import { type ReactNode, useEffect, useState } from "react";
import type { UiResponse, UiSpec } from "@/shared/genui";
import { type GenUiAnswer, GenUiBlock, isSlotPicker } from "./genui-block";
import {
  type Fault,
  ModeratorShield,
  PendingStages,
  Ruling,
} from "./moderation";
import {
  canAnswerUi,
  canSeeContent,
  describeUiResponse,
  formatTime,
  primaryReason,
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
  // Same sender as the message right above: the name is not repeated.
  continued?: boolean;
  readOnly?: boolean;
  // Which fault this blocked message was, out of how many the contract allows.
  fault?: Fault;
  // A system notice the room words itself, in place of the stored text.
  noticeText?: string;
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
        text={props.noticeText ?? message.content.text}
      />
    );
  }
  return <Entry {...props} />;
}

function Entry({
  message,
  sender,
  viewer,
  answers,
  uiSpecsByMessage,
  highlighted,
  continued,
  fault,
  onRespond,
  onReview,
  readOnly,
}: MessageItemProps) {
  const self = sender?.side === "self";
  const { content, status } = message;
  const visible = canSeeContent(status, message.senderParticipantId, viewer);
  const canModerate = viewer.role === "owner" || viewer.role === "operator";
  const slow = useSlowReview(status === "pending");

  // The bubble, and what hangs under it (a slot picker's tiles sit below their sentence).
  let bubble: ReactNode;
  let below: ReactNode = null;
  if (status === "pending" && !visible) {
    bubble = (
      <div className="room-bubble room-pending text-subtle-foreground">
        El moderador está revisando este mensaje.
      </div>
    );
  } else if (!visible || (status === "blocked" && content.kind !== "ui")) {
    bubble = (
      <HeldBody
        moderatorError={
          primaryReason(message.reasons)?.code === "moderator_error"
        }
        text={visible && content.kind === "text" ? content.text : undefined}
      />
    );
  } else if (content.kind === "text") {
    bubble = (
      <div className={bubbleClass(status)}>
        {status === "redacted" && message.redactedText ? (
          <RedactedText text={message.redactedText} />
        ) : (
          <p className="m-0 whitespace-pre-wrap break-words">{content.text}</p>
        )}
      </div>
    );
  } else if (content.kind === "ui") {
    const block = (
      <GenUiBlock
        spec={content.spec}
        answer={answers[content.spec.id]}
        canInteract={canAnswerUi(viewer)}
        readOnly={readOnly || status === "pending"}
        onRespond={onRespond}
      />
    );
    if (content.spec.type === "slot_picker" && isSlotPicker(content.spec)) {
      bubble = (
        <div className={bubbleClass(status)}>
          <p className="m-0 break-words">{content.spec.title}</p>
          <p className="m-0 text-xs opacity-70">Hora de Santiago</p>
        </div>
      );
      below = block;
    } else {
      bubble = (
        <div
          className={`min-w-0 flex-[0_1_520px] ${status === "pending" ? "room-pending" : ""}`}
        >
          {block}
        </div>
      );
    }
  } else if (content.kind === "ui_response") {
    bubble = (
      <div className={bubbleClass(status)}>
        <a
          href={`#msg-${content.inReplyTo}`}
          className="inline-flex items-center gap-1.5 text-inherit !no-underline"
        >
          <ReplyIcon size={14} className="shrink-0 opacity-70" />
          {describeUiResponse(
            content.response,
            uiSpecsByMessage[content.inReplyTo],
          )}
        </a>
      </div>
    );
  } else {
    bubble = (
      <div className={bubbleClass(status)}>
        <p className="m-0 inline-flex items-center gap-1.5 opacity-80">
          <LockIcon size={14} />
          Mensaje cifrado
        </p>
      </div>
    );
  }

  return (
    <article
      id={`msg-${message.messageId}`}
      data-testid="room-message"
      data-status={status}
      data-mine={self ? "" : undefined}
      data-continued={continued ? "" : undefined}
      aria-label={`${sender?.name ?? "Desconocido"}, ${formatTime(message.sentAt)}`}
      className={`room-entry ${highlighted ? "room-highlight" : ""}`}
    >
      <time
        className="room-time"
        dateTime={new Date(message.sentAt).toISOString()}
      >
        {formatTime(message.sentAt)}
      </time>
      <div className="room-msg">
        {continued ? null : <SenderName sender={sender} />}
        <div className="room-brow">
          {bubble}
          <ModeratorShield message={message} />
        </div>
        {below}
        {status === "pending" ? <PendingStages /> : null}
        {slow ? (
          <p className="room-ruling">
            <span>
              El moderador está tardando más de lo normal. El mensaje no se
              entrega hasta que lo revise.
            </span>
          </p>
        ) : null}
        <Ruling message={message} fault={fault} />
        {status === "escalated" && canModerate && onReview ? (
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        ) : null}
      </div>
    </article>
  );
}

function bubbleClass(status: RoomMessage["status"]) {
  return `room-bubble ${status === "pending" ? "room-pending" : ""}`;
}

const SLOW_REVIEW_MS = 15_000;

function useSlowReview(pending: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return slow;
}

function SenderName({ sender }: { sender?: RoomParticipant }) {
  if (!sender) return <span className="room-who">Desconocido</span>;
  return (
    <span className="room-who" title={sender.name}>
      {sender.kind === "human" ? (
        <UserIcon size={13} className="mr-1 inline align-[-2px]" />
      ) : null}
      {sender.name}
      {sender.kind === "human" && sender.onBehalfOf ? (
        <span className="font-normal text-subtle-foreground">
          {" "}
          (en nombre de {sender.onBehalfOf})
        </span>
      ) : null}
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
            className="room-redact"
            style={{ width: `${Math.min(part.text.length, 18) * 0.6}em` }}
          >
            <span className="sr-only">[texto tachado por el moderador]</span>
          </span>
        ) : (
          <span key={part.at}>{part.text}</span>
        ),
      )}
    </p>
  );
}

// The hatch is what the moderator held back. The sender's side still sees its own text.
function HeldBody({
  moderatorError,
  text,
}: {
  moderatorError: boolean;
  text?: string;
}) {
  return (
    <div className="room-held">
      <p className="m-0">
        {moderatorError
          ? "No se pudo verificar este mensaje. Por seguridad no se entregó."
          : "El moderador retuvo este mensaje."}
      </p>
      {text ? (
        <p className="m-0 mt-1 whitespace-pre-wrap break-words text-foreground line-through decoration-1">
          {text}
        </p>
      ) : null}
    </div>
  );
}

const SYSTEM_ICONS: Partial<Record<string, ReactNode>> = {
  message_blocked: <BanIcon size={13} />,
  escalation_requested: <TriangleAlertIcon size={13} />,
  session_terminated: <BanIcon size={13} />,
  human_joined: <UserIcon size={13} />,
  agent_joined: <UserIcon size={13} />,
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
  return (
    <p
      id={`msg-${id}`}
      data-testid="system-notice"
      data-code={code}
      className="room-notice"
    >
      {SYSTEM_ICONS[code] ?? <ShieldCheckIcon size={13} />}
      <span>{text}</span>
    </p>
  );
}
