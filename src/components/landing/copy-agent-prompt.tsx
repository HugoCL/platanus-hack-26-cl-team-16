"use client";

import { Button } from "@ui-sdk/react/button";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(agentPrompt(window.location.origin));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
    </div>
  );
}
