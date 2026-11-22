import type { Metadata } from "next";
import { DemoWatch } from "@/components/demo-watch";

export const metadata: Metadata = {
  title: "Demo en vivo",
  robots: { index: false, follow: false },
};

export default function DemoWatchPage() {
  return <DemoWatch />;
}
