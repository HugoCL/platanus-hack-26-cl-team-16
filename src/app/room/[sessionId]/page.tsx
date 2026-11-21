import type { Metadata } from "next";
import { LiveRoom } from "@/components/room/live-room-view";

export const metadata: Metadata = { title: "Sala moderada" };

export default async function RoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <LiveRoom key={sessionId} sessionId={sessionId} />;
}
