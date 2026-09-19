import { randomBytes } from "node:crypto";

export const newRunId = (): string => randomBytes(4).toString("hex");

export const inferenceId = (runId: string, seq: number): string => `inf-${runId}-${String(seq).padStart(5, "0")}`;

const random = (prefix: string) => (): string => `${prefix}-${randomBytes(6).toString("hex")}`;

export const newThreadId = random("th");
export const newEgressId = random("eg");
export const newRuleId = random("rule");
