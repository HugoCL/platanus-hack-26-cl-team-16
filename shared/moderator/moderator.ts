import type {
  ModerationEvent,
  ModerationReason,
  ModerationReasonCode,
  Moderator,
  Verdict,
  VerdictRule,
} from "../moderation";
import type { LlmProvider } from "../providers/llm";
import { judge } from "./judge";
import { checkRules } from "./rules";

export const MODERATOR_TIMEOUT_MS = 3000;

const JUDGE_REASON_CODE = {
  purpose: "off_purpose",
  scope: "forbidden_topic",
  injection: "prompt_injection",
  sensitive_data: "data_leak",
} as const satisfies Record<VerdictRule, ModerationReasonCode>;

class JudgeTimeout extends Error {}

export function createModerator({
  llm,
  model,
  timeoutMs = MODERATOR_TIMEOUT_MS,
}: {
  llm: LlmProvider;
  model?: string;
  timeoutMs?: number;
}): Moderator {
  return {
    async moderate(input) {
      const findings = checkRules(input);
      const deterministic: ModerationEvent = {
        stage: "deterministic",
        action: findings.length > 0 ? "block" : "allow",
        reasons: findings.map(({ code, detail }) => ({
          code,
          stage: "deterministic",
          detail,
        })),
      };
      if (findings.length > 0) {
        const [first] = findings;
        return {
          verdict: {
            decision: "block",
            rule: first.rule,
            reason: first.detail,
          },
          events: [deterministic],
        };
      }

      const started = Date.now();
      let verdict: Verdict;
      let reasons: ModerationReason[];
      try {
        verdict = await withTimeout(judge(llm, input), timeoutMs);
        reasons =
          verdict.decision === "block"
            ? [
                {
                  code: JUDGE_REASON_CODE[verdict.rule],
                  stage: "purpose",
                  detail: verdict.reason,
                },
              ]
            : [];
      } catch (error) {
        verdict = {
          decision: "block",
          rule: "purpose",
          reason:
            error instanceof JudgeTimeout
              ? "El moderador no respondió a tiempo; el mensaje se bloqueó."
              : "El moderador falló; el mensaje se bloqueó.",
        };
        const detail = error instanceof Error ? error.message : String(error);
        reasons = [
          {
            code: "moderator_error",
            stage: "purpose",
            detail: detail.slice(0, 500),
          },
        ];
      }
      return {
        verdict,
        events: [
          deterministic,
          {
            stage: "purpose",
            action: verdict.decision,
            reasons,
            model,
            latencyMs: Date.now() - started,
          },
        ],
      };
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new JudgeTimeout(`Sin respuesta del juez en ${ms} ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
