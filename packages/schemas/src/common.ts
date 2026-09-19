import { z } from "zod";

export const Alias = z.string().regex(/^S\d{2,4}$/);
export type Alias = z.infer<typeof Alias>;

export const Window = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  n: z.number().int().nonnegative(),
});
export type Window = z.infer<typeof Window>;

export const TimeBase = z.object({
  t0: z.number().nullable(),
  dt: z.number().positive().nullable(),
  n: z.number().int().nonnegative(),
});
export type TimeBase = z.infer<typeof TimeBase>;

export const SignalType = z.enum(["constant", "binary", "state", "counter", "step", "slow", "fast"]);
export type SignalType = z.infer<typeof SignalType>;

export const Role = z.enum([
  "setpoint",
  "controlled",
  "actuator",
  "redundant",
  "upstream",
  "downstream",
  "counter",
  "state",
  "unknown",
]);
export type Role = z.infer<typeof Role>;

export const HealthClass = z.enum([
  "dropout",
  "dead",
  "stuck",
  "spikes",
  "saturated",
  "noisy",
  "timebase",
  "resolution",
]);
export type HealthClass = z.infer<typeof HealthClass>;

export const FaultClass = z.enum([
  "sensor-dropout",
  "sensor-dead",
  "sensor-stuck",
  "sensor-spikes",
  "sensor-saturated",
  "sensor-noisy",
  "sensor-drift",
  "sensor-drift-bias",
  "sensor-drift-gain",
  "sensor-drift-hidden",
  "data-timebase",
  "data-resolution",
  "data-logging",
  "process-degradation",
  "process-slow-degradation",
  "process-step",
  "process-oscillation",
]);
export type FaultClass = z.infer<typeof FaultClass>;

export type FaultFamily = "sensor" | "process" | "data";

export function faultFamily(fc: FaultClass): FaultFamily {
  return fc.split("-")[0] as FaultFamily;
}

const faultKindLabel: Record<FaultClass, string> = {
  "sensor-dropout": "dropout",
  "sensor-dead": "dead",
  "sensor-stuck": "stuck",
  "sensor-spikes": "spikes",
  "sensor-saturated": "saturated",
  "sensor-noisy": "noisy",
  "sensor-drift": "drift",
  "sensor-drift-bias": "drift (bias)",
  "sensor-drift-gain": "drift (gain)",
  "sensor-drift-hidden": "drift hidden by the control loop",
  "data-timebase": "timebase",
  "data-resolution": "resolution change",
  "data-logging": "logging",
  "process-degradation": "degradation",
  "process-slow-degradation": "slow degradation",
  "process-step": "step shift",
  "process-oscillation": "oscillation",
};

const familyLabel: Record<FaultFamily, string> = { sensor: "Sensor fault", process: "Process fault", data: "Data fault" };

export function faultLabel(fc: FaultClass): string {
  return `${familyLabel[faultFamily(fc)]}: ${faultKindLabel[fc]}`;
}

export function healthToFault(h: HealthClass): FaultClass {
  return h === "timebase" || h === "resolution" ? (`data-${h}` as FaultClass) : (`sensor-${h}` as FaultClass);
}

export const InferenceStatus = z.enum(["proposed", "accepted", "questioned", "revised", "overridden"]);
export type InferenceStatus = z.infer<typeof InferenceStatus>;

export const Domain = z.enum(["stream", "records"]);
export type Domain = z.infer<typeof Domain>;

export const Lens = z.object({
  domain: Domain,
  sensor: z.string(),
  sensors: z.string(),
  plant: z.string(),
  operator: z.string(),
});
export type Lens = z.infer<typeof Lens>;

export const lenses: Record<Domain, Lens> = {
  stream: { domain: "stream", sensor: "sensor", sensors: "sensors", plant: "plant", operator: "operator" },
  records: { domain: "records", sensor: "field", sensors: "fields", plant: "source", operator: "analyst" },
};
