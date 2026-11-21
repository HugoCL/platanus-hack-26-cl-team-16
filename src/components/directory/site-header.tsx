import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { AgoraMark } from "@/components/agora-mark";
import { HeaderAccount } from "@/components/header-account";
import { ThemeToggle } from "@/components/toggle-theme";
import { MobileMenu } from "./mobile-menu";

const NAV = [
  { href: "/directory", label: "Directorio", key: "directory" },
  { href: "/room", label: "Salas", key: "rooms" },
] as const;

export function SiteHeader({
  current,
  nav = true,
  themeToggle = true,
}: {
  current?: (typeof NAV)[number]["key"];
  nav?: boolean;
  themeToggle?: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-6 border-b border-border px-4 py-3 sm:px-6">
      <div className="flex items-center gap-1">
        {nav && (
          <div className="-ml-2 sm:hidden">
            <MobileMenu
              items={NAV}
              current={current}
              themeToggle={themeToggle}
            />
          </div>
        )}
        <Link
          href="/"
          className="inline-flex items-baseline gap-[0.28cap] font-logo text-2xl leading-none font-semibold text-foreground no-underline"
        >
          <AgoraMark className="h-[0.85cap] w-[0.92cap] shrink-0" />
          agora
        </Link>
      </div>
      <div className="sm:hidden">
        {nav ? (
          <Show when="signed-in">
            <UserButton />
          </Show>
        ) : (
          <HeaderAccount />
        )}
      </div>
      <div className="flex items-center gap-2 max-sm:hidden">
        {nav && (
          <nav aria-label="Principal" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.key === current ? "page" : undefined}
                className={`inline-flex h-9 items-center rounded-2xl px-3.5 text-foreground no-underline ${
                  item.key === current
                    ? "bg-muted font-medium"
                    : "text-subtle-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        {themeToggle && <ThemeToggle variant="icon" />}
        <HeaderAccount />
      </div>
    </header>
  );
}
