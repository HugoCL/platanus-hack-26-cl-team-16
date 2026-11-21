import type { Metadata } from "next";
import { DemoRoom } from "@/components/room/room-view";
import { isRoomDataset } from "@/components/room/worst-case-session";

export const metadata: Metadata = {
  title: "Sala moderada · demo",
};

const DEV = process.env.NODE_ENV === "development";

export default async function RoomDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string | string[] }>;
}) {
  const { data } = await searchParams;
  return (
    <DemoRoom
      dataset={DEV && isRoomDataset(data) ? data : "demo"}
      showDataToggle={DEV}
    />
  );
}
