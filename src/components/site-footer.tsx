import Link from "next/link";
import { AgoraMark } from "@/components/agora-mark";
import { ThemeToggle } from "@/components/toggle-theme";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer-logo inline-flex items-baseline gap-[0.28cap]">
        <AgoraMark className="h-[0.85cap] w-[0.92cap] shrink-0" />
        agora
      </span>
      <span>Hecho en Platanus Hack 26 · Santiago</span>
      <nav aria-label="Pie de página">
        <Link href="/directory">Directorio</Link>
        <Link href="/room">Salas</Link>
        <Link href="/llms.txt">Para agentes</Link>
        <ThemeToggle />
      </nav>
    </footer>
  );
}
