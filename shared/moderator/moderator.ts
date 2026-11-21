import type {
  ModerationEvent,
  ModerationReason,
  ModerationReasonCode,
  Moderator,
  Verdict,
  VerdictRule,
} from "../moderation";
import type { LlmProvider } from "../providers/llm";
import { conversationJudge, type JudgeDecision, messageJudge } from "./judge";
import { checkRules } from "./rules";

export const MODERATOR_TIMEOUT_MS = 3000;

const JUDGE_BLOCK = {
  purpose: {
    code: "off_purpose",
    reason: "El mensaje no sirve al propósito de la sala.",
  },
  scope: {
    code: "forbidden_topic",
    reason: "El mensaje pide u ofrece algo fuera del alcance del contrato.",
  },
  injection: {
    code: "prompt_injection",
    reason:
      "El mensaje intenta manipular a otro agente o cambiar sus instrucciones.",
  },
  sensitive_data: {
    code: "data_leak",
    reason:
      "El mensaje pide o entrega datos sensibles que el contrato no contempla.",
  },
} as const satisfies Record<
  VerdictRule,
  { code: ModerationReasonCode; reason: string }
>;

const JUDGE_ALLOW_REASON = "El mensaje sirve al propósito de la sala.";

class JudgeTimeout extends Error {}

export function createModerator({
  llm,
  model,
  conversationModel,
  timeoutMs = MODERATOR_TIMEOUT_MS,
  beforeJudge,
}: {
  llm: LlmProvider;
  model?: string;
  conversationModel?: string;
  timeoutMs?: number;
  beforeJudge?: () => Promise<void>;
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

      const runJudge = async (
        run: typeof messageJudge,
        stage: "injection" | "purpose",
        model?: string,
      ) => {
        await beforeJudge?.();
        const started = Date.now();
        for (let retry = false; ; retry = true) {
          let attemptStarted = false;
          let verdict: Verdict;
          let reasons: ModerationReason[];
          try {
            if (retry) await beforeJudge?.();
            attemptStarted = true;
            const decision = await withTimeout(
              (signal) => run(llm, input, signal),
              timeoutMs,
            );
            verdict = publicVerdict(decision);
            reasons =
              decision.decision === "block"
                ? [
                    {
                      code: JUDGE_BLOCK[decision.rule].code,
                      stage,
                      detail: JUDGE_BLOCK[decision.rule].reason,
                    },
                  ]
                : [];
          } catch (error) {
            const timedOut = error instanceof JudgeTimeout;
            if (timedOut && !retry) continue;
            verdict = {
              decision: "block",
              rule: "purpose",
              reason: timedOut
                ? "El moderador no respondió a tiempo; el mensaje se bloqueó."
                : "El moderador falló; el mensaje se bloqueó.",
            };
            reasons = [
              {
                code: "moderator_error",
                stage,
                detail: timedOut
                  ? `El juez no respondió en ${2 * timeoutMs} ms.`
                  : attemptStarted
                    ? "El juez falló o devolvió una respuesta inválida."
                    : "No se pudo iniciar el reintento del juez.",
              },
            ];
          }
          return {
            verdict,
            event: {
              stage,
              action: verdict.decision,
              reasons,
              model,
              latencyMs: Date.now() - started,
            },
          };
        }
      };
      const [message, conversation] = await Promise.all([
        runJudge(messageJudge, "injection", model),
        runJudge(conversationJudge, "purpose", conversationModel),
      ]);
      return {
        verdict:
          message.verdict.decision === "block"
            ? message.verdict
            : conversation.verdict,
        events: [deterministic, message.event, conversation.event],
      };
    },
  };
}

function publicVerdict(decision: JudgeDecision): Verdict {
  if (decision.decision === "allow") {
    return { decision: "allow", reason: JUDGE_ALLOW_REASON };
  }
  return {
    decision: "block",
    rule: decision.rule,
    reason: JUDGE_BLOCK[decision.rule].reason,
  };
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new JudgeTimeout());
          controller.abort();
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
