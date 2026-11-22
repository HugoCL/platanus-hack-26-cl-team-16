"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { Button } from "@ui-sdk/react/button";
import { useConvexAuth } from "convex/react";
import { Component, type ReactNode } from "react";

export function builderError(error: unknown): string {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? error.data
      : null;
  if (typeof data === "object" && data !== null) {
    if ("kind" in data && data.kind === "RateLimited")
      return "Has hecho varios intentos seguidos. Espera un momento y vuelve a probar.";
    if (
      "message" in data &&
      typeof data.message === "string" &&
      /[áéíóúñ¿¡]|^(No |Usa |Sube |Elige |Escribe |Puedes |Agrega |Oculta |Este |Inicia |La |El )/.test(
        data.message,
      )
    )
      return data.message;
  }
  return "No pudimos completar el cambio. Revisa los datos y tu sesión e inténtalo de nuevo.";
}

class BuilderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="rounded-4xl border border-border bg-card p-8">
          <h2 className="text-xl font-semibold">
            No podemos abrir este agente
          </h2>
          <p className="mt-3 text-subtle-foreground">
            Puede que no exista o que pertenezca a otra cuenta. Inicia sesión
            con la cuenta que lo creó.
          </p>
          <Button className="mt-5" render={<a href="/agents" />}>
            Volver a mis agentes
          </Button>
        </div>
      );
    return this.props.children;
  }
}

export function AgentBuilderAccess({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (!isLoaded) return <p role="status">Cargando tu cuenta…</p>;
  if (!isSignedIn)
    return (
      <section
        className="rounded-4xl border border-border bg-card p-6 sm:p-10"
        aria-label="Inicia sesión para crear tu agente"
      >
        <p className="eyebrow">Tu información, siempre a mano</p>
        <h2 className="mt-5 text-2xl font-semibold">
          Un ayudante que responde por ti
        </h2>
        <p className="mt-3 max-w-xl text-subtle-foreground">
          Un agente es un ayudante virtual que responde preguntas usando la
          información que tú le das. Comparte tu sitio web, un PDF o un texto,
          pruébalo y decide cuándo publicarlo.
        </p>
        <SignInButton mode="modal">
          <Button className="mt-6" data-variant="brand" data-size="lg">
            Iniciar sesión
          </Button>
        </SignInButton>
        <p className="mt-4 text-sm text-subtle-foreground">
          No necesitas saber programar. Empiezas con un borrador que solo tú
          puedes ver.
        </p>
      </section>
    );
  if (isLoading) return <p role="status">Conectando tu cuenta…</p>;
  if (!isAuthenticated)
    return (
      <p className="rounded-4xl border border-border p-6">
        No pudimos verificar tu cuenta. Vuelve a iniciar sesión para administrar
        tus agentes.
      </p>
    );
  return <BuilderBoundary>{children}</BuilderBoundary>;
}
