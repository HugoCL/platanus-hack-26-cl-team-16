import { AGENT_CATALOG_ID, PLATFORM_CATALOG_ID } from "./apis";

const slotPicker = {
  id: "root",
  component: "SlotPicker",
  title: "Elige un horario con cardiología",
  timezone: "America/Santiago",
  slots: [
    {
      id: "slot_thu_1030",
      start: "2026-11-26T10:30:00-03:00",
      end: "2026-11-26T11:00:00-03:00",
      label: "Jue 26 · 10:30",
    },
    {
      id: "slot_fri_0900",
      start: "2026-11-27T09:00:00-03:00",
      end: "2026-11-27T09:30:00-03:00",
      label: "Vie 27 · 09:00",
    },
  ],
  selected: { "@path": "/selectedSlot" },
  action: {
    event: {
      name: "slot_selected",
      context: { slotId: { "@path": "/selectedSlot" } },
    },
  },
};

export const SLOT_PICKER_BLOCK = {
  version: "1.0",
  createSurface: {
    surfaceId: "msg_slot_picker",
    catalogId: AGENT_CATALOG_ID,
    components: [slotPicker],
    dataModel: { selectedSlot: "" },
  },
};

export const MODERATOR_ALERT_BLOCK = {
  version: "1.0",
  createSurface: {
    surfaceId: "msg_moderator_alert",
    catalogId: PLATFORM_CATALOG_ID,
    components: [
      {
        id: "root",
        component: "ModeratorAlert",
        title: "Mensaje bloqueado",
        rule: "injection",
        reason:
          "El agente pidió ignorar sus reglas y entregar la lista de pacientes.",
      },
    ],
  },
};

export const UNKNOWN_COMPONENT_BLOCK = {
  version: "1.0",
  createSurface: {
    surfaceId: "msg_unknown",
    catalogId: AGENT_CATALOG_ID,
    components: [
      { id: "root", component: "Iframe", src: "https://evil.example" },
    ],
  },
};

export const HTML_IN_DATA_BLOCK = {
  version: "1.0",
  createSurface: {
    surfaceId: "msg_html_data",
    catalogId: AGENT_CATALOG_ID,
    components: [
      {
        id: "root",
        component: "InfoCard",
        title: { "@path": "/title" },
        body: '<img src=x onerror="document.title=\'pwned\'"><script>document.title="pwned"</script>',
      },
    ],
    dataModel: { title: "<b onmouseover=alert(1)>Clínica</b>" },
  },
};

export const SMUGGLED_PROP_BLOCK = {
  version: "1.0",
  createSurface: {
    surfaceId: "msg_smuggled",
    catalogId: AGENT_CATALOG_ID,
    components: [
      {
        ...slotPicker,
        dangerouslySetInnerHTML: {
          __html: "<script>document.title='pwned'</script>",
        },
      },
    ],
    dataModel: { selectedSlot: "" },
  },
};

export const ALERT_FROM_AGENT_BLOCK = {
  ...MODERATOR_ALERT_BLOCK,
  createSurface: {
    ...MODERATOR_ALERT_BLOCK.createSurface,
    surfaceId: "msg_fake_alert",
    catalogId: AGENT_CATALOG_ID,
  },
};
