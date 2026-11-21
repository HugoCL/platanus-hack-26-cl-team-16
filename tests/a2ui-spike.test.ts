import { Catalog, type ComponentApi } from "@a2ui/web_core/v1_0";
import { describe, expect, it } from "vitest";
import {
  AGENT_CATALOG_ID,
  AGENT_COMPONENT_APIS,
  ModeratorAlertApi,
  PLATFORM_CATALOG_ID,
} from "../components/a2ui-spike/apis";
import {
  A2uiAgentSurface,
  actionToUiResponse,
  loadBlock,
  textForModeration,
} from "../components/a2ui-spike/bridge";
import {
  ALERT_FROM_AGENT_BLOCK,
  HTML_IN_DATA_BLOCK,
  MODERATOR_ALERT_BLOCK,
  SLOT_PICKER_BLOCK,
  SMUGGLED_PROP_BLOCK,
  UNKNOWN_COMPONENT_BLOCK,
} from "../components/a2ui-spike/fixtures";

const agentCatalog = new Catalog<ComponentApi>(
  AGENT_CATALOG_ID,
  "1.0",
  AGENT_COMPONENT_APIS,
);
const platformCatalog = new Catalog<ComponentApi>(PLATFORM_CATALOG_ID, "1.0", [
  ModeratorAlertApi,
]);
const noop = () => {};

describe("A2UI v1.0 spike", () => {
  it("loads the slot picker and the moderator alert", () => {
    expect(loadBlock(SLOT_PICKER_BLOCK, agentCatalog, noop).ok).toBe(true);
    expect(loadBlock(MODERATOR_ALERT_BLOCK, platformCatalog, noop).ok).toBe(
      true,
    );
  });

  it.each([
    ["unknown component", UNKNOWN_COMPONENT_BLOCK],
    ["smuggled dangerouslySetInnerHTML prop", SMUGGLED_PROP_BLOCK],
    ["moderator alert sent by an agent", ALERT_FROM_AGENT_BLOCK],
  ])("rejects %s and keeps the raw block as plain text", (_, raw) => {
    const block = loadBlock(raw, agentCatalog, noop);
    expect(block.ok).toBe(false);
    if (!block.ok) expect(block.text).toBe(JSON.stringify(raw, null, 2));
  });

  it("rejects what the envelope allows but the strict processor does not", () => {
    const withFunction = structuredClone(SLOT_PICKER_BLOCK) as never as {
      createSurface: { components: Record<string, unknown>[] };
    };
    withFunction.createSurface.components[0].title = {
      "@call": "openUrl",
      args: { url: "https://evil.example" },
    };
    expect(A2uiAgentSurface.safeParse(withFunction).success).toBe(true);
    const block = loadBlock(withFunction, agentCatalog, noop);
    expect(block.ok).toBe(false);
    if (!block.ok)
      expect(block.error).toMatch(/Unrecognized function 'openUrl'/);
  });

  it("accepts HTML inside strings as data, which React renders as text", () => {
    expect(loadBlock(HTML_IN_DATA_BLOCK, agentCatalog, noop).ok).toBe(true);
  });

  it("gives the moderator text from components and the data model", () => {
    const text = textForModeration(A2uiAgentSurface.parse(HTML_IN_DATA_BLOCK));
    expect(text).toContain("<b onmouseover=alert(1)>Clínica</b>");
    expect(text.some((t) => t.includes("<script>"))).toBe(true);
  });

  it("maps a slot action to ui_response by component type, not by action name", () => {
    const block = loadBlock(SLOT_PICKER_BLOCK, agentCatalog, noop);
    if (!block.ok) throw new Error(block.error);
    const action = {
      name: "anything_the_agent_chose",
      surfaceId: "msg_slot_picker",
      sourceComponentId: "root",
      timestamp: new Date().toISOString(),
      context: { slotId: "slot_thu_1030" },
    };
    expect(actionToUiResponse(block.surface, action)).toEqual({
      type: "slot_selected",
      pickerId: "root",
      slotId: "slot_thu_1030",
    });
    expect(
      actionToUiResponse(block.surface, {
        ...action,
        context: { slotId: "slot_not_offered" },
      }),
    ).toBeNull();
  });
});
