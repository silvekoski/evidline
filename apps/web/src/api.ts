import {
  ActionResponse,
  ActivateRuleResponse,
  CompileRuleResult,
  CreateRunResponse,
  DriftReport,
  EgressRecord,
  EgressTotals,
  Evidence,
  EvidenceSeries,
  FileEntry,
  FileList,
  IncidentReport,
  Inference,
  LogEntry,
  LogVerification,
  ModelSettings,
  QualityReport,
  Run,
  RunEvent,
  RunList,
  SensorDetail,
  SensorReport,
  TemplateInfo,
  ThreadEntry,
  type ModelMode,
  type OverrideValue,
} from "@tpm/schemas";

const base = "/api";

type Parser<T> = { parse(input: unknown): T };

async function request<T>(schema: Parser<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return schema.parse(await res.json());
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string; message?: string };
    return body.error ?? body.message ?? `${res.status} ${res.statusText}`;
  } catch {
    return text || `${res.status} ${res.statusText}`;
  }
}

function post(body?: unknown): RequestInit {
  return body === undefined
    ? { method: "POST" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const arrayOf = <T>(item: Parser<T>): Parser<T[]> => ({
  parse(input) {
    if (!Array.isArray(input)) throw new Error("expected an array");
    return input.map((x) => item.parse(x));
  },
});

const nothing: Parser<void> = { parse: () => undefined };

export const keys = {
  files: ["files"] as const,
  runs: ["runs"] as const,
  run: (id: string) => ["runs", id] as const,
  sensors: (runId: string) => ["runs", runId, "sensors"] as const,
  sensor: (runId: string, alias: string) => ["runs", runId, "sensors", alias] as const,
  quality: (runId: string) => ["runs", runId, "quality"] as const,
  drift: (runId: string) => ["runs", runId, "drift"] as const,
  incidents: (runId: string) => ["runs", runId, "incidents"] as const,
  evidence: (id: string) => ["evidence", id] as const,
  evidenceSeries: (id: string) => ["evidence", id, "series"] as const,
  inference: (id: string) => ["inferences", id] as const,
  inferenceHead: (id: string) => ["inferences", id, "head"] as const,
  thread: (id: string) => ["inferences", id, "thread"] as const,
  log: (runId?: string) => ["log", runId ?? "all"] as const,
  logVerify: ["log", "verify"] as const,
  egress: (runId?: string) => ["egress", runId ?? "all"] as const,
  egressTotals: (runId?: string) => ["egress", "totals", runId ?? "all"] as const,
  egressTemplates: ["egress", "templates"] as const,
  egressRecord: (id: string) => ["egress", "record", id] as const,
  modelSettings: ["settings", "model"] as const,
};

const runQuery = (runId?: string) => (runId ? `?runId=${encodeURIComponent(runId)}` : "");

export const listFiles = () => request(FileList, "/files");
export const uploadFile = (file: File) =>
  request(FileEntry, "/files", { method: "POST", headers: { "x-file-name": file.name }, body: file });
export const createRun = (path: string) => request(CreateRunResponse, "/runs", post({ path }));
export const listRuns = () => request(RunList, "/runs");
export const getRun = (id: string) => request(Run, `/runs/${id}`);
export const getSensors = (runId: string) => request(SensorReport, `/runs/${runId}/sensors`);
export const getSensor = (runId: string, alias: string) => request(SensorDetail, `/runs/${runId}/sensors/${alias}`);
export const getQuality = (runId: string) => request(QualityReport, `/runs/${runId}/quality`);
export const getDrift = (runId: string) => request(DriftReport, `/runs/${runId}/drift`);
export const getIncidents = (runId: string) => request(IncidentReport, `/runs/${runId}/incidents`);
export const runModelCalls = (runId: string) => request(nothing, `/runs/${runId}/model-calls`, post());
export const getEvidence = (id: string) => request(Evidence, `/evidence/${id}`);
export const getEvidenceSeries = (id: string) => request(EvidenceSeries, `/evidence/${id}/series`);
export const getInference = (id: string) => request(Inference, `/inferences/${id}`);
export const getInferenceHead = (id: string) => request(Inference, `/inferences/${id}/head`);
export const getThread = (id: string) => request(arrayOf(ThreadEntry), `/inferences/${id}/thread`);
export const acceptInference = (id: string) => request(ActionResponse, `/inferences/${id}/accept`, post());
export const questionInference = (id: string, text: string) =>
  request(ActionResponse, `/inferences/${id}/question`, post({ text }));
export const overrideInference = (id: string, value: OverrideValue, reason: string) =>
  request(ActionResponse, `/inferences/${id}/override`, post({ value, reason }));
export const compileRule = (runId: string, sentence: string) =>
  request(CompileRuleResult, "/rules/compile", post({ runId, sentence }));
export const activateRule = (id: string) => request(ActivateRuleResponse, `/rules/${id}/activate`, post());
export const getLog = (runId?: string) => request(arrayOf(LogEntry), `/log${runQuery(runId)}`);
export const verifyLog = () => request(LogVerification, "/log/verify");
export const logExportUrl = (format: "json" | "csv") => `${base}/log/export?format=${format}`;
export const getEgress = (runId?: string) => request(arrayOf(EgressRecord), `/egress${runQuery(runId)}`);
export const getEgressTotals = (runId?: string) => request(EgressTotals, `/egress/totals${runQuery(runId)}`);
export const getEgressTemplates = () => request(TemplateInfo, "/egress/templates");
export const getEgressRecord = (id: string) => request(EgressRecord, `/egress/${id}`);
export const getModelSettings = () => request(ModelSettings, "/settings/model");
export const setModelMode = (mode: ModelMode) =>
  request(ModelSettings, "/settings/model", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });

export function subscribeRunEvents(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(`${base}/runs/${runId}/events`);
  const handle = (event: Event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
    let parsed: ReturnType<typeof RunEvent.safeParse>;
    try {
      parsed = RunEvent.safeParse(JSON.parse(event.data));
    } catch {
      return;
    }
    if (!parsed.success) return;
    onEvent(parsed.data);
    if (parsed.data.type === "done") source.close();
  };
  source.onmessage = handle;
  for (const name of ["stage", "run", "done", "error"]) source.addEventListener(name, handle);
  return () => source.close();
}
