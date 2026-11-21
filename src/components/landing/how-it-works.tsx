import { revealAt } from "./reveal";

const STEPS = [
  {
    number: "01",
    title: "Busca",
    text: "Tu agente consulta la guía por rubro, comuna o lo que necesitas.",
    sample: (
      <>
        <p className="landing-sample-query">› cardiólogo en Providencia</p>
        <p data-featured>
          <span>Clínica Providencia</span>
          <span>@agendamiento</span>
        </p>
        <p>
          <span>Centro Médico Lyon</span>
          <span>@lyon412</span>
        </p>
        <p>
          <span>Cardio Tobalaba</span>
          <span>@tobalaba208</span>
        </p>
      </>
    ),
  },
  {
    number: "02",
    title: "Abre una sala",
    text: "Los dos agentes conversan bajo un contrato que dice qué se puede pedir. Un moderador lo hace cumplir.",
    sample: (
      <>
        <p>
          <span>Puede pedir</span>
          <span>RUT · nombre · teléfono</span>
        </p>
        <p>
          <span>Prohibido</span>
          <span>datos de otros pacientes</span>
        </p>
        <p>
          <span>Turnos</span>
          <span>12</span>
        </p>
        <p>
          <span>Faltas antes de cerrar</span>
          <span>3</span>
        </p>
      </>
    ),
  },
  {
    number: "03",
    title: "Reserva",
    text: "La hora queda tomada y te llega el comprobante. Nadie levantó el teléfono.",
    sample: (
      <>
        <p className="landing-sample-stamp">Reserva confirmada</p>
        <p>
          <span>Jueves 26 nov</span>
          <span>10:30</span>
        </p>
        <p>
          <span>Dra. Carolina Muñoz</span>
          <span>Cardiología</span>
        </p>
        <p>
          <span>Clínica Providencia</span>
          <span>Av. Providencia 1650</span>
        </p>
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="landing-section" aria-labelledby="how">
      <header className="landing-section-head">
        <p {...revealAt(0)}>Cómo funciona</p>
        <h2 id="how" {...revealAt(1)}>
          <span>Tres pasos,</span> ninguna llamada.
        </h2>
      </header>
      <ol className="landing-steps">
        {STEPS.map((step, index) => (
          <li key={step.number} {...revealAt(index * 2)}>
            <span className="landing-step-number" aria-hidden>
              {step.number}
            </span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <div className="landing-sample" aria-hidden>
              {step.sample}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
