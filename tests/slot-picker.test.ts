import type { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { DEMO_SCRIPT } from "../src/components/room/demo-session";
import { GenUiBlock } from "../src/components/room/genui-block";

const captured = vi.hoisted(() => ({
  group: {} as ComponentProps<typeof RadioGroup>,
  radios: [] as ComponentProps<typeof Radio>[],
}));

vi.mock("@ui-sdk/react/radio", () => ({
  RadioGroup: (props: ComponentProps<typeof RadioGroup>) => {
    captured.group = props;
    return props.children;
  },
  Radio: (props: ComponentProps<typeof Radio>) => {
    captured.radios.push(props);
    return null;
  },
  RadioIndicator: () => null,
}));

beforeEach(() => {
  captured.radios = [];
});

function render(canInteract = true, empty = false) {
  const message = DEMO_SCRIPT.find(
    ({ message }) =>
      message.content.kind === "ui" &&
      message.content.spec.type === "slot_picker",
  )?.message;
  if (
    message?.content.kind !== "ui" ||
    message.content.spec.type !== "slot_picker"
  )
    throw new Error("Missing slot picker");
  const onRespond = vi.fn();
  renderToStaticMarkup(
    createElement(GenUiBlock, {
      spec: { ...message.content.spec, ...(empty ? { slots: [] } : {}) },
      canInteract,
      onRespond,
    }),
  );
  return onRespond;
}

function change(value: string, reason: "item-press" | "list-navigation") {
  captured.group.onValueChange?.(value, {
    reason,
  } as Parameters<NonNullable<typeof captured.group.onValueChange>>[1]);
}

function key(key: string, repeat = false) {
  return {
    key,
    repeat,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as Parameters<
    NonNullable<ComponentProps<typeof Radio>["onKeyDownCapture"]>
  >[0];
}

it("submits an arrow-selected slot on Space without another value change", () => {
  const onRespond = render();
  const radio = captured.radios[1];
  change(radio.value, "list-navigation");
  expect(onRespond).not.toHaveBeenCalled();
  const event = key(" ");
  radio.onKeyDownCapture?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(onRespond).toHaveBeenCalledExactlyOnceWith({
    type: "slot_selected",
    pickerId: "slots-cardio",
    slotId: radio.value,
  });
  radio.onKeyDownCapture?.(key(" ", true));
  expect(onRespond).toHaveBeenCalledTimes(1);
});

it("confirms a click even when arrow navigation already selected the slot", () => {
  const onRespond = render();
  const radio = captured.radios[1];
  change(radio.value, "list-navigation");
  expect(onRespond).not.toHaveBeenCalled();
  radio.onClick?.({} as Parameters<NonNullable<typeof radio.onClick>>[0]);
  expect(onRespond).toHaveBeenCalledExactlyOnceWith({
    type: "slot_selected",
    pickerId: "slots-cardio",
    slotId: radio.value,
  });
});

it("sends only once when a click also changes the value", () => {
  const onRespond = render();
  const radio = captured.radios[0];
  change(radio.value, "item-press");
  radio.onClick?.({} as Parameters<NonNullable<typeof radio.onClick>>[0]);
  expect(onRespond).toHaveBeenCalledTimes(1);
});

it("does not submit for other keys or when disabled", () => {
  const onRespond = render();
  captured.radios[0].onKeyDownCapture?.(key("ArrowDown"));
  expect(onRespond).not.toHaveBeenCalled();
  const disabledRespond = render(false);
  captured.radios.at(-1)?.onKeyDownCapture?.(key(" "));
  const radio = captured.radios.at(-1);
  radio?.onClick?.({} as Parameters<NonNullable<typeof radio.onClick>>[0]);
  expect(disabledRespond).not.toHaveBeenCalled();
});

it("does not submit an empty list", () => {
  const onRespond = render(true, true);
  expect(captured.radios).toHaveLength(0);
  expect(onRespond).not.toHaveBeenCalled();
});
