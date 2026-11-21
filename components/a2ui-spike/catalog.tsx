"use client";

import { createComponentImplementation } from "@a2ui/react";
import { Catalog, type ComponentApi } from "@a2ui/web_core/v1_0";
import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import {
  AGENT_CATALOG_ID,
  ConfirmationCardApi,
  InfoCardApi,
  ModeratorAlertApi,
  PLATFORM_CATALOG_ID,
  SlotPickerApi,
} from "./apis";

const SlotPicker = createComponentImplementation(SlotPickerApi, ({ props }) => {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <section
      data-testid="slot-picker"
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <h3 className="font-semibold">{props.title}</h3>
      <div className="flex flex-wrap gap-2">
        {props.slots.map((slot) => (
          <Button
            key={slot.id}
            data-variant={chosen === slot.id ? "solid" : undefined}
            disabled={chosen !== null}
            onClick={() => {
              setChosen(slot.id);
              props.setSelected?.(slot.id);
              props.action();
            }}
          >
            {slot.label ?? slot.start}
          </Button>
        ))}
      </div>
    </section>
  );
});

const ConfirmationCard = createComponentImplementation(
  ConfirmationCardApi,
  ({ props }) => {
    const [done, setDone] = useState(false);
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h3 className="font-semibold">{props.title}</h3>
        <p>{props.summary}</p>
        <dl>
          {props.details.map((detail) => (
            <div key={detail.label} className="flex gap-2">
              <dt className="text-muted-foreground">{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex gap-2">
          <Button
            data-variant="solid"
            disabled={done}
            onClick={() => {
              setDone(true);
              props.confirmAction();
            }}
          >
            {props.confirmLabel}
          </Button>
          <Button
            disabled={done}
            onClick={() => {
              setDone(true);
              props.cancelAction();
            }}
          >
            {props.cancelLabel}
          </Button>
        </div>
      </section>
    );
  },
);

const InfoCard = createComponentImplementation(InfoCardApi, ({ props }) => (
  <section className="flex flex-col gap-2 rounded-lg border border-border p-4">
    <h3 className="font-semibold">{props.title}</h3>
    {props.body && <p>{props.body}</p>}
  </section>
));

const ModeratorAlert = createComponentImplementation(
  ModeratorAlertApi,
  ({ props }) => (
    <section
      role="alert"
      data-testid="moderator-alert"
      className="flex flex-col gap-1 rounded-lg border-2 border-red-600 p-4"
    >
      <h3 className="font-semibold">{props.title}</h3>
      <p className="text-sm text-muted-foreground">Regla: {props.rule}</p>
      <p>{props.reason}</p>
    </section>
  ),
);

// @a2ui/react types its schemas with the host's zod (4) while @a2ui/web_core uses zod 3.
// Runtime is unaffected (the React package never imports zod), so the cast is type-only.
export const agentCatalog = new Catalog<ComponentApi>(AGENT_CATALOG_ID, "1.0", [
  SlotPicker,
  ConfirmationCard,
  InfoCard,
] as unknown as ComponentApi[]);

export const platformCatalog = new Catalog<ComponentApi>(
  PLATFORM_CATALOG_ID,
  "1.0",
  [ModeratorAlert] as unknown as ComponentApi[],
);
