import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDrift, getIncidents, getQuality, getSensors, keys } from "@/api";
import { screenForStage, type ScreenSlug } from "@/layout/screens";

export function useInferenceScreens(runId: string): Map<string, ScreenSlug> {
  const enabled = runId !== "";
  const sensors = useQuery({ queryKey: keys.sensors(runId), queryFn: () => getSensors(runId), enabled });
  const quality = useQuery({ queryKey: keys.quality(runId), queryFn: () => getQuality(runId), enabled });
  const drift = useQuery({ queryKey: keys.drift(runId), queryFn: () => getDrift(runId), enabled });
  const incidents = useQuery({ queryKey: keys.incidents(runId), queryFn: () => getIncidents(runId), enabled });

  return useMemo(() => {
    const screens = new Map<string, ScreenSlug>();
    for (const s of sensors.data?.sensors ?? []) {
      screens.set(s.roleInferenceId, screenForStage.role);
      screens.set(s.healthInferenceId, screenForStage.health);
      if (s.driftInferenceId) screens.set(s.driftInferenceId, screenForStage.drift);
    }
    if (quality.data) {
      for (const inf of [quality.data.baseline, ...quality.data.calibration, ...quality.data.checks]) screens.set(inf.id, screenForStage[inf.stage]);
      for (const rule of quality.data.rules) screens.set(rule.inferenceId, screenForStage.rule);
    }
    for (const inf of drift.data?.drifts ?? []) screens.set(inf.id, screenForStage.drift);
    for (const inf of incidents.data?.incidents ?? []) screens.set(inf.id, screenForStage.diagnosis);
    return screens;
  }, [sensors.data, quality.data, drift.data, incidents.data]);
}
