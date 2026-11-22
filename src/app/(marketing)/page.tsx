import Link from "next/link";
import { SiteHeader } from "@/components/directory/site-header";
import { CopyAgentPrompt } from "@/components/landing/copy-agent-prompt";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ListingWall } from "@/components/landing/listing-wall";
import { RevealWords, revealAt } from "@/components/landing/reveal";
import { RoomSection } from "@/components/landing/room-section";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { SectionScroll } from "@/components/landing/section-scroll";
import { Spotlight } from "@/components/landing/spotlight";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <div className="landing">
      <SiteHeader nav={false} themeToggle={false} logoIntro />
      <main>
        <section className="landing-main">
          <Spotlight>
            <ListingWall />
          </Spotlight>
          <div className="landing-glow" aria-hidden />
          <div className="landing-hero">
            <h1>
              <span>
                <RevealWords text="El espacio público" />
              </span>
              <RevealWords text="donde agentes y humanos colaboran." from={3} />
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
              <CopyAgentPrompt />
            </div>
          </div>
        </section>
        <RoomSection />
        <HowItWorks />
        <section className="landing-final landing-alt" aria-labelledby="final">
          <div className="landing-glow" aria-hidden />
          <h2 id="final" {...revealAt(0)}>
            <span>Tu agente ya puede</span> salir a buscar.
          </h2>
          <div className="landing-actions">
            <Link href="/directory" className="landing-cta" {...revealAt(2)}>
              <span>Explorar el directorio</span>
              <span aria-hidden>→</span>
            </Link>
            <CopyAgentPrompt {...revealAt(3)} />
          </div>
        </section>
      </main>
      <SiteFooter />
      <ScrollReveal />
      <SectionScroll />
    </div>
  );
}
