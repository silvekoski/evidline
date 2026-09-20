import { ActivityIcon, ListChecksIcon, ScrollTextIcon, ShieldCheckIcon, StethoscopeIcon, TrendingUpIcon } from "lucide-react";
import type { Lens, Purpose, Stage } from "@tpm/schemas";
import { capitalize } from "@/lib/format";

export type ScreenSlug = "sensors" | "quality" | "drift" | "diagnosis" | "log" | "data-flow";

export const defaultRunId = "c84b5c33";

export const screens: { slug: ScreenSlug; label: (lens: Lens) => string; icon: typeof ActivityIcon; group: "run" | "system" }[] = [
  { slug: "sensors", label: (lens) => capitalize(lens.sensors), icon: ActivityIcon, group: "run" },
  { slug: "quality", label: () => "Quality", icon: ListChecksIcon, group: "run" },
  { slug: "drift", label: () => "Drift", icon: TrendingUpIcon, group: "run" },
  { slug: "diagnosis", label: () => "Diagnosis", icon: StethoscopeIcon, group: "run" },
  { slug: "log", label: () => "Log", icon: ScrollTextIcon, group: "system" },
  { slug: "data-flow", label: () => "Data flow", icon: ShieldCheckIcon, group: "system" },
];

export const screenForStage: Record<Stage, ScreenSlug> = {
  baseline: "quality",
  health: "quality",
  calibration: "quality",
  rule: "quality",
  role: "sensors",
  drift: "drift",
  diagnosis: "diagnosis",
};

export const screenForPurpose: Partial<Record<Purpose, ScreenSlug>> = { name_role: "sensors", check_name: "sensors", compile_rule: "quality", explain_diagnosis: "diagnosis", cross_review: "diagnosis" };

export const screenPath = (runId: string, slug: ScreenSlug, hash?: string) => ({ pathname: `/runs/${runId}/${slug}`, hash: hash ? `#${hash}` : "" });
