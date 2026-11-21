import type { Metadata } from "next";
import { DataToggle } from "@/components/room/data-toggle";
import { DemoRoom } from "@/components/room/room-view";
import {
  isRoomDataset,
  ROOM_DATASETS,
} from "@/components/room/worst-case-session";

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
  const dataset = DEV && isRoomDataset(data) ? data : "demo";
  return (
    <>
      <DemoRoom
        fixture={ROOM_DATASETS[dataset].fixture}
        instant={dataset !== "demo"}
      />
      {DEV ? <DataToggle current={dataset} /> : null}
    </>
  );
}
