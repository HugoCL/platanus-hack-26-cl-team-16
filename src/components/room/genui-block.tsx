"use client";

import { Button } from "@ui-sdk/react/button";
import {
  Checkbox,
  CheckboxGroup,
  CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { Field, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Textarea } from "@ui-sdk/react/textarea";
import { type FormEvent, type ReactNode, useState } from "react";
import type { z } from "zod";
import {
  type CardSpec,
  type ConfirmationSpec,
  type FormSpec,
  type ListSpec,
  type MapPinSpec,
  type ModeratorAlertSpec,
  type SlotPickerSpec,
  type UiResponse,
  UiSpec,
} from "@/shared/genui";
import {
  AlertIcon,
  CalendarIcon,
  CardIcon,
  CheckIcon,
  FormIcon,
  ListIcon,
  PinIcon,
  ShieldIcon,
} from "./icons";
import { formatTime, groupSlotsByDay } from "./room-format";

export type GenUiAnswer = { response: UiResponse; at: number };

type BlockProps<S> = {
  spec: S;
  answer?: GenUiAnswer;
  disabled: boolean;
  onRespond: (response: UiResponse) => void;
};

const TYPE_META: Record<UiSpec["type"], { label: string; icon: ReactNode }> = {
  card: { label: "Tarjeta", icon: <CardIcon /> },
  form: { label: "Formulario", icon: <FormIcon /> },
  slot_picker: { label: "Horarios", icon: <CalendarIcon /> },
  confirmation: { label: "Confirmación", icon: <CheckIcon /> },
  list: { label: "Lista", icon: <ListIcon /> },
  map_pin: { label: "Ubicación", icon: <PinIcon /> },
  moderator_alert: { label: "Moderador", icon: <ShieldIcon /> },
};

export function GenUiBlock({
  spec: raw,
  senderName,
  answer,
  canInteract,
  onRespond,
}: {
  spec: unknown;
  senderName: string;
  answer?: GenUiAnswer;
  canInteract: boolean;
  onRespond: (response: UiResponse) => void;
}) {
  const parsed = UiSpec.safeParse(raw);
  if (!parsed.success) {
    return (
      <div
        data-testid="genui-invalid"
        className="rounded-3xl border border-dashed border-border bg-muted px-4 py-3 text-sm text-subtle-foreground"
      >
        Componente inválido, no se mostró
      </div>
    );
  }

  const spec = parsed.data;
  const meta = TYPE_META[spec.type];
  const disabled = !canInteract || answer !== undefined;
  const props = { answer, disabled, onRespond };
  const title = "title" in spec ? spec.title : undefined;

  return (
    <section
      aria-label={title ?? meta.label}
      data-genui={spec.type}
      data-answered={answer ? "" : undefined}
      className="w-full max-w-[460px] overflow-hidden rounded-4xl bg-card shadow-card"
    >
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <span className="grid size-7 place-items-center rounded-full bg-muted text-subtle-foreground">
          {meta.icon}
        </span>
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
          {title ?? meta.label}
        </h3>
        {answer ? (
          <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
            <CheckIcon size={13} />
            Respondido {formatTime(answer.at)}
          </span>
        ) : null}
      </header>
      <div className="px-4 pb-3">
        {spec.type === "card" ? <CardBlock spec={spec} {...props} /> : null}
        {spec.type === "form" ? <FormBlock spec={spec} {...props} /> : null}
        {spec.type === "slot_picker" ? (
          <SlotPickerBlock spec={spec} {...props} />
        ) : null}
        {spec.type === "confirmation" ? (
          <ConfirmationBlock spec={spec} {...props} />
        ) : null}
        {spec.type === "list" ? <ListBlock spec={spec} {...props} /> : null}
        {spec.type === "map_pin" ? <MapPinBlock spec={spec} /> : null}
        {spec.type === "moderator_alert" ? (
          <ModeratorAlertBlock spec={spec} />
        ) : null}
      </div>
      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        Generado por {senderName} · validado
        {!canInteract && !answer ? " · solo el dueño puede responder" : null}
      </footer>
    </section>
  );
}

function Details({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col">
          <dt className="text-xs text-subtle-foreground">{item.label}</dt>
          <dd className="m-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CardBlock({
  spec,
  answer,
  disabled,
  onRespond,
}: BlockProps<z.infer<typeof CardSpec>>) {
  const chosen =
    answer?.response.type === "card_action" ? answer.response.actionId : null;
  return (
    <div className="flex flex-col gap-3">
      {spec.body ? (
        <p className="m-0 text-sm text-pretty">{spec.body}</p>
      ) : null}
      {spec.fields?.length ? <Details items={spec.fields} /> : null}
      {spec.actions?.length ? (
        <div className="flex flex-wrap gap-2">
          {spec.actions.map((action) => (
            <Button
              key={action.id}
              data-size="sm"
              data-variant={chosen === action.id ? "solid" : undefined}
              disabled={disabled}
              onClick={() =>
                onRespond({
                  type: "card_action",
                  cardId: spec.id,
                  actionId: action.id,
                })
              }
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FormBlock({
  spec,
  answer,
  disabled,
  onRespond,
}: BlockProps<z.infer<typeof FormSpec>>) {
  const sent =
    answer?.response.type === "form_submit" ? answer.response.values : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values: Record<string, string | number | boolean> = {};
    for (const field of spec.fields) {
      const value = data.get(field.name);
      if (field.input === "checkbox") values[field.name] = value !== null;
      else if (field.input === "number" && typeof value === "string")
        values[field.name] = Number(value);
      else if (typeof value === "string" && value !== "")
        values[field.name] = value;
    }
    onRespond({ type: "form_submit", formId: spec.id, values });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {spec.description ? (
        <p className="m-0 text-sm text-subtle-foreground">{spec.description}</p>
      ) : null}
      <fieldset
        disabled={disabled}
        className="m-0 flex flex-col gap-3 border-0 p-0"
      >
        {spec.fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            sentValue={sent?.[field.name]}
          />
        ))}
      </fieldset>
      {sent ? null : (
        <Button
          type="submit"
          data-variant="solid"
          disabled={disabled}
          className="self-start"
        >
          {spec.submitLabel}
        </Button>
      )}
    </form>
  );
}

type FormFieldSpecT = z.infer<typeof FormSpec>["fields"][number];

function FormField({
  field,
  sentValue,
}: {
  field: FormFieldSpecT;
  sentValue?: string | number | boolean;
}) {
  const label = (
    <>
      {field.label}
      {field.required ? (
        <span aria-hidden="true" className="text-destructive-text">
          {" "}
          *
        </span>
      ) : null}
    </>
  );
  const shown = sentValue === undefined ? undefined : String(sentValue);

  if (field.input === "checkbox") {
    return (
      <label data-slot="label" className="flex items-center gap-2 text-sm">
        <Checkbox
          name={field.name}
          required={field.required}
          defaultChecked={sentValue === true}
        >
          <CheckboxIndicator />
        </Checkbox>
        {label}
      </label>
    );
  }

  if (field.input === "select") {
    return (
      <Select
        name={field.name}
        required={field.required}
        placeholder={field.placeholder ?? "Elige una opción"}
        defaultValue={shown}
      >
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {field.input === "textarea" ? (
        <Textarea
          name={field.name}
          required={field.required}
          placeholder={field.placeholder}
          defaultValue={shown}
          maxLength={2000}
          autoResize
        />
      ) : (
        <Input
          name={field.name}
          type={field.input}
          required={field.required}
          placeholder={field.placeholder}
          defaultValue={shown}
        />
      )}
      <FieldError match="valueMissing">Este campo es obligatorio.</FieldError>
      <FieldError match="typeMismatch">Revisa el formato.</FieldError>
    </Field>
  );
}

function SlotPickerBlock({
  spec,
  answer,
  disabled,
  onRespond,
}: BlockProps<z.infer<typeof SlotPickerSpec>>) {
  const answered =
    answer?.response.type === "slot_selected" ? answer.response.slotId : null;
  const [slotId, setSlotId] = useState<string | null>(answered);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-subtle-foreground">Hora de Santiago</p>
      <RadioGroup
        aria-label={spec.title}
        value={slotId}
        onValueChange={setSlotId}
        disabled={disabled}
        className="flex flex-col gap-3"
      >
        {groupSlotsByDay(spec.slots).map(({ day, slots }) => (
          <div key={day} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">{day}</span>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <label
                  key={slot.id}
                  data-slot="label"
                  className="flex cursor-pointer items-center gap-2 rounded-3xl border border-input bg-card px-3 py-2 text-sm has-[[data-checked]]:border-transparent has-[[data-checked]]:shadow-[0_0_0_2px_var(--ui-foreground)] has-[[data-disabled]]:cursor-default"
                >
                  <Radio value={slot.id}>
                    <RadioIndicator />
                  </Radio>
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium tabular-nums">
                      {slot.label ?? formatTime(slot.start)}
                    </span>
                    {slot.detail ? (
                      <span className="text-xs text-subtle-foreground">
                        {slot.detail}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </RadioGroup>
      {answered ? null : (
        <Button
          data-variant="solid"
          disabled={disabled || slotId === null}
          className="self-start"
          onClick={() => {
            if (slotId)
              onRespond({ type: "slot_selected", pickerId: spec.id, slotId });
          }}
        >
          Elegir horario
        </Button>
      )}
    </div>
  );
}

function ConfirmationBlock({
  spec,
  answer,
  disabled,
  onRespond,
}: BlockProps<z.infer<typeof ConfirmationSpec>>) {
  const result =
    answer?.response.type === "confirmation" ? answer.response.confirmed : null;
  const respond = (confirmed: boolean) =>
    onRespond({ type: "confirmation", confirmationId: spec.id, confirmed });

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-pretty">{spec.summary}</p>
      {spec.details.length ? <Details items={spec.details} /> : null}
      {result === null ? (
        <div className="flex flex-wrap gap-2">
          <Button
            data-variant="solid"
            disabled={disabled}
            onClick={() => respond(true)}
          >
            {spec.confirmLabel}
          </Button>
          <Button disabled={disabled} onClick={() => respond(false)}>
            {spec.cancelLabel}
          </Button>
        </div>
      ) : (
        <p className="m-0 inline-flex items-center gap-1.5 text-sm font-medium">
          <CheckIcon size={14} />
          {result ? spec.confirmLabel : spec.cancelLabel}
        </p>
      )}
    </div>
  );
}

function ListBlock({
  spec,
  answer,
  disabled,
  onRespond,
}: BlockProps<z.infer<typeof ListSpec>>) {
  const answered =
    answer?.response.type === "list_selected" ? answer.response.itemIds : null;
  const [selected, setSelected] = useState<string[]>(answered ?? []);

  const rowClass =
    "flex items-center gap-3 rounded-2xl px-2 py-2 has-[[data-checked]]:bg-muted cursor-pointer";

  if (spec.selection === "none") {
    return (
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {spec.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2">
            <ListRow item={item} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {spec.selection === "single" ? (
        <RadioGroup
          aria-label={spec.title ?? "Opciones"}
          value={selected[0] ?? null}
          onValueChange={(value) => setSelected(value ? [value] : [])}
          disabled={disabled}
          className="flex flex-col gap-1"
        >
          {spec.items.map((item) => (
            <label key={item.id} data-slot="label" className={rowClass}>
              <Radio value={item.id}>
                <RadioIndicator />
              </Radio>
              <ListRow item={item} />
            </label>
          ))}
        </RadioGroup>
      ) : (
        <CheckboxGroup
          aria-label={spec.title ?? "Opciones"}
          value={selected}
          onValueChange={setSelected}
          disabled={disabled}
          className="flex flex-col gap-1"
        >
          {spec.items.map((item) => (
            <label key={item.id} data-slot="label" className={rowClass}>
              <Checkbox value={item.id}>
                <CheckboxIndicator />
              </Checkbox>
              <ListRow item={item} />
            </label>
          ))}
        </CheckboxGroup>
      )}
      {answered ? null : (
        <Button
          data-variant="solid"
          disabled={disabled || selected.length === 0}
          className="self-start"
          onClick={() =>
            onRespond({
              type: "list_selected",
              listId: spec.id,
              itemIds: selected,
            })
          }
        >
          Enviar selección
        </Button>
      )}
    </div>
  );
}

type ListSpecItem = z.infer<typeof ListSpec>["items"][number];

function ListRow({ item }: { item: ListSpecItem }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{item.title}</span>
        {item.subtitle ? (
          <span className="text-xs text-subtle-foreground">
            {item.subtitle}
          </span>
        ) : null}
      </span>
      {item.meta ? (
        <span className="text-xs tabular-nums text-subtle-foreground">
          {item.meta}
        </span>
      ) : null}
    </>
  );
}

function MapPinBlock({ spec }: { spec: z.infer<typeof MapPinSpec> }) {
  const href = `https://www.openstreetmap.org/?mlat=${spec.lat}&mlon=${spec.lng}#map=17/${spec.lat}/${spec.lng}`;
  return (
    <div className="flex flex-col gap-3">
      <StaticMap />
      {spec.address ? <p className="m-0 text-sm">{spec.address}</p> : null}
      <Button
        data-size="sm"
        className="self-start"
        render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      >
        Abrir en mapa
      </Button>
    </div>
  );
}

// A drawn map, so no tiles or third-party images load inside the room.
function StaticMap() {
  return (
    <svg
      viewBox="0 0 420 150"
      role="img"
      aria-label="Mapa con la ubicación marcada"
      className="block h-auto w-full rounded-3xl bg-muted"
    >
      <g
        stroke="var(--ui-border)"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M-10 108 C 90 96, 180 120, 430 84" />
        <path d="M120 -10 L 150 160" />
        <path d="M300 -10 C 280 60, 320 100, 290 160" />
      </g>
      <g stroke="var(--ui-input)" strokeWidth="3" fill="none">
        <path d="M-10 40 L 430 52" />
        <path d="M40 -10 L 70 160" />
        <path d="M220 -10 L 210 160" />
        <path d="M370 -10 L 380 160" />
      </g>
      <g transform="translate(212 36)">
        <path
          d="M0 50s-18-15-18-30a18 18 0 0 1 36 0c0 15-18 30-18 30z"
          fill="var(--ui-foreground)"
        />
        <circle cy="20" r="6" fill="var(--sm-card)" />
      </g>
    </svg>
  );
}

function ModeratorAlertBlock({
  spec,
}: {
  spec: z.infer<typeof ModeratorAlertSpec>;
}) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-destructive-soft p-3 text-sm text-destructive-text">
      <AlertIcon className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <code className="font-mono text-xs">{spec.rule}</code>
        <span>{spec.reason}</span>
      </div>
    </div>
  );
}
