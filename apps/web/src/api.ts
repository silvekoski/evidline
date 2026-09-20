import {
  ActionResponse,
  ActivateRuleResponse,
  CatalogColumnList,
  ClaimList,
  Claim,
  ColumnKnowledge,
  ConnectorList,
  Connector,
  CorpusStats,
  DataSpec,
  JobList,
  JobSummary,
  OpenQuestionList,
  SearchHitList,
  SourceDetail,
  SourceList,
  Source,
  TextEgressList,
  UnassignedList,
  UploadLink,
  WorkspaceList,
  Workspace,
  type ClaimStatus,
  type CreateConnectorBody,
  type CreateWorkspaceBody,
  type PatchWorkspaceBody,
  MeetingGapList,
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
  Notification,
  NotificationList,
  NotificationSettings,
  NotificationTestResult,
  type NotificationSettingsBody,
  LaneReport,
  QualityReport,
  ReviewReport,
  NameCheckReport,
  NameCheckJob,
  Run,
  RunEvent,
  RunList,
  SearchResult,
  SensorDetail,
  SensorReport,
  TemplateCatalog,
  ThreadEntry,
  type ModelMode,
  type OverrideValue,
} from "@tpm/schemas";

export const workspaceSlug = (pathname: string = window.location.pathname): string | null => /^\/w\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(pathname)?.[1] ?? null;

export const apiBase = (): string => {
  const slug = workspaceSlug();
  return slug ? `/api/w/${slug}` : "/api";
};

type Parser<T> = { parse(input: unknown): T };

async function request<T>(schema: Parser<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return schema.parse(res.status === 204 ? undefined : await res.json());
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
  lanes: (runId: string) => ["runs", runId, "lanes"] as const,
  drift: (runId: string) => ["runs", runId, "drift"] as const,
  incidents: (runId: string) => ["runs", runId, "incidents"] as const,
  search: (runId: string, text: string) => ["runs", runId, "search", text] as const,
  evidence: (id: string) => ["evidence", id] as const,
  evidenceSeries: (id: string) => ["evidence", id, "series"] as const,
  inference: (id: string) => ["inferences", id] as const,
  inferenceHead: (id: string) => ["inferences", id, "head"] as const,
  nameChecks: (id: string) => ["inferences", id, "name-checks"] as const,
  nameCheckStatus: (runId: string) => ["runs", runId, "name-checks"] as const,
  thread: (id: string) => ["inferences", id, "thread"] as const,
  reviews: (id: string) => ["inferences", id, "reviews"] as const,
  log: (runId?: string) => ["log", runId ?? "all"] as const,
  logVerify: ["log", "verify"] as const,
  egress: (runId?: string) => ["egress", runId ?? "all"] as const,
  egressTotals: (runId?: string) => ["egress", "totals", runId ?? "all"] as const,
  egressTemplates: ["egress", "templates"] as const,
  egressRecord: (id: string) => ["egress", "record", id] as const,
  modelSettings: ["settings", "model"] as const,
  notifications: ["notifications"] as const,
  notificationSettings: ["settings", "notifications"] as const,
  workspaces: ["workspaces"] as const,
  corpusStats: ["knowledge", "stats"] as const,
  sources: (filter: string) => ["sources", filter] as const,
  source: (id: number) => ["sources", id] as const,
  sourceClaims: (id: number) => ["sources", id, "claims"] as const,
  sourceBlobText: (id: number) => ["sources", id, "blob-text"] as const,
  corpusSearch: (query: string) => ["knowledge", "search", query] as const,
  columns: ["columns"] as const,
  columnKnowledge: (name: string) => ["columns", name, "knowledge"] as const,
  claims: ["claims"] as const,
  openQuestions: ["open-questions"] as const,
  spec: ["spec"] as const,
  connectors: ["connectors"] as const,
  jobs: ["jobs"] as const,
  jobSummary: ["jobs", "summary"] as const,
  textEgress: ["egress-log"] as const,
  unassigned: ["unassigned"] as const,
  connectorGaps: (id: number) => ["connectors", id, "gaps"] as const,
};

const runQuery = (runId?: string) => (runId ? `?runId=${encodeURIComponent(runId)}` : "");

