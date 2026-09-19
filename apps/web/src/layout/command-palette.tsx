import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  faultFamily,
  faultLabel,
  healthToFault,
  type DriftInference,
  type DriftReport,
  type IncidentReport,
  type Inference,
  type Lens,
  type QualityReport,
  type SearchFacet,
  type SensorReport,
  type SensorRow,
} from "@tpm/schemas";
import { getDrift, getIncidents, getModelSettings, getQuality, getSensors, keys, searchCorpus, searchRun } from "@/api";
import { SourceKindBadge } from "@/components/knowledge/badges";
import { hitHref, locatorLabel } from "@/components/knowledge/locator";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { capitalize } from "@/lib/format";
import { compileQuery, describeQuery, facetKey, matches, type Searchable } from "@/lib/search-query";
import { screenForStage, screenPath, screens, type ScreenSlug } from "./screens";

type Group = "screens" | "sensors" | "inferences";
type Pair = readonly [SearchFacet["field"], string | null];
type Item = Searchable & { key: string; group: Group; title: string; detail: string; screen: ScreenSlug; hash?: string; icon?: (typeof screens)[number]["icon"] };

const facetsOf = (pairs: Pair[]): Set<string> => new Set(pairs.flatMap(([field, value]) => (value ? [facetKey(field, value)] : [])));
const band = (confidence: number): string | null => (confidence < 0.5 ? "low" : confidence >= 0.8 ? "high" : null);
const lower = (parts: (string | null)[]): string => parts.filter(Boolean).join(" ").toLowerCase();

const driftFacets = (alias: string, drift: DriftInference | undefined): Pair[] => {
  if (!drift) return [];
  const { drifting, responsible, inRange } = drift.value;
  return [
    ["drift", drifting ? "drifting" : null],
    ["drift", responsible === alias ? "responsible" : responsible ? "victim" : null],
    ["drift", drifting && inRange ? "in-range" : null],
  ];
};

function stageFacets(inf: Inference): Pair[] {
  switch (inf.stage) {
    case "health":
      return [["health", inf.value.health], ["faultClass", inf.value.health === "healthy" ? null : healthToFault(inf.value.health)]];
    case "role":
      return [["role", inf.value.role]];
    case "drift":
      return driftFacets(inf.value.sensor, inf);
    case "diagnosis":
      return [["faultClass", inf.value.faultClass], ["family", faultFamily(inf.value.faultClass)], ...inf.value.ranked.map((r): Pair => ["sensor", r.sensor])];
    default:
      return [];
  }
}

const inferenceItem = (inf: Inference, title: string, detail: string): Item => ({
  key: inf.id,
  group: "inferences",
  title,
  detail,
  screen: screenForStage[inf.stage],
  hash: inf.id,
  text: lower([inf.id, inf.sensor, inf.claim, inf.stage, inf.stage === "diagnosis" ? faultLabel(inf.value.faultClass) : null]),
  facets: facetsOf([["kind", "inference"], ["stage", inf.stage], ["sensor", inf.sensor], ["status", inf.status], ["confidence", band(inf.confidence)], ...stageFacets(inf)]),
});

