import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ModelMode, ModelSettings } from "@tpm/schemas";
import { keys, setModelMode } from "@/api";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type OnMode = Exclude<ModelMode, "off">;

const envHint: Record<OnMode, string> = {
  cloud: "TPM_AZURE_ENDPOINT, TPM_AZURE_KEY and TPM_AZURE_DEPLOYMENT",
  local: "TPM_OLLAMA_HOST and TPM_OLLAMA_MODEL",
};

export function ModelModeCard({ settings, plant }: { settings: ModelSettings; plant: string }) {
  const queryClient = useQueryClient();
  const [lastOn, setLastOn] = useState<OnMode>("cloud");
  const mode = settings.mode;
  const onMode: OnMode = mode === "off" ? lastOn : mode;
  const mutation = useMutation({
    mutationFn: setModelMode,
    onSuccess: (next) => {
      queryClient.setQueryData(keys.modelSettings, next);
      void queryClient.invalidateQueries({ queryKey: ["egress"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success(next.mode === "off" ? "Model off" : `Model on, ${next.mode}`, {
        description: next.mode === "off" ? "Each output still works from its text template." : "Records of the newest run get a model call.",
      });
    },
  });
  const provider = settings.provider;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Model</CardTitle>
        <CardDescription>The engine decides every number and fault class. The model only names and explains.</CardDescription>
        <CardAction className="flex items-center gap-2">
          <Label htmlFor="model-switch">{mode === "off" ? "Off" : "On"}</Label>
          <Switch id="model-switch" checked={mode !== "off"} disabled={mutation.isPending} onCheckedChange={(checked) => mutation.mutate(checked ? onMode : "off")} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={onMode}
          onValueChange={(value) => {
            if (value !== "local" && value !== "cloud") return;
            setLastOn(value);
            if (mode !== "off") mutation.mutate(value);
          }}
          aria-label="Provider mode"
        >
          <ToggleGroupItem value="local">local</ToggleGroupItem>
          <ToggleGroupItem value="cloud">cloud</ToggleGroupItem>
        </ToggleGroup>
        {mode === "off" ? (
          <p className="text-xs text-muted-foreground">No call leaves the {plant}. The gateway writes an off record with the payload, and a text template gives the answer.</p>
        ) : provider === null ? (
          <p className="text-xs text-muted-foreground">
            The {mode} mode has no provider. Set {envHint[mode]} in the server environment. Until then, each call writes an error record and the text template gives the answer.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Provider</dt>
            <dd>{provider.name}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-mono">{provider.model}</dd>
            <dt className="text-muted-foreground">Region</dt>
            <dd>{provider.region ?? "none"}</dd>
            <dt className="text-muted-foreground">Host</dt>
            <dd className="font-mono break-all">{provider.host}</dd>
          </dl>
        )}
        {mode === "cloud" && (
          <p className="text-xs text-muted-foreground">
            Reviewers:{" "}
            {settings.reviewers.length === 0 ? (
              "none. Set TPM_REVIEW_KEY in the server environment for a cross review."
            ) : (
              <>
                {settings.reviewers.length} {settings.reviewers.length === 1 ? "model" : "models"} on{" "}
                <span className="font-mono">{[...new Set(settings.reviewers.map((r) => r.host))].join(", ")}</span>:{" "}
                <span className="font-mono">{settings.reviewers.map((r) => r.model).join(", ")}</span>
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
