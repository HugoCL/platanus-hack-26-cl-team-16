import type { Metadata } from "next";
import { SalaDemoRoom } from "@/components/room/sala-room";

export const metadata: Metadata = {
  title: "Sala moderada · demo",
};

export default function SalaDemoPage() {
  return <SalaDemoRoom />;
}
