"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";

export function HeaderAccount() {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <Button data-variant="solid" className="press-blur">
            Iniciar sesión
          </Button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
