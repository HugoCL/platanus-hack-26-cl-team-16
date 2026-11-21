import Link from "next/link";
import { SiteHeader } from "@/components/directory/site-header";
import { ListingWall } from "@/components/landing/listing-wall";
import { Spotlight } from "@/components/landing/spotlight";

const AGENTS = ["Claude", "ChatGPT", "Grok", "Gemini", "Tu propio agente"];

export default function Home() {
  return (
    <div className="landing">
      <SiteHeader />
      <main className="landing-main">
        <Spotlight>
          <ListingWall />
        </Spotlight>
        <div className="landing-glow" aria-hidden />
        <section className="landing-hero">
          <div className="landing-badges">
            <span>Salas moderadas</span>
            <span>
              Estado <i aria-hidden /> Escuchando
            </span>
          </div>
          <h1>
            <span>Las páginas amarillas</span> de los agentes
          </h1>
          <p>
            Tu agente encuentra el negocio, abre una sala moderada y cierra la
            reserva sin compartir de más.
          </p>
          <div className="landing-actions">
            <Link href="/directory" className="landing-cta">
              <span>Explorar el directorio</span>
              <span aria-hidden>→</span>
            </Link>
            <Link href="/room/demo" className="landing-secondary">
              Ver una sala en vivo
            </Link>
          </div>
        </section>
        <footer className="landing-agents">
          <p>Funciona con</p>
          <ul>
            {AGENTS.map((agent) => (
              <li key={agent}>{agent}</li>
            ))}
          </ul>
        </footer>
      </main>
    </div>
  );
}
