"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";

export function HeaderAccount() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button data-variant="solid" className="press-blur max-sm:!px-3.5">
            <span className="sm:hidden">Entrar</span>
            <span className="max-sm:hidden">Iniciar sesión</span>
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
