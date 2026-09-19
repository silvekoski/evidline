import { z } from "zod";
import { Role, SignalType } from "./common.js";

export const WorkspaceSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/);
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

export const Workspace = z.object({
  slug: WorkspaceSlug,
  name: z.string().min(1).max(80),
  domains: z.array(z.string().min(3).max(120)),
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof Workspace>;
export const WorkspaceList = z.array(Workspace);
export const CreateWorkspaceBody = Workspace.omit({ createdAt: true });
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const ConnectorKind = z.enum(["slack", "teams", "email", "upload"]);
export type ConnectorKind = z.infer<typeof ConnectorKind>;

export const SourceKind = z.enum(["teams_call", "slack_thread", "email", "file", "voice_note"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceStatus = z.enum(["received", "processing", "processed", "failed", "needs_ocr", "sensor_data"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const Locator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("teams_call"), startMs: z.number().int(), endMs: z.number().int(), speaker: z.string().nullable() }),
  z.object({ kind: z.literal("slack_thread"), channelId: z.string(), ts: z.string(), threadTs: z.string().nullable() }),
  z.object({ kind: z.literal("email"), messageId: z.string(), charStart: z.number().int(), charEnd: z.number().int() }),
  z.object({
    kind: z.literal("file"),
    page: z.number().int().positive().nullable(),
    sheet: z.string().nullable(),
    row: z.number().int().nonnegative().nullable(),
    charStart: z.number().int(),
    charEnd: z.number().int(),
  }),
  z.object({ kind: z.literal("column"), column: z.string() }),
]);
export type Locator = z.infer<typeof Locator>;

export const Source = z.object({
  id: z.number().int(),
  workspace: WorkspaceSlug,
  connectorId: z.number().int().nullable(),
  kind: SourceKind,
  externalId: z.string(),
  title: z.string(),
  occurredAt: z.string(),
  contentHash: z.string(),
  blobPath: z.string().nullable(),
  mediaType: z.string(),
  bytes: z.number().int(),
  status: SourceStatus,
  error: z.string().nullable(),
  runId: z.string().nullable(),
  segments: z.number().int(),
  chunks: z.number().int(),
  claims: z.number().int(),
  createdAt: z.string(),
});
export type Source = z.infer<typeof Source>;
export const SourceList = z.array(Source);

export const Segment = z.object({
  id: z.number().int(),
  sourceId: z.number().int(),
  seq: z.number().int(),
  text: z.string(),
  speaker: z.string().nullable(),
  locator: Locator,
});
export type Segment = z.infer<typeof Segment>;

export const SourceDetail = z.object({ source: Source, segments: z.array(Segment) });
export type SourceDetail = z.infer<typeof SourceDetail>;

export const ChunkKind = z.enum(["passage", "claim", "column"]);
export type ChunkKind = z.infer<typeof ChunkKind>;

export const Chunk = z.object({
  id: z.number().int(),
  sourceId: z.number().int().nullable(),
  kind: ChunkKind,
  text: z.string(),
  locator: Locator,
  tokens: z.number().int(),
  segmentFrom: z.number().int().nullable(),
  segmentTo: z.number().int().nullable(),
});
export type Chunk = z.infer<typeof Chunk>;

export const Provenance = z.enum(["data", "person", "model"]);
export type Provenance = z.infer<typeof Provenance>;
export const ClaimStatus = z.enum(["hypothesis", "stated", "confirmed", "contradicted"]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ClaimLink = z.object({
  id: z.number().int(),
  claimId: z.number().int(),
  columnId: z.number().int(),
  column: z.string(),
  score: z.number(),
  confirmed: z.boolean().nullable(),
});
export type ClaimLink = z.infer<typeof ClaimLink>;

export const Claim = z.object({
  id: z.number().int(),
  chunkId: z.number().int(),
  sourceId: z.number().int(),
  sourceKind: SourceKind,
  sourceTitle: z.string(),
  statement: z.string(),
  quote: z.string(),
  speaker: z.string().nullable(),
  occurredAt: z.string().nullable(),
  provenance: Provenance,
  status: ClaimStatus,
  note: z.string().nullable(),
  locator: Locator,
  links: z.array(ClaimLink),
});
export type Claim = z.infer<typeof Claim>;
export const ClaimList = z.array(Claim);

export const PatchClaimBody = z.object({ status: ClaimStatus });
export const PatchClaimLinkBody = z.object({ confirmed: z.boolean() });

export const CatalogColumn = z.object({
  id: z.number().int(),
  name: z.string(),
  alias: z.string(),
  runId: z.string(),
  role: Role,
  signalType: SignalType,
  hypothesis: z.string().nullable(),
  confidence: z.number(),
  description: z.string(),
  claims: z.number().int(),
  confirmedClaims: z.number().int(),
});
export type CatalogColumn = z.infer<typeof CatalogColumn>;
export const CatalogColumnList = z.array(CatalogColumn);

export const ColumnKnowledge = z.object({ column: CatalogColumn, claims: z.array(Claim), aliases: z.array(z.string()) });
export type ColumnKnowledge = z.infer<typeof ColumnKnowledge>;

export const OpenQuestion = z.object({
  column: CatalogColumn,
  question: z.string(),
  contact: z.string().nullable(),
  hypothesisClaims: z.number().int(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;
export const OpenQuestionList = z.array(OpenQuestion);

export const SpecSentence = z.object({ column: z.string(), text: z.string(), claimIds: z.array(z.number().int()).min(1) });
export const DataSpec = z.object({ workspace: WorkspaceSlug, generatedAt: z.string(), sentences: z.array(SpecSentence), columnsWithoutClaims: z.array(z.string()) });
export type DataSpec = z.infer<typeof DataSpec>;

export const CorpusSearchBody = z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).default(20) });
export type CorpusSearchBody = z.infer<typeof CorpusSearchBody>;

export const SearchHit = z.object({
  chunkId: z.number().int(),
  sourceId: z.number().int().nullable(),
  sourceKind: SourceKind.nullable(),
  sourceTitle: z.string(),
  kind: ChunkKind,
  snippet: z.string(),
  locator: Locator,
  score: z.number(),
  ftsRank: z.number().int().nullable(),
  vecRank: z.number().int().nullable(),
});
export type SearchHit = z.infer<typeof SearchHit>;
export const SearchHitList = z.array(SearchHit);

export const ConnectorStatus = z.enum(["idle", "syncing", "error", "disabled"]);
export const Connector = z.object({
  id: z.number().int(),
  kind: ConnectorKind,
  name: z.string(),
  workspace: WorkspaceSlug.nullable(),
  config: z.record(z.string(), z.unknown()),
  status: ConnectorStatus,
  cursor: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type Connector = z.infer<typeof Connector>;
export const ConnectorList = z.array(Connector);
export const CreateConnectorBody = z.object({
  kind: ConnectorKind,
  name: z.string().min(1).max(80),
  workspace: WorkspaceSlug.nullable(),
  config: z.record(z.string(), z.unknown()),
  secret: z.string().nullable(),
});
export type CreateConnectorBody = z.infer<typeof CreateConnectorBody>;

export const JobType = z.enum(["normalize", "chunk", "embed", "extract", "link", "run-sensor-file", "connector-sync", "renew-subscriptions", "reembed"]);
export type JobType = z.infer<typeof JobType>;
export const JobStatus = z.enum(["queued", "running", "done", "failed"]);
export const Job = z.object({
  id: z.number().int(),
  workspace: WorkspaceSlug.nullable(),
  type: JobType,
  payload: z.record(z.string(), z.unknown()),
  status: JobStatus,
  attempts: z.number().int(),
  runAfter: z.string(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof Job>;
export const JobList = z.array(Job);

export const UploadLink = z.object({ token: z.string(), workspace: WorkspaceSlug, expiresAt: z.string(), url: z.string() });
export type UploadLink = z.infer<typeof UploadLink>;
export const CreateUploadLinkBody = z.object({ hours: z.number().int().min(1).max(24 * 30).default(72) });

export const UnassignedSource = z.object({
  id: z.number().int(),
  connectorId: z.number().int(),
  connectorName: z.string(),
  kind: SourceKind,
  externalId: z.string(),
  title: z.string(),
  occurredAt: z.string(),
  candidates: z.array(WorkspaceSlug),
  createdAt: z.string(),
});
export type UnassignedSource = z.infer<typeof UnassignedSource>;
export const UnassignedList = z.array(UnassignedSource);
export const AssignBody = z.object({ workspace: WorkspaceSlug });

export const MeetingGap = z.object({ subject: z.string(), start: z.string(), organizer: z.string(), domains: z.array(z.string()) });
export const MeetingGapList = z.array(MeetingGap);

export const TextEgressRow = z.object({
  id: z.number().int(),
  time: z.string(),
  purpose: z.enum(["embed", "extract", "transcribe"]),
  destination: z.string(),
  model: z.string(),
  texts: z.number().int(),
  bytes: z.number().int(),
  payloadHash: z.string(),
  status: z.enum(["sent", "blocked", "local", "error"]),
  detail: z.string(),
  durationMs: z.number().nullable(),
});
export type TextEgressRow = z.infer<typeof TextEgressRow>;
export const TextEgressList = z.array(TextEgressRow);

export const TranscriptWord = z.object({ text: z.string(), start: z.number(), end: z.number(), type: z.enum(["word", "spacing", "audio_event"]).default("word"), speaker_id: z.string().nullable().default(null) });
export type TranscriptWord = z.infer<typeof TranscriptWord>;
export const TranscriptionResponse = z.object({ language_code: z.string().nullable().default(null), text: z.string(), words: z.array(TranscriptWord).default([]) });
export type TranscriptionResponse = z.infer<typeof TranscriptionResponse>;

export const ExtractedClaim = z
  .object({
    statement: z.string().min(3).max(300),
    quote: z.string().min(3).max(500),
    speaker: z.string().max(80).nullable(),
    column: z.string().max(120).nullable(),
    provenance: Provenance,
  })
  .strict();
export type ExtractedClaim = z.infer<typeof ExtractedClaim>;
export const ExtractResponse = z.object({ claims: z.array(ExtractedClaim).max(20) }).strict();
export type ExtractResponse = z.infer<typeof ExtractResponse>;

export const CorpusStats = z.object({
  sources: z.number().int(),
  chunks: z.number().int(),
  claims: z.number().int(),
  claimsRejected: z.number().int(),
  columns: z.number().int(),
  embedder: z.string().nullable(),
  dimensions: z.number().int().nullable(),
  jobsQueued: z.number().int(),
  jobsFailed: z.number().int(),
});
export type CorpusStats = z.infer<typeof CorpusStats>;
