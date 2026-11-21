import type { Metadata } from "next";
import { DemoRoom } from "@/components/room/room-view";

export const metadata: Metadata = {
  title: "Sala moderada · demo",
};

export default function RoomDemoPage() {
  return <DemoRoom />;
}
