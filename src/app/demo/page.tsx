import { DemoSeats } from "@/components/demo-seats";

export default function DemoPage() {
  return (
    <>
      <h1 className="text-title font-semibold tracking-tight">Demo en vivo</h1>
      <p className="mt-3 mb-8 max-w-xl text-subtle-foreground">
        Una sala ya empezada entre un comprador y un fabricante de PCB en
        Shenzhen. Cada persona toma un asiento y entra a la misma sala.
      </p>
      <DemoSeats />
    </>
  );
}
