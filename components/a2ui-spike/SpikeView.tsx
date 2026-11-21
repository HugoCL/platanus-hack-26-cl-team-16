"use client";

import { A2uiSurface } from "@a2ui/react";
import type { Catalog, ComponentApi } from "@a2ui/web_core/v1_0";
import { useEffect, useState } from "react";
import { actionToUiResponse, loadBlock } from "@/components/a2ui-spike/bridge";
import { agentCatalog, platformCatalog } from "@/components/a2ui-spike/catalog";
import {
  ALERT_FROM_AGENT_BLOCK,
  HTML_IN_DATA_BLOCK,
  MODERATOR_ALERT_BLOCK,
  SLOT_PICKER_BLOCK,
  SMUGGLED_PROP_BLOCK,
  UNKNOWN_COMPONENT_BLOCK,
} from "@/components/a2ui-spike/fixtures";
import type { UiResponse } from "@/shared/genui";

type Responses = Record<string, UiResponse | "rejected">;

function Block({
  name,
  raw,
  catalog,
  onResponse,
}: {
  name: string;
  raw: unknown;
  catalog: Catalog<ComponentApi>;
  onResponse: (name: string, response: UiResponse | "rejected") => void;
}) {
  const [block, setBlock] = useState<ReturnType<
    typeof loadBlock<ComponentApi>
  > | null>(null);
  useEffect(() => {
    const loaded = loadBlock(raw, catalog, (action, surface) =>
      onResponse(name, actionToUiResponse(surface, action) ?? "rejected"),
    );
    setBlock(loaded);
    return () => {
      if (loaded.ok) loaded.processor.dispose();
    };
  }, [raw, catalog, name, onResponse]);
  if (!block) return null;
  return (
    <article
      data-testid={`block-${name}`}
      data-ok={block.ok}
      className="flex flex-col gap-2"
    >
      <h2 className="text-sm font-mono text-muted-foreground">{name}</h2>
      {block.ok ? (
        <A2uiSurface surface={block.surface as never} />
      ) : (
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">
          {block.text}
        </pre>
      )}
    </article>
  );
}

export default function SpikeView() {
  const [responses, setResponses] = useState<Responses>({});
  const [onResponse] = useState(
    () => (name: string, response: UiResponse | "rejected") =>
      setResponses((current) => ({ ...current, [name]: response })),
  );
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold">A2UI v1.0 spike</h1>
      <Block
        name="slot_picker"
        raw={SLOT_PICKER_BLOCK}
        catalog={agentCatalog}
        onResponse={onResponse}
      />
      <Block
        name="moderator_alert"
        raw={MODERATOR_ALERT_BLOCK}
        catalog={platformCatalog}
        onResponse={onResponse}
      />
      <Block
        name="unknown_component"
        raw={UNKNOWN_COMPONENT_BLOCK}
        catalog={agentCatalog}
        onResponse={onResponse}
      />
      <Block
        name="html_in_data"
        raw={HTML_IN_DATA_BLOCK}
        catalog={agentCatalog}
        onResponse={onResponse}
      />
      <Block
        name="smuggled_prop"
        raw={SMUGGLED_PROP_BLOCK}
        catalog={agentCatalog}
        onResponse={onResponse}
      />
      <Block
        name="alert_from_agent"
        raw={ALERT_FROM_AGENT_BLOCK}
        catalog={agentCatalog}
        onResponse={onResponse}
      />
      <section>
        <h2 className="font-semibold">ui_response</h2>
        <pre
          data-testid="ui-responses"
          className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs"
        >
          {JSON.stringify(responses, null, 2)}
        </pre>
      </section>
    </main>
  );
}
