"use client";

import dynamic from "next/dynamic";

// @a2ui/react touches HTMLElement at module evaluation, so it cannot run during SSR.
const SpikeView = dynamic(() => import("@/components/a2ui-spike/SpikeView"), {
  ssr: false,
});

export default function A2uiSpikePage() {
  return <SpikeView />;
}
