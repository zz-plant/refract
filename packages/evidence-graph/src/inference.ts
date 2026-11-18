export type InferenceBoundary = "revert" | "sentence_similarity" | "heuristic" | "template_signal" | "activity_spike";

export interface InferenceRequest {
  boundary: InferenceBoundary;
  input: Record<string, unknown>;
}

export interface InferenceResult {
  boundary: InferenceBoundary;
  /** Empty when a model's reply held no answer the prompt allows; `note` then says so. */
  output: Record<string, unknown>;
  /**
   * Set only by a default rule, as a fixed number per rule, not a measurement.
   * A model result has none: the prompt asks for a bare answer, so the model
   * reports no confidence, and Refract does not invent one.
   */
  confidence?: number;
  source: "model" | "default";
  /** The model's reply, verbatim. Set on every model result, so the reading of it can be checked. */
  answer?: string;
  /** The model that answered, as the provider or MCP client named it. */
  model?: string;
  /** Why `output` is empty. */
  note?: string;
}

export interface RevertInput {
  comment: string;
}

export interface RevertOutput {
  isRevert: boolean;
  rationale?: string;
}

export interface SentenceSimilarityInput {
  before: string;
  after: string;
}

export interface SentenceSimilarityOutput {
  isSameClaim: boolean;
  /** The word-overlap ratio the default rule measured. A model measures none, so a model result omits it. */
  matchRatio?: number;
  rationale?: string;
}

export interface HeuristicInput {
  comment: string;
  sizeDelta: number;
}

export interface HeuristicOutput {
  kind: string;
  rationale?: string;
}

export interface TemplateSignalInput {
  templateName: string;
}

export interface TemplateSignalOutput {
  signalType: string;
  rationale?: string;
}

export interface ActivitySpikeInput {
  dailyCounts: Record<string, number>;
  movingAverage: number;
  threshold: number;
  candidateDay: string;
}

export interface ActivitySpikeOutput {
  isSpike: boolean;
  rationale?: string;
}

export function buildInferencePrompt(boundary: InferenceBoundary, input: Record<string, unknown>): string {
  switch (boundary) {
    case "revert": {
      const i = input as unknown as RevertInput;
      return [
        `Does this edit comment indicate a revert? Answer only "yes" or "no".`,
        ``,
        `Edit comment: ${i.comment}`,
      ].join("\n");
    }
    case "sentence_similarity": {
      const i = input as unknown as SentenceSimilarityInput;
      return [
        `Are these two sentences the same claim? Answer only "yes" or "no".`,
        ``,
        `Before: ${i.before}`,
        `After:  ${i.after}`,
      ].join("\n");
    }
    case "heuristic": {
      const i = input as unknown as HeuristicInput;
      return [
        `Classify this edit by type. Answer with a single word: revert, vandalism, sourcing, major_addition, major_removal, cosmetic, minor, or unknown.`,
        ``,
        `Edit comment: ${i.comment}`,
        `Size change: ${i.sizeDelta} bytes`,
      ].join("\n");
    }
    case "template_signal": {
      const i = input as unknown as TemplateSignalInput;
      return [
        `What policy signal does this Wikipedia template represent? Answer with a single word: citation, neutrality, blp, dispute, cleanup, protection, or other.`,
        ``,
        `Template: {{${i.templateName}}}`,
      ].join("\n");
    }
    case "activity_spike": {
      const i = input as unknown as ActivitySpikeInput;
      return [
        `Is this day's talk page activity a meaningful spike, or is it normal variation? Answer only "yes" or "no".`,
        ``,
        `Day: ${i.candidateDay}`,
        `Edits on this day: ${i.dailyCounts[i.candidateDay] ?? 0}`,
        `Moving average: ${i.movingAverage.toFixed(1)}`,
        `Threshold (3x moving average): ${i.threshold.toFixed(1)}`,
      ].join("\n");
    }
  }
}

// The answers each prompt above allows, and the output field each fills.
const YES_NO: Record<string, boolean> = { yes: true, no: false };
const HEURISTIC_KINDS = [
  "revert",
  "vandalism",
  "sourcing",
  "major_addition",
  "major_removal",
  "cosmetic",
  "minor",
  "unknown",
];
const TEMPLATE_SIGNALS = ["citation", "neutrality", "blp", "dispute", "cleanup", "protection", "other"];

/**
 * Read a model's reply to buildInferencePrompt. The reply must begin with an
 * answer the prompt allows, ignoring case and any punctuation or markdown
 * before it: "Yes.", "**no**" and "major_addition" are read; "I think yes" and
 * "not a revert" are not, since the prompts ask for the answer alone. A reply
 * that does not begin with one leaves `output` empty and says so in `note`,
 * rather than guessing.
 *
 * The result carries the reply as `answer` and, when known, the `model` that
 * gave it. It has no `confidence`: the model reports none.
 */
export function parseInferenceResponse(
  boundary: InferenceBoundary,
  text: string,
  _input: Record<string, unknown>,
  model?: string,
): InferenceResult {
  const first = text.toLowerCase().match(/[a-z_]+/)?.[0] ?? "";
  const allowed =
    boundary === "heuristic"
      ? HEURISTIC_KINDS
      : boundary === "template_signal"
        ? TEMPLATE_SIGNALS
        : Object.keys(YES_NO);

  const read = allowed.includes(first);
  let output: Record<string, unknown> = {};
  if (read) {
    switch (boundary) {
      case "revert":
        output = { isRevert: YES_NO[first] };
        break;
      case "sentence_similarity":
        output = { isSameClaim: YES_NO[first] };
        break;
      case "heuristic":
        output = { kind: first };
        break;
      case "template_signal":
        output = { signalType: first };
        break;
      case "activity_spike":
        output = { isSpike: YES_NO[first] };
        break;
    }
  }

  return {
    boundary,
    output,
    source: "model",
    answer: text,
    ...(model ? { model } : {}),
    ...(read ? {} : { note: `The reply does not begin with ${allowed.join(", ")}, so no answer was read from it.` }),
  };
}
