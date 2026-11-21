import Link from "next/link";
import { ThemeToggle } from "@/components/toggle-theme";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer-logo">Canary Room</span>
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
