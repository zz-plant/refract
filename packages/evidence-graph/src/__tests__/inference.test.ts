import { describe, expect, it } from "vitest";
import { parseInferenceResponse } from "../inference.js";

describe("parseInferenceResponse", () => {
  it("reports the reply and the model, and no confidence or ratio the model never gave", () => {
    const result = parseInferenceResponse("sentence_similarity", "Yes.", { before: "a", after: "b" }, "some-model");

    expect(result).toEqual({
      boundary: "sentence_similarity",
      output: { isSameClaim: true },
      source: "model",
      answer: "Yes.",
      model: "some-model",
    });
  });

  it("reads the first word of the reply, past case, punctuation and markdown", () => {
    const isSameClaim = (reply: string) => parseInferenceResponse("sentence_similarity", reply, {}).output.isSameClaim;

    expect(isSameClaim("yes")).toBe(true);
    expect(isSameClaim("**No**")).toBe(false);
    expect(isSameClaim("  YES, they state the same thing")).toBe(true);
  });

  it("reads no answer from a reply that does not begin with one, and says so", () => {
    // "I think yes" contains "yes"; it was read as a confident no, since the
    // answer came from the first letter and the confidence from any "yes".
    const result = parseInferenceResponse("sentence_similarity", "I think yes", {});

    expect(result.output).toEqual({});
    expect(result.answer).toBe("I think yes");
    expect(result.note).toContain("yes, no");
    expect(result).not.toHaveProperty("confidence");
  });

  it("does not take a label that only appears later in the reply", () => {
    // "not a revert" was read as kind "revert".
    expect(parseInferenceResponse("heuristic", "not a revert, a minor fix", {}).output).toEqual({});
    expect(parseInferenceResponse("heuristic", "major_addition", {}).output).toEqual({ kind: "major_addition" });
    expect(parseInferenceResponse("template_signal", "Neutrality", {}).output).toEqual({ signalType: "neutrality" });
  });

  it("fills each boundary's own output field", () => {
    expect(parseInferenceResponse("revert", "yes", {}).output).toEqual({ isRevert: true });
    expect(parseInferenceResponse("activity_spike", "no", {}).output).toEqual({ isSpike: false });
  });
});
