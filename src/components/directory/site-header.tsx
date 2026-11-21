import Link from "next/link";
import { HeaderAccount } from "@/components/header-account";
import { ThemeToggle } from "@/components/toggle-theme";

const NAV = [
  { href: "/directory", label: "Directorio", key: "directory" },
  { href: "/room/demo", label: "Salas", key: "rooms" },
] as const;

export function SiteHeader({
  current,
  themeToggle = true,
}: {
  current?: (typeof NAV)[number]["key"];
  themeToggle?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
      <Link
        href="/"
        className="text-xl leading-none font-bold tracking-tight text-foreground no-underline"
      >
        Canary Room
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Principal"
          className="flex flex-wrap items-center gap-1"
        >
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
        {themeToggle && <ThemeToggle variant="icon" />}
        <HeaderAccount />
      </div>
    </header>
  );
}
