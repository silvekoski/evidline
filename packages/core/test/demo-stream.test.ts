import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSource } from "@tpm/adapters";
import { faultFamily } from "@tpm/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { runPipeline, type PipelineResult } from "../src/pipeline";
import { createMemorySink, type MemorySink } from "../src/types";

type Truth = {
  rows: number;
  episodes: { fault: number; from: number; to: number }[];
  faults: { kind: "bias" | "dead"; alias: string; from: number }[];
  process: { onset: number; episodeStart: number };
};

const csv = fileURLToPath(new URL("../../../data/demo-stream.csv", import.meta.url));
const truthPath = csv.replace(/\.csv$/, ".truth.json");
const driftClasses = ["sensor-drift", "sensor-drift-bias", "sensor-drift-gain"];

describe.skipIf(!existsSync(csv) || !existsSync(truthPath))("demo stream", () => {
  let truth: Truth;
  let dead: Truth["faults"][number];
  let ramp: Truth["faults"][number];
  let normalEnd: number;
  let sink: MemorySink;
  let result: PipelineResult;
  let elapsed = 0;

  beforeAll(async () => {
    truth = JSON.parse(readFileSync(truthPath, "utf8")) as Truth;
    dead = truth.faults.find((f) => f.kind === "dead")!;
    ramp = truth.faults.find((f) => f.kind === "bias")!;
    normalEnd = Math.min(...truth.episodes.filter((e) => e.fault !== 0).map((e) => e.from));
    const source = await loadSource(csv);
    expect(source.grid.n).toBe(truth.rows);
    expect(source.grid.episodes).toHaveLength(truth.episodes.length);
    sink = createMemorySink("0123abcd");
    const started = performance.now();
    result = runPipeline(source.grid, sink);
    elapsed = performance.now() - started;
    const drift = result.drifts.find((d) => d.value.sensor === ramp.alias)!;
    const process = result.incidents.find((i) => faultFamily(i.value.faultClass) === "process");
    console.log(JSON.stringify({
      pipelineMs: Math.round(elapsed),
      driftSensor: ramp.alias,
      driftOnset: drift.value.onset,
      driftOnsetDelay: drift.value.onset === null ? null : drift.value.onset - ramp.from,
      driftAlarmDelay: drift.value.detectionDelay,
      processOnset: process?.value.onset ?? null,
      processOnsetDelay: process?.value.onset == null ? null : process.value.onset - truth.process.onset,
    }));
  }, 120_000);

  it("runs the pipeline under 60 s", () => {
    expect(elapsed).toBeLessThan(60_000);
    expect(result.baseline.value.window.to).toBeLessThanOrEqual(dead.from);
  });

  it("gives a sensor-dead incident for the dead sensor", () => {
    const incident = result.incidents.find((i) => i.value.excluded.length === 1 && i.value.excluded[0] === dead.alias && i.value.ranked.length === 0)!;
    expect(incident.value.faultClass).toBe("sensor-dead");
    expect(incident.value.onset).toBeGreaterThanOrEqual(dead.from - 320);
    expect(incident.value.onset).toBeLessThanOrEqual(dead.from + 320);
  });

  it("gives a sensor-drift incident with the ramp sensor responsible, ranked first and in range", () => {
    const drift = result.drifts.find((d) => d.value.sensor === ramp.alias)!;
    expect(drift.value.drifting).toBe(true);
    expect(drift.value.responsible).toBe(ramp.alias);
    expect(drift.value.inRange).toBe(true);
    expect(drift.value.onset).toBeGreaterThanOrEqual(ramp.from - 320);
    expect(drift.value.onset).toBeLessThan(truth.process.onset);
    const incident = result.incidents.find((i) => i.value.ranked[0]?.sensor === ramp.alias)!;
    expect(driftClasses).toContain(incident.value.faultClass);
    expect(incident.value.excluded).toContain(dead.alias);
    expect(incident.value.ranked.reduce((s, r) => s + r.contribution, 0)).toBeCloseTo(1, 9);
  });

  it("gives a process fault incident for the fault 13 episode with an onset within 300 samples of the truth", () => {
    const process = result.incidents.filter((i) => faultFamily(i.value.faultClass) === "process");
    expect(process.length).toBeGreaterThanOrEqual(1);
    const near = process.find((i) => i.value.onset !== null && Math.abs(i.value.onset - truth.process.onset) <= 300)!;
    expect(near).toBeDefined();
    expect(near.value.ranked.length).toBeGreaterThanOrEqual(3);
    expect(near.value.ranked.map((r) => r.sensor)).not.toContain(dead.alias);
  });

  it("has no other dead or drift sensor incident on the normal episodes", () => {
    const others = result.incidents.filter(
      (i) =>
        (i.value.faultClass === "sensor-dead" || driftClasses.includes(i.value.faultClass)) &&
        i.value.onset !== null &&
        i.value.onset < normalEnd &&
        i.value.ranked[0]?.sensor !== ramp.alias &&
        !(i.value.ranked.length === 0 && i.value.excluded[0] === dead.alias),
    );
    expect(others.map((i) => `${i.value.faultClass} ${i.value.ranked[0]?.sensor ?? i.value.excluded[0]} at ${i.value.onset}`)).toEqual([]);
  });

  it("cites evidence that exists in every incident trace", () => {
    const byId = new Map(sink.evidence.map((e) => [e.id, e]));
    for (const incident of result.incidents) {
      for (const step of incident.value.trace) {
        for (const id of step.evidenceIds) expect(byId.has(id), id).toBe(true);
        for (const [key, value] of Object.entries(step.stats)) {
          expect(step.evidenceIds.some((id) => byId.get(id)!.stats[key] === value), `${step.test}.${key}`).toBe(true);
        }
      }
    }
  });
});
