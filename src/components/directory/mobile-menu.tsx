"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "@/components/toggle-theme";

export function MobileMenu({
  items,
  current,
  themeToggle,
}: {
  items: readonly { href: string; label: string; key: string }[];
  current?: string;
  themeToggle: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        aria-label="Abrir menú"
        data-size="icon"
        data-variant="ghost"
      >
        <MenuIcon aria-hidden size={20} />
      </DrawerTrigger>
      <DrawerBackdrop className="bg-[var(--ui-overlay)]" />
      <DrawerContent className="!gap-2 rounded-t-[var(--sm-radius-4xl)] !px-4 !pt-3 !pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div
          aria-hidden
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-input"
        />
        <DrawerTitle className="sr-only">Menú</DrawerTitle>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={close}
              aria-current={item.key === current ? "page" : undefined}
              className={`press flex h-12 items-center rounded-2xl px-4 text-base text-foreground no-underline ${
                item.key === current ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {themeToggle ? (
          <div className="flex h-12 items-center justify-between border-t border-border px-4 pt-2">
            <span className="text-base">Tema</span>
            <ThemeToggle />
          </div>
        ) : null}
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button
              data-variant="solid"
              data-size="xl"
              className="press-blur mt-2 w-full"
              onClick={close}
            >
              Iniciar sesión
            </Button>
          </SignInButton>
        </Show>
      </DrawerContent>
    </Drawer>
  );
}
