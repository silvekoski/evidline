import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { getDrift, getIncidents, getQuality, getSensors, keys } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { capitalize } from "@/lib/format";
import { screenForStage, screenPath, screens, type ScreenSlug } from "./screens";

type Item = { id: string; title: string; detail: string; screen: ScreenSlug };

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
  const enabled = open && runId !== null;
  const id = runId ?? "";
  const sensors = useQuery({ queryKey: keys.sensors(id), queryFn: () => getSensors(id), enabled });
  const quality = useQuery({ queryKey: keys.quality(id), queryFn: () => getQuality(id), enabled });
  const drift = useQuery({ queryKey: keys.drift(id), queryFn: () => getDrift(id), enabled });
  const incidents = useQuery({ queryKey: keys.incidents(id), queryFn: () => getIncidents(id), enabled });

  const inferences: Item[] = [
    ...(sensors.data?.sensors ?? []).map((s) => ({ id: s.roleInferenceId, title: `${s.alias} role: ${s.role}`, detail: s.hypothesisName ?? s.signalType, screen: screenForStage.role })),
    ...(quality.data ? [quality.data.baseline, ...quality.data.calibration, ...quality.data.checks] : []).map((inf) => ({ id: inf.id, title: inf.claim, detail: inf.stage, screen: screenForStage[inf.stage] })),
    ...(quality.data?.rules ?? []).map((rule) => ({ id: rule.inferenceId, title: rule.restated, detail: "rule", screen: screenForStage.rule })),
    ...(drift.data?.drifts ?? []).map((inf) => ({ id: inf.id, title: inf.claim, detail: "drift", screen: screenForStage.drift })),
    ...(incidents.data?.incidents ?? []).map((inf) => ({ id: inf.id, title: inf.claim, detail: "diagnosis", screen: screenForStage.diagnosis })),
  ];

  const go = (screen: ScreenSlug, hash?: string) => {
    onOpenChange(false);
    if (runId) navigate(screenPath(runId, screen, hash));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump to" description={`Search ${lens.sensors}, inferences and screens`} className="sm:max-w-lg">
      <Command loop>
        <CommandInput placeholder={`Search ${lens.sensors}, inferences and screens`} />
        <CommandList>
          <CommandEmpty>{runId ? "No match." : "Select a run first."}</CommandEmpty>
          {runId && (
            <CommandGroup heading="Screens">
              {screens.map(({ slug, label, icon: Icon }) => (
                <CommandItem key={slug} value={`screen ${label(lens)}`} onSelect={() => go(slug)}>
                  <Icon aria-hidden="true" />
                  {label(lens)}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {sensors.data?.sensors.length ? (
            <CommandGroup heading={capitalize(lens.sensors)}>
              {sensors.data.sensors.map((s) => (
                <CommandItem key={s.alias} value={`${s.alias} ${s.role} ${s.hypothesisName ?? ""} ${s.health}`} onSelect={() => go("sensors", s.alias)}>
                  <span className="font-mono">{s.alias}</span>
                  <span className="text-muted-foreground">
                    {s.role}
                    {s.hypothesisName ? `, ${s.hypothesisName}` : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {inferences.length ? (
            <CommandGroup heading="Inferences">
              {inferences.map((item) => (
                <CommandItem key={item.id} value={`${item.id} ${item.title} ${item.detail}`} onSelect={() => go(item.screen, item.id)}>
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
