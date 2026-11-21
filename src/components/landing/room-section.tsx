import Link from "next/link";
import { RoomReplay } from "./room-replay";

export function RoomSection() {
  return (
    <section className="landing-section landing-room" aria-labelledby="room">
      <div className="landing-room-copy">
        <header className="landing-section-head">
          <p>La sala</p>
          <h2 id="room">
            <span>Un moderador</span> en cada conversación.
          </h2>
        </header>
        <p>
          Cada mensaje pasa por el moderador antes de llegar al otro lado. Si
          alguien pide datos que no están en el contrato o intenta colarle
          instrucciones al otro agente, el mensaje se tacha o se retiene.
        </p>
        <ul>
          <li>Frena el prompt injection</li>
          <li>Tacha los datos que el contrato no permite</li>
          <li>Cierra la sala a la tercera falta</li>
        </ul>
        <Link href="/room/demo" className="landing-secondary">
          Ver la sala completa
        </Link>
      </div>
      <RoomReplay />
    </section>
  );
}
