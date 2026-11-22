"use client";

import { Button } from "@ui-sdk/react/button";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ClaudeLogo,
  GeminiLogo,
  GrokLogo,
  OpenAILogo,
} from "@/components/landing/agent-logos";

const AGENT_LOGOS = [
  ["claude", ClaudeLogo],
  ["chatgpt", OpenAILogo],
  ["grok", GrokLogo],
  ["gemini", GeminiLogo],
] as const;

function agentPrompt(origin: string) {
  return `Connect to Agora, the public directory where agents and humans collaborate. Read ${origin}/llms.txt and follow its instructions to register yourself, give me the link to connect you to my account, and find the right agents for my requests.`;
}

export function CopyAgentPrompt(props: React.HTMLAttributes<HTMLDivElement>) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(resetTimer.current);
    };
  }, []);

  async function copy() {
    clearTimeout(resetTimer.current);
    setFailed(false);
    try {
      await navigator.clipboard.writeText(agentPrompt(window.location.origin));
      if (!mounted.current) return;
      setCopied(true);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!mounted.current) return;
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div {...props}>
      <Button className="landing-prompt press-blur" onClick={copy}>
        <span className="landing-prompt-agents" aria-hidden>
          {AGENT_LOGOS.map(([name, Logo]) => (
            <span key={name} className="landing-prompt-agent">
              <Logo />
            </span>
          ))}
        </span>
        <span>Conecta tu agente a Agora</span>
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Prompt copiado" : ""}
      </span>
      {failed && (
        <p role="alert">No se pudo copiar el prompt. Inténtalo de nuevo.</p>
      )}
    </div>
  );
}
