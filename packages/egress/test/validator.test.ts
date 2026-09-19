import type { Evidence } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { validateProse, validateReview } from "../src/index";
import { evidenceId, reviewPayload } from "./fixtures";

const chart = { type: "line" as const, window: { from: 12000, to: 20000, n: 8000 }, series: [] };
const evidence: Evidence[] = [
  {
    id: evidenceId(1),
    runId: "0123abcd",
    kind: "health",
    sensors: ["S05"],
    window: { from: 12000, to: 20000, n: 8000 },
    method: "run-length",
    stats: { runLength: 6400, threshold: 40.25, ratio: 0.123456 },
    verdict: "dead",
    chart,
  },
  {
    id: evidenceId(2),
    runId: "0123abcd",
    kind: "structure",
    sensors: ["S05", "S03"],
    window: { from: 0, to: 9000, n: 9000 },
    method: "pca",
    stats: { spe: 12.3456, contribution: 0.98 },
    verdict: "one sensor",
    chart,
  },
];
const ctx = { evidence, aliases: ["S03", "S04", "S05"], faultClass: "sensor-dead" as const };

describe("validateProse", () => {
  it("accepts faithful sentences", () => {
    const result = validateProse(
      [
        { text: "Sensor fault: dead.", evidenceIds: [evidenceId(1)] },
        { text: "S05 held one value for 6400 samples, far above the limit of 40.3 (ratio 0.123).", evidenceIds: [evidenceId(1)] },
        { text: "S05 carries 0.98 of the residual (SPE 12.3) in the window from 0 to 9000.", evidenceIds: [evidenceId(2)] },
        { text: "The engine excluded S05 and kept S03, see ev-0123abcd-00001.", evidenceIds: [evidenceId(1), evidenceId(2)] },
      ],
      ctx,
    );
    expect(result).toMatchObject({ pass: true, errors: [] });
    expect(result.sentences).toHaveLength(4);
  });

  it("rejects a number that is not in the cited evidence", () => {
    const result = validateProse(
      [
        { text: "Sensor fault: dead.", evidenceIds: [evidenceId(1)] },
        { text: "S05 held one value for 6500 samples.", evidenceIds: [evidenceId(1)] },
        { text: "S05 carries 0.98 of the residual.", evidenceIds: [evidenceId(1)] },
        { text: "The ratio is 0.1236.", evidenceIds: [evidenceId(1)] },
      ],
      ctx,
    );
    expect(result.pass).toBe(false);
    expect(result.errors).toEqual([
      "sentence 2 has the number 6500 that is not in the cited evidence",
      "sentence 3 has the number 0.98 that is not in the cited evidence",
      "sentence 4 has the number 0.1236 that is not in the cited evidence",
    ]);
  });

  it("rejects an unknown alias, a missing evidence id and an uncited sentence", () => {
    const result = validateProse(
      [
        { text: "Sensor fault: dead.", evidenceIds: [evidenceId(1)] },
        { text: "S09 looks similar.", evidenceIds: [evidenceId(1)] },
        { text: "S05 is dead.", evidenceIds: [evidenceId(7)] },
        { text: "S05 is dead.", evidenceIds: [] },
      ],
      ctx,
    );
    expect(result.errors).toEqual([
      "sentence 2 names the unknown alias S09",
      `sentence 3 cites the unknown evidence id ${evidenceId(7)}`,
      "sentence 4 cites no evidence",
    ]);
  });

  it("rejects a wrong, missing or repeated fault label", () => {
    const wrong = validateProse(
      [{ text: "Process fault: degradation. S05 held one value for 6400 samples.", evidenceIds: [evidenceId(1)] }],
      ctx,
    );
    expect(wrong.errors).toEqual([
      'the fault label "Sensor fault: dead" appears 0 times, expected once',
      'the text names the wrong fault label "Process fault: degradation"',
    ]);
    const missing = validateProse([{ text: "S05 held one value for 6400 samples.", evidenceIds: [evidenceId(1)] }], ctx);
    expect(missing.errors).toEqual(['the fault label "Sensor fault: dead" appears 0 times, expected once']);
    const twice = validateProse([{ text: "Sensor fault: dead. Sensor fault: dead.", evidenceIds: [evidenceId(1)] }], ctx);
    expect(twice.errors).toEqual(['the fault label "Sensor fault: dead" appears 2 times, expected once']);
    const bias = validateProse([{ text: "Sensor fault: drift.", evidenceIds: [evidenceId(1)] }], {
      ...ctx,
      faultClass: "sensor-drift-bias",
    });
    expect(bias.errors).toEqual([
      'the fault label "Sensor fault: drift (bias)" appears 0 times, expected once',
      'the text names the wrong fault label "Sensor fault: drift"',
    ]);
  });
});

describe("validateReview", () => {
  const response = { faultClass: "sensor-dead" as const, confidence: 0.8, summary: "S05 held 6400 identical samples against a limit of 40.", concerns: ["Step 0 covers n 8000 only."] };

  it("accepts a review that uses payload aliases, numbers and its own label", () => {
    const summary = "Sensor fault: dead. S05 held 6400 identical samples against a limit of 40.";
    expect(validateReview({ ...response, summary }, reviewPayload)).toEqual({ pass: true, errors: [] });
  });

  it("rejects a foreign alias, a foreign number and a different label", () => {
    const result = validateReview({ ...response, summary: "S09 held 6500 samples.", concerns: ["Process fault: degradation fits S05 better."] }, reviewPayload);
    expect(result.pass).toBe(false);
    expect(result.errors).toEqual([
      "the summary names the unknown alias S09",
      "the summary has the number 6500 that is not in the payload",
      'concern 1 names the fault label "Process fault: degradation" that differs from the reviewer\'s own class',
    ]);
  });
});
