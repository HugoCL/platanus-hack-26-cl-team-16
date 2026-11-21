"use client";

import { Show, SignInButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { MenuIcon, XIcon } from "lucide-react";
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Abrir menú"
        data-size="icon"
        data-variant="ghost"
      >
        <MenuIcon aria-hidden size={20} />
      </DialogTrigger>
      <DialogBackdrop className="transition-opacity duration-300 ease-[var(--ease-out)] data-ending-style:opacity-0 data-ending-style:duration-200 data-starting-style:opacity-0 motion-reduce:transition-none" />
      <DialogContent className="inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-3/4 max-w-sm gap-0 rounded-none border-0 border-r border-border p-0 pt-[env(safe-area-inset-top)] pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-[var(--ease-out)] data-ending-style:-translate-x-full data-ending-style:duration-200 data-starting-style:-translate-x-full motion-reduce:transition-none">
        <div className="flex h-15 items-center justify-between border-b border-border pr-2 pl-5">
          <DialogTitle className="m-0 text-base font-medium">Menú</DialogTitle>
          <DialogClose
            aria-label="Cerrar menú"
            data-size="icon"
            data-variant="ghost"
          >
            <XIcon aria-hidden size={18} />
          </DialogClose>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={close}
              aria-current={item.key === current ? "page" : undefined}
              className={`press flex h-11 items-center rounded-2xl px-3 text-[15px] text-foreground no-underline ${
                item.key === current ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {themeToggle ? (
          <div className="mx-3 flex items-center justify-between border-t border-border px-3 pt-3">
            <span className="text-[15px]">Tema</span>
            <ThemeToggle />
          </div>
        ) : null}
        <Show when="signed-out">
          <div className="mt-auto px-4">
            <SignInButton mode="modal">
              <Button
                data-variant="solid"
                data-size="lg"
                className="press-blur w-full"
                onClick={close}
              >
                Iniciar sesión
              </Button>
            </SignInButton>
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  );
}
