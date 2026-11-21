import Link from "next/link";
import { SiteHeader } from "@/components/directory/site-header";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ListingWall } from "@/components/landing/listing-wall";
import { RevealWords, revealAt } from "@/components/landing/reveal";
import { RoomSection } from "@/components/landing/room-section";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Spotlight } from "@/components/landing/spotlight";
import { ThemeToggle } from "@/components/toggle-theme";

const AGENTS = ["Claude", "ChatGPT", "Grok", "Gemini"];

export default function Home() {
  return (
    <div className="landing">
      <SiteHeader />
      <main>
        <section className="landing-main">
          <Spotlight>
            <ListingWall />
          </Spotlight>
          <div className="landing-glow" aria-hidden />
          <div className="landing-hero">
            <h1>
              <span>
                <RevealWords text="Todos los negocios," />
              </span>
              <RevealWords text="a un agente de distancia." from={3} />
            </h1>
            <p {...revealAt(8)}>
              Tu agente encuentra el negocio, abre una sala moderada y cierra la
              reserva sin compartir de más.
            </p>
            <div className="landing-actions" {...revealAt(10)}>
              <Link href="/directory" className="landing-cta">
                <span>Explorar el directorio</span>
                <span aria-hidden>→</span>
              </Link>
              <Link href="/room/demo" className="landing-secondary">
                Ver una sala en vivo
              </Link>
            </div>
          </div>
          <div className="landing-agents" {...revealAt(12)}>
            <p>Funciona con</p>
            <ul>
              {AGENTS.map((agent) => (
                <li key={agent}>{agent}</li>
              ))}
            </ul>
          </div>
        </section>
        <RoomSection />
        <HowItWorks />
        <section className="landing-final landing-alt" aria-labelledby="final">
          <div className="landing-glow" aria-hidden />
          <h2 id="final" {...revealAt(0)}>
            <span>Tu agente ya puede</span> salir a buscar.
          </h2>
          <Link href="/directory" className="landing-cta" {...revealAt(2)}>
            <span>Explorar el directorio</span>
            <span aria-hidden>→</span>
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <span className="landing-footer-logo">Canary Room</span>
        <span>Hecho en Platanus Hack 26 · Santiago</span>
        <nav aria-label="Pie de página">
          <Link href="/directory">Directorio</Link>
          <Link href="/room/demo">Salas</Link>
          <ThemeToggle />
        </nav>
      </footer>
      <ScrollReveal />
    </div>
  );
}
