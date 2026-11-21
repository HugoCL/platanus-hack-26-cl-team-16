"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";

export function HeaderAccount() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button data-variant="solid" className="press-blur">
            Iniciar sesión
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
