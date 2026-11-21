import Link from "next/link";

const NAV = [
  { href: "/directory", label: "Directorio", key: "directory" },
  { href: "/room/demo", label: "Salas", key: "rooms" },
] as const;

export function SiteHeader({
  current,
}: {
  current?: (typeof NAV)[number]["key"];
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
      <Link
        href="/"
        className="font-display text-2xl leading-none font-extrabold italic tracking-tight text-foreground no-underline"
      >
        [nombre].
      </Link>
      <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
        {NAV.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === current ? "page" : undefined}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-foreground no-underline ${
              item.key === current
                ? "bg-muted font-medium"
                : "text-subtle-foreground hover:bg-muted"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