const patch = (body: unknown): RequestInit => ({ method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const files = (list: File[]): RequestInit => {
  const body = new FormData();
  for (const file of list) body.append("files", file);
  return { method: "POST", body };
};

async function rootRequest<T>(schema: Parser<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return schema.parse(res.status === 204 ? undefined : await res.json());
}

export const listWorkspaces = () => rootRequest(WorkspaceList, "/workspaces");
export const createWorkspace = (body: CreateWorkspaceBody) => rootRequest(Workspace, "/workspaces", post(body));
export const patchWorkspace = (slug: string, body: PatchWorkspaceBody) => rootRequest(Workspace, `/workspaces/${slug}`, patch(body));
export const listUnassigned = () => rootRequest(UnassignedList, "/unassigned");
export const assignUnassigned = (id: number, workspace: string) => rootRequest(nothing, `/unassigned/${id}/assign`, post({ workspace }));
export const uploadThroughLink = (token: string, list: File[]) => rootRequest(arrayOf(Source), `/upload/${token}`, files(list));

export const getCorpusStats = () => request(CorpusStats, "/knowledge/stats");
export const listSources = (query: string) => request(SourceList, `/sources${query ? `?${query}` : ""}`);
export const getSource = (id: number) => request(SourceDetail, `/sources/${id}`);
export const getSourceClaims = (id: number) => request(ClaimList, `/sources/${id}/claims`);
export const sourceBlobUrl = (id: number) => `${apiBase()}/sources/${id}/blob`;
export async function getSourceBlobText(id: number): Promise<string> {
  const res = await fetch(sourceBlobUrl(id));
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.text();
}
export const sourcePageUrl = (id: number, page: number) => `${apiBase()}/sources/${id}/pages/${page}`;
export const uploadSources = (list: File[]) => request(arrayOf(Source), "/sources/upload", files(list));
export const reprocessSource = (id: number) => request(Source, `/sources/${id}/reprocess`, post());
export const deleteSource = (id: number) => request(nothing, `/sources/${id}`, { method: "DELETE" });
export const createUploadLink = (hours: number) => request(UploadLink, "/upload-links", post({ hours }));
export const searchCorpus = (query: string, limit = 20) => request(SearchHitList, "/search", post({ query, limit }));
export const listColumns = () => request(CatalogColumnList, "/columns");
export const getColumnKnowledge = (name: string) => request(ColumnKnowledge, `/columns/${encodeURIComponent(name)}/knowledge`);
export const listClaims = () => request(ClaimList, "/claims");
export const setClaimStatus = (id: number, status: ClaimStatus) => request(Claim, `/claims/${id}`, patch({ status }));
export const setLinkConfirmed = (id: number, confirmed: boolean) => request(Claim, `/claim-links/${id}`, patch({ confirmed }));
export const addClaimLink = (claimId: number, columnId: number) => request(Claim, `/claims/${claimId}/links`, post({ columnId }));
export const listOpenQuestions = () => request(OpenQuestionList, "/open-questions");
export const answerQuestion = (columnId: number, body: { speaker: string; text: string }) => request(Claim, `/columns/${columnId}/answer`, post(body));
export const buildSpec = () => request(DataSpec, "/spec", post());
export const listConnectors = () => request(ConnectorList, "/connectors");
export const createConnector = (body: CreateConnectorBody) => request(Connector, "/connectors", post(body));
export const syncConnector = (id: number) => request(Connector, `/connectors/${id}/sync`, post());
export const deleteConnector = (id: number) => request(nothing, `/connectors/${id}`, { method: "DELETE" });
export const connectorGaps = (id: number, days = 30) => request(MeetingGapList, `/connectors/${id}/gaps?days=${days}`);
export const importAliases = (csv: string) => request({ parse: (x) => x as { added: number; unknown: number } }, "/aliases/import", post({ csv }));
export const erasePerson = (person: string) =>
  request({ parse: (x) => x as { segments: number; claims: number; sourcesRemoved: number; sourcesRebuilt: number; blobsRemoved: number; unassignedRemoved: number } }, "/erasure", post({ person }));
export const listJobs = () => request(JobList, "/jobs");
export const getJobSummary = () => request(JobSummary, "/jobs/summary");
export const retryJobs = () => request({ parse: (x) => x as { retried: number } }, "/jobs/retry", post());
export const listTextEgress = () => request(TextEgressList, "/egress-log");

export const listFiles = () => request(FileList, "/files");
export const uploadFile = (file: File) =>
  request(FileEntry, "/files", { method: "POST", headers: { "x-file-name": file.name }, body: file });
export const createRun = (path: string) => request(CreateRunResponse, "/runs", post({ path }));
export const listRuns = () => request(RunList, "/runs");
export const getRun = (id: string) => request(Run, `/runs/${id}`);
export const getSensors = (runId: string) => request(SensorReport, `/runs/${runId}/sensors`);
export const getSensor = (runId: string, alias: string) => request(SensorDetail, `/runs/${runId}/sensors/${alias}`);
export const getQuality = (runId: string) => request(QualityReport, `/runs/${runId}/quality`);
export const getLanes = (runId: string) => request(LaneReport, `/runs/${runId}/lanes`);
export const getDrift = (runId: string) => request(DriftReport, `/runs/${runId}/drift`);
export const getIncidents = (runId: string) => request(IncidentReport, `/runs/${runId}/incidents`);
export const searchRun = (runId: string, text: string) => request(SearchResult, `/runs/${runId}/search`, post({ text }));
export const runModelCalls = (runId: string) => request(nothing, `/runs/${runId}/model-calls`, post());
export const getEvidence = (id: string) => request(Evidence, `/evidence/${id}`);
export const getEvidenceSeries = (id: string) => request(EvidenceSeries, `/evidence/${id}/series`);
export const getInference = (id: string) => request(Inference, `/inferences/${id}`);
export const getInferenceHead = (id: string) => request(Inference, `/inferences/${id}/head`);
export const getThread = (id: string) => request(arrayOf(ThreadEntry), `/inferences/${id}/thread`);
export const getReviews = (id: string) => request(ReviewReport, `/inferences/${id}/reviews`);
const NameCheckStatus = { parse: (x: unknown) => x as { pending: NameCheckJob | null; models: string[] } };
export const getNameCheckStatus = (runId: string) => request(NameCheckStatus, `/runs/${runId}/name-checks`);
export const startNameChecks = (runId: string) => request({ parse: (x) => x as { runId: string; sensors: number; models: string[] } }, `/runs/${runId}/name-checks`, post());
export const getNameChecks = (id: string) => request(NameCheckReport, `/inferences/${id}/name-checks`);
export const requestNameCheck = (id: string) => request(NameCheckReport, `/inferences/${id}/name-check`, post());
export const requestReview = (id: string) => request(ReviewReport, `/inferences/${id}/review`, post());
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
export const logExportUrl = (format: "json" | "csv") => `${apiBase()}/log/export?format=${format}`;
export const getEgress = (runId?: string) => request(arrayOf(EgressRecord), `/egress${runQuery(runId)}`);
export const getEgressTotals = (runId?: string) => request(EgressTotals, `/egress/totals${runQuery(runId)}`);
export const getEgressTemplates = () => request(TemplateCatalog, "/egress/templates");
export const getEgressRecord = (id: string) => request(EgressRecord, `/egress/${id}`);
const put = (body: unknown): RequestInit => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export const getModelSettings = () => request(ModelSettings, "/settings/model");
export const setModelMode = (mode: ModelMode) => request(ModelSettings, "/settings/model", put({ mode }));
export const listNotifications = () => request(NotificationList, "/notifications");
export const markNotificationRead = (id: string) => request(Notification, `/notifications/${id}/read`, post());
export const markAllNotificationsRead = () => request({ parse: (x) => x as { read: number } }, "/notifications/read-all", post());
export const getNotificationSettings = () => request(NotificationSettings, "/settings/notifications");
export const setNotificationSettings = (body: NotificationSettingsBody) => request(NotificationSettings, "/settings/notifications", put(body));
export const sendTestNotification = () => request(NotificationTestResult, "/settings/notifications/test", post());

export function subscribeRunEvents(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(`${apiBase()}/runs/${runId}/events`);
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
