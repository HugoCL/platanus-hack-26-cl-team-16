import {
  type ActionPayload,
  type Catalog,
  type ComponentApi,
  MessageProcessor,
  STRICT_VALIDATION,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import { z } from "zod";
import { UiResponse } from "../../shared/genui";
import { AGENT_CATALOG_ID, AGENT_COMPONENTS } from "./apis";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const A2uiAgentSurface = z
  .object({
    version: z.literal("1.0"),
    createSurface: z
      .object({
        surfaceId: id,
        catalogId: z.literal(AGENT_CATALOG_ID),
        components: z
          .array(
            z.looseObject({
              id,
              component: z.enum(AGENT_COMPONENTS as [string, ...string[]]),
            }),
          )
          .min(1)
          .max(20),
        dataModel: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type A2uiAgentSurface = z.infer<typeof A2uiAgentSurface>;

export type LoadedBlock<T extends ComponentApi> =
  | { ok: true; surface: SurfaceModel<T>; processor: MessageProcessor<T> }
  | { ok: false; text: string; error: string };

export function loadBlock<T extends ComponentApi>(
  raw: unknown,
  catalog: Catalog<T>,
  onAction: (action: ActionPayload, surface: SurfaceModel<T>) => void,
): LoadedBlock<T> {
  const text = JSON.stringify(raw, null, 2) ?? String(raw);
  const envelope = A2uiAgentSurface.safeParse(raw);
  if (!envelope.success && catalog.id === AGENT_CATALOG_ID) {
    return { ok: false, text, error: z.prettifyError(envelope.error) };
  }
  const processor: MessageProcessor<T> = new MessageProcessor<T>(
    [catalog],
    (action) => {
      const surface = processor.model.getSurface(action.surfaceId);
      if (surface) onAction(action, surface);
    },
    { validationConfig: STRICT_VALIDATION },
  );
  try {
    processor.processMessages(raw as never);
  } catch (error) {
    processor.dispose();
    return { ok: false, text, error: (error as Error).message };
  }
  const [surface] = processor.model.surfacesMap.values();
  if (!surface) return { ok: false, text, error: "no surface" };
  return { ok: true, surface, processor };
}

export function actionToUiResponse(
  surface: SurfaceModel<ComponentApi>,
  action: ActionPayload,
): UiResponse | null {
  const component = surface.componentsModel.get(action.sourceComponentId);
  const props = component?.properties as Record<string, unknown> | undefined;
  const { context } = action;
  const candidate = (() => {
    switch (component?.type) {
      case "SlotPicker": {
        const slots = (props?.slots ?? []) as { id: string }[];
        if (!slots.some((slot) => slot.id === context.slotId)) return null;
        return {
          type: "slot_selected",
          pickerId: component.id,
          slotId: context.slotId,
        };
      }
      case "ConfirmationCard":
        return {
          type: "confirmation",
          confirmationId: component.id,
          confirmed: action.name === "confirm",
        };
      default:
        return null;
    }
  })();
  const parsed = UiResponse.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function textForModeration(block: A2uiAgentSurface): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (key !== "id" && key !== "component" && key !== "@path") {
        out.push(value);
      }
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(block.createSurface.components);
  walk(block.createSurface.dataModel);
  return out;
}
