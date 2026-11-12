import { classifyHeuristic, revertDetector } from "@refract-org/analyzers";
import type { InferenceBoundary, InferenceResult } from "@refract-org/evidence-graph";
import { buildInferencePrompt, parseInferenceResponse } from "@refract-org/evidence-graph";

export interface InferenceProvider {
  infer(boundary: InferenceBoundary, input: Record<string, unknown>): Promise<InferenceResult>;
}

export const INFERENCE_BOUNDARIES = [
  "revert",
  "sentence_similarity",
  "heuristic",
  "template_signal",
  "activity_spike",
] as const satisfies readonly InferenceBoundary[];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function lexicalSimilarity(before: string, after: string): number {
  const left = tokenize(before);
  const right = tokenize(after);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function defaultInference(boundary: InferenceBoundary, input: Record<string, unknown>): InferenceResult {
  switch (boundary) {
    case "revert": {
      // The rule `refract analyze` applies when it emits revert_detected. This
      // used the edit-type heuristic's wider pattern, so the two disagreed on
      // summaries such as "rv".
      const isRevert = revertDetector.isRevert(asString(input.comment));
      return {
        boundary,
        output: { isRevert },
        confidence: isRevert ? 0.85 : 0.6,
        source: "default",
      };
    }
    case "heuristic": {
      const kind = classifyHeuristic(asString(input.comment), asNumber(input.sizeDelta));
      return {
        boundary,
        output: { kind },
        confidence: kind === "unknown" ? 0.5 : 0.85,
        source: "default",
      };
    }
    case "sentence_similarity": {
      const matchRatio = lexicalSimilarity(asString(input.before), asString(input.after));
      return {
        boundary,
        output: { isSameClaim: matchRatio >= 0.8, matchRatio },
        confidence: matchRatio >= 0.8 || matchRatio <= 0.2 ? 0.75 : 0.55,
        source: "default",
      };
    }
    case "template_signal": {
      const templateName = asString(input.templateName).toLowerCase();
      const signalType =
        [
          ["citation", /\b(cn|citation|cite|source|ref)\b/],
          ["neutrality", /\b(npov|neutral|pov)\b/],
          ["blp", /\b(blp|living)\b/],
          ["dispute", /\b(dispute|controversy|contested)\b/],
          ["cleanup", /\b(cleanup|copyedit|tone|style)\b/],
          ["protection", /\b(protect|semi-protected|locked)\b/],
        ].find(([, pattern]) => (pattern as RegExp).test(templateName))?.[0] ?? "other";
      return { boundary, output: { signalType }, confidence: signalType === "other" ? 0.5 : 0.8, source: "default" };
    }
    case "activity_spike": {
      const dailyCounts = input.dailyCounts && typeof input.dailyCounts === "object" ? input.dailyCounts : {};
      const candidateDay = asString(input.candidateDay);
      const current = asNumber((dailyCounts as Record<string, unknown>)[candidateDay]);
      const threshold = asNumber(input.threshold);
      return {
        boundary,
        output: { isSpike: current >= threshold && threshold > 0 },
        confidence: threshold > 0 ? 0.8 : 0.5,
        source: "default",
      };
    }
  }
}

/**
 * OpenAI-compatible REST provider — works with any API that exposes a
 * /chat/completions endpoint (OpenAI, DeepSeek, Ollama, Anthropic via
 * API proxy, local OpenAI-compatible servers, etc.).
 *
 * Configure via --endpoint and --model flags, or environment variables:
 *   REFRACT_INFERENCE_ENDPOINT   (default: https://api.openai.com/v1/chat/completions)
 *   REFRACT_INFERENCE_API_KEY
 *   REFRACT_INFERENCE_MODEL      (default: gpt-4o-mini)
 *
 * Examples:
 *   DeepSeek:     --endpoint https://api.deepseek.com/v1/chat/completions --model deepseek-chat
 *   Ollama:       --endpoint http://localhost:11434/v1/chat/completions --model llama3
 *   Anyscale:     --endpoint https://api.endpoints.anyscale.com/v1/chat/completions
 *   Together:     --endpoint https://api.together.xyz/v1/chat/completions
 */
export class OpenAICompatibleProvider implements InferenceProvider {
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor(opts: { endpoint?: string; apiKey?: string; model?: string }) {
    this.endpoint = opts.endpoint ?? "https://api.openai.com/v1/chat/completions";
    this.apiKey = opts.apiKey ?? "";
    this.model = opts.model ?? "gpt-4o-mini";
  }

  async infer(boundary: InferenceBoundary, input: Record<string, unknown>): Promise<InferenceResult> {
    if (this.apiKey) {
      // Built only for a model call: the prompt reads fields the default rule
      // treats as optional, and threw on `classify activity_spike --input '{}'`.
      const prompt = buildInferencePrompt(boundary, input);
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 64,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Inference provider error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return parseInferenceResponse(boundary, text, input);
    }

    return defaultInference(boundary, input);
  }
}
