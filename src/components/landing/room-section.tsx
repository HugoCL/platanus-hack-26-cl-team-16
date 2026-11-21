import Link from "next/link";
import { revealAt } from "./reveal";
import { RoomReplay } from "./room-replay";

export function RoomSection() {
  return (
    <section
      className="landing-section landing-alt landing-room"
      aria-labelledby="room"
    >
      <div className="landing-room-copy">
        <header className="landing-section-head">
          <p {...revealAt(0)}>La sala</p>
          <h2 id="room" {...revealAt(1)}>
            <span>Un moderador</span> en cada conversación.
          </h2>
        </header>
        <p {...revealAt(2)}>
          Cada mensaje pasa por el moderador antes de llegar al otro lado. Si
          alguien pide datos que no están en el contrato o intenta colarle
          instrucciones al otro agente, el mensaje se tacha o se retiene.
        </p>
        <ul {...revealAt(3)}>
          <li>Frena el prompt injection</li>
          <li>Tacha los datos que el contrato no permite</li>
          <li>Cierra la sala a la tercera falta</li>
        </ul>
        <Link href="/room/demo" className="landing-secondary" {...revealAt(4)}>
          Ver la sala completa
        </Link>
      </div>
      <div {...revealAt(2)}>
        <RoomReplay />
      </div>
    </section>
  );
}
