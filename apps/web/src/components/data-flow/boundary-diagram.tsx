import { stageNames, type EgressTotals, type ModelSettings } from "@tpm/schemas";
import { capitalize, formatBytes } from "@/lib/format";

const stages = stageNames.filter((name) => name !== "Model calls");
const stageTop = 62;
const stageStep = 13;
const arrowY = 124;

export function BoundaryDiagram({ totals, settings, plant }: { totals: EgressTotals; settings: ModelSettings; plant: string }) {
  const host = settings.provider?.host.replace(/^https?:\/\//, "") ?? null;
  const modelLine = settings.mode === "off" ? "off, no host" : (host ?? `${settings.mode}, no provider`);
  const hosts = totals.hosts.length === 0 ? "No host received data." : `Hosts that received data: ${totals.hosts.join(", ")}.`;
  const summary = `Raw data, ${formatBytes(totals.rawBytes)}, stays in the ${plant}, where every pipeline stage runs. Only summaries pass through the egress gateway: ${formatBytes(totals.sentBytes)} in ${totals.sent.toLocaleString("en-US")} sent ${totals.sent === 1 ? "call" : "calls"}. ${hosts} The model is ${settings.mode === "off" ? "off" : `on, ${settings.mode}`}.`;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox="0 0 640 220" role="img" aria-labelledby="boundary-title boundary-desc" className="h-auto w-full max-w-3xl text-[10px]">
        <title id="boundary-title">Data boundary</title>
        <desc id="boundary-desc">{summary}</desc>
        <defs>
          <marker id="data-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        <rect x="8" y="8" width="384" height="204" rx="8" className="fill-none stroke-muted-foreground" strokeWidth="1" />
        <text x="20" y="28" className="fill-foreground text-xs font-medium">
          {capitalize(plant)}
        </text>
        <text x="20" y="42" className="fill-muted-foreground">
          raw data stays here, <tspan className="font-mono">{formatBytes(totals.rawBytes)}</tspan>
        </text>
        <line x1="26" y1={stageTop - 6} x2="26" y2={stageTop + (stages.length - 1) * stageStep - 3} className="stroke-muted-foreground" strokeWidth="1" />
        {stages.map((name, i) => {
          const y = stageTop + i * stageStep;
          return (
            <g key={name}>
              <circle cx="26" cy={y - 3.5} r="2.5" className="fill-muted-foreground" />
              <text x="34" y={y} className="fill-foreground">
                {i + 1} {name}
              </text>
            </g>
          );
        })}
        <line x1="150" y1={arrowY} x2="212" y2={arrowY} className="stroke-muted-foreground" strokeWidth="1" strokeDasharray="2 3" markerEnd="url(#data-flow-arrow)" />
        <text x="178" y={arrowY - 8} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          summaries only
        </text>
        <rect x="216" y="100" width="168" height="48" rx="6" className="fill-none stroke-muted-foreground" strokeWidth="1" />
        <text x="300" y="120" textAnchor="middle" className="fill-foreground text-[11px] font-medium">
          Egress gateway
        </text>
        <text x="300" y="135" textAnchor="middle" className="fill-muted-foreground text-[9px]">
          seven guards, one record per call
        </text>
        <line x1="384" y1={arrowY} x2="476" y2={arrowY} className="stroke-muted-foreground" strokeWidth="1" markerEnd="url(#data-flow-arrow)" />
        <text x="426" y={arrowY - 8} textAnchor="middle" className="fill-muted-foreground">
          <tspan className="font-mono">{formatBytes(totals.sentBytes)}</tspan> sent
        </text>
        <text x="426" y={arrowY + 16} textAnchor="middle" className="fill-muted-foreground">
          {totals.hosts.length === 1 ? "one host" : `${totals.hosts.length} hosts`}
        </text>
        <rect x="480" y="100" width="152" height="48" rx="6" className="fill-none stroke-muted-foreground" strokeWidth="1" />
        <text x="556" y="120" textAnchor="middle" className="fill-foreground text-[11px] font-medium">
          Model
        </text>
        <text x="556" y="135" textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
          {modelLine.length > 27 ? `${modelLine.slice(0, 26)}…` : modelLine}
        </text>
      </svg>
      <figcaption className="text-xs text-muted-foreground">{summary}</figcaption>
    </figure>
  );
}
