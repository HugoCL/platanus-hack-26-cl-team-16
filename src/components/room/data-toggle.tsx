// Dev-only switch between stress fixtures. Plain links so the choice lives in the URL.
export function DataToggle({
  datasets,
  current,
}: {
  datasets: Record<string, { label: string }>;
  current: string;
}) {
  const [first] = Object.keys(datasets);
  return (
    <nav
      aria-label="Datos de prueba"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-full bg-neutral-200 p-0.5 font-sans text-xs shadow"
    >
      {Object.entries(datasets).map(([key, { label }]) => (
        <a
          key={key}
          href={key === first ? "?" : `?data=${key}`}
          aria-current={key === current ? "page" : undefined}
          className="whitespace-nowrap rounded-full px-3 py-1 !text-neutral-700 !no-underline aria-[current=page]:bg-white aria-[current=page]:!text-neutral-950"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