function buildItems(lens: Lens, sensors?: SensorReport, quality?: QualityReport, drift?: DriftReport, incidents?: IncidentReport): Item[] {
  const drifts = new Map((drift?.drifts ?? []).map((d) => [d.value.sensor, d]));
  const screenFacets: Record<ScreenSlug, Pair[]> = {
    sensors: [["kind", "sensor"], ["stage", "role"]],
    quality: [["stage", "health"], ["stage", "rule"], ["stage", "baseline"], ["stage", "calibration"]],
    drift: [["stage", "drift"]],
    diagnosis: [["stage", "diagnosis"]],
    log: [],
    "data-flow": [],
  };
  const sensorItem = (s: SensorRow): Item => ({
    key: s.alias,
    group: "sensors",
    title: s.alias,
    detail: `${s.role}${s.hypothesisName ? `, ${s.hypothesisName}` : ""}`,
    screen: "sensors",
    hash: s.alias,
    text: lower([s.alias, s.hypothesisName, s.role, s.health, s.signalType, s.status]),
    facets: facetsOf([
      ["kind", "sensor"],
      ["sensor", s.alias],
      ["role", s.role],
      ["signalType", s.signalType],
      ["health", s.health],
      ["status", s.status],
      ["confidence", band(s.roleConfidence)],
      ...driftFacets(s.alias, drifts.get(s.alias)),
    ]),
  });
  const roleItem = (s: SensorRow): Item => ({
    key: s.roleInferenceId,
    group: "inferences",
    title: `${s.alias} role: ${s.role}`,
    detail: s.hypothesisName ?? s.signalType,
    screen: "sensors",
    hash: s.roleInferenceId,
    text: lower([s.roleInferenceId, s.alias, s.hypothesisName, s.role, "role"]),
    facets: facetsOf([["kind", "inference"], ["stage", "role"], ["sensor", s.alias], ["role", s.role], ["status", s.status], ["confidence", band(s.roleConfidence)]]),
  });
  return [
    ...screens.map(({ slug, label, icon }): Item => ({ key: slug, group: "screens", title: label(lens), detail: "", screen: slug, icon, text: label(lens).toLowerCase(), facets: facetsOf(screenFacets[slug]) })),
    ...(sensors?.sensors ?? []).map(sensorItem),
    ...(sensors?.sensors ?? []).map(roleItem),
    ...(quality ? [quality.baseline, ...quality.calibration, ...quality.checks] : []).map((inf) => inferenceItem(inf, inf.claim, inf.stage)),
    ...(quality?.rules ?? []).map((rule) => ({
      key: rule.inferenceId,
      group: "inferences" as const,
      title: rule.restated,
      detail: "rule",
      screen: "quality" as const,
      hash: rule.inferenceId,
      text: lower([rule.inferenceId, rule.restated, "rule"]),
      facets: facetsOf([["kind", "inference"], ["stage", "rule"], ["sensor", rule.rule.sensor]]),
    })),
    ...(drift?.drifts ?? []).map((inf) => inferenceItem(inf, inf.claim, "drift")),
    ...(incidents?.incidents ?? []).map((inf) => inferenceItem(inf, inf.claim, "diagnosis")),
  ];
}

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const runId = useActiveRunId();
  const lens = useLens();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const settled = useSettled(text, 500);
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const enabled = open && runId !== null;
  const id = runId ?? "";
  const sensors = useQuery({ queryKey: keys.sensors(id), queryFn: () => getSensors(id), enabled });
  const quality = useQuery({ queryKey: keys.quality(id), queryFn: () => getQuality(id), enabled });
  const drift = useQuery({ queryKey: keys.drift(id), queryFn: () => getDrift(id), enabled });
  const incidents = useQuery({ queryKey: keys.incidents(id), queryFn: () => getIncidents(id), enabled });
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings, enabled: open });

  const items = useMemo(
    () => (runId ? buildItems(lens, sensors.data, quality.data, drift.data, incidents.data) : []),
    [runId, lens, sensors.data, quality.data, drift.data, incidents.data],
  );
  const local = useMemo(() => compileQuery(text), [text]);
  const modelOn = settings.data !== undefined && settings.data.mode !== "off";
  const ask = enabled && modelOn && settled === text && local.unknown.length > 0 && !items.some((item) => matches(item, local.query));
  const model = useQuery({ queryKey: keys.search(id, settled), queryFn: () => searchRun(id, settled), enabled: ask, staleTime: Infinity, retry: false });
  const fromModel = settled === text ? model.data : undefined;
  const corpus = useQuery({ queryKey: keys.corpusSearch(settled), queryFn: () => searchCorpus(settled, 8), enabled: open && settled === text && settled.trim().length >= 3, staleTime: 30_000, retry: false });
  const hits = settled === text ? (corpus.data ?? []) : [];
  const query = fromModel?.query ?? local.query;
  const shown = items.filter((item) => matches(item, query));
  const groups: { group: Group; heading: string }[] = [
    { group: "screens", heading: "Screens" },
    { group: "sensors", heading: capitalize(lens.sensors) },
    { group: "inferences", heading: "Inferences" },
  ];
  const empty =
    runId === null ? (settled.trim().length >= 3 && !corpus.isFetching ? "No match in the knowledge corpus." : "Select a run, or type three or more letters to search the corpus.")
    : settled === text && model.isError ? `No match. Model: ${model.error.message}`
    : !modelOn && local.unknown.length > 0 ? "No match. The model is off. Try words like dead, drifting, actuator, process fault or S07."
    : "No match.";

  const go = (screen: ScreenSlug, hash?: string) => {
    onOpenChange(false);
    if (runId) navigate(screenPath(runId, screen, hash));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump to" description={`Search ${lens.sensors}, inferences and screens`} className="top-[12%] sm:max-w-2xl">
      <Command loop shouldFilter={false}>
        <CommandInput value={text} onValueChange={setText} placeholder={`Search ${lens.sensors}, inferences and screens`} />
        <p aria-live="polite" className="min-h-5 px-3 pt-1 text-xs text-muted-foreground">
          {fromModel ? (
            <>
              Model read: {describeQuery(fromModel.query)}.{" "}
              {fromModel.egressId && (
                <button type="button" className="underline underline-offset-2" onClick={() => go("data-flow", fromModel.egressId ?? undefined)}>
                  Record
                </button>
              )}
            </>
          ) : model.isFetching && ask ? (
            "The model reads the query."
          ) : null}
        </p>
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{empty}</CommandEmpty>
          {hits.length > 0 && (
            <CommandGroup heading="Knowledge">
              {hits.map((hit) => {
                const href = hitHref(hit);
                return (
                  <CommandItem
                    key={`hit-${hit.chunkId}`}
                    value={`hit-${hit.chunkId}`}
                    onSelect={() => {
                      onOpenChange(false);
                      if (href) navigate(href);
                    }}
                    className="items-start"
                  >
                    {hit.sourceKind && <SourceKindBadge value={hit.sourceKind} className="mt-0.5 shrink-0" />}
                    <span className="flex min-w-0 flex-col">
                      <span className="line-clamp-2 text-sm">{hit.snippet}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {hit.sourceTitle}, {locatorLabel(hit.locator)}, {hit.kind}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {groups.map(({ group, heading }) => {
            const rows = shown.filter((item) => item.group === group);
            return rows.length ? (
              <CommandGroup key={group} heading={heading}>
                {rows.map((item) => (
                  <CommandItem key={item.key} value={item.key} onSelect={() => go(item.screen, item.hash)}>
                    {item.icon && <item.icon aria-hidden="true" />}
                    <span className={group === "sensors" ? "font-mono" : "truncate"}>{item.title}</span>
                    {group === "sensors" && <span className="text-muted-foreground">{item.detail}</span>}
                    {group === "inferences" && <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{item.key}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null;
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
