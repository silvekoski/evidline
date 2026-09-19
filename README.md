# Trustworthy process monitor

Norrin challenge, AaltoAI Hackathon 2026. The full specification is in [PRD.md](PRD.md). The build decisions are in `.planning/`.

A deterministic engine finds sensor roles, drift and faults in an undocumented sensor stream. A model only names and explains, from summaries, and a validator rejects each sentence it cannot trace to evidence. Raw data never leaves the plant.

## Quick start

Node 22 or later and pnpm 10.

```sh
pnpm install
pnpm build-demo data/tep-subset.csv      # writes data/demo-stream.csv and its truth file
pnpm exec tsx scripts/build-demo-records.ts   # writes data/demo-records.csv
pnpm --filter @tpm/web build
pnpm --filter @tpm/server start          # http://localhost:8787 serves the API and the built web app
```

For development, run `pnpm dev`. Vite serves the web app on port 5173 and proxies `/api` to the server on port 8787.

Drop a CSV file on the Run screen, or pick a file under `data/`. The pipeline needs no settings.

The app opens the last workspace at `/w/<slug>`. One workspace holds one customer: its runs, sources, claims, and data spec. The switcher at the top of the sidebar changes the workspace. The first start moves `data/tpm.db` to `data/workspaces/norrin/tpm.db` and makes the Norrin workspace.

## Model modes

The default mode is `off`. Every output works without a model. The Data flow screen switches the mode.

| Mode | Provider | Environment |
| --- | --- | --- |
| `off` | None. Text templates replace each model call. | |
| `cloud` | OpenAI-compatible chat completions with strict JSON schema output | `TPM_OPENAI_URL`, `TPM_OPENAI_KEY`, `TPM_OPENAI_MODEL`, `TPM_OPENAI_REGION` |
| `cloud` | Azure OpenAI, when the variables above are absent | `TPM_AZURE_ENDPOINT`, `TPM_AZURE_KEY`, `TPM_AZURE_DEPLOYMENT`, `TPM_AZURE_REGION` |
| `local` | Ollama | `TPM_OLLAMA_HOST`, `TPM_OLLAMA_MODEL` |

Put the variables in `.env` at the repository root. The file is git-ignored and the server loads it at start.

## Customer knowledge

The Knowledge section captures what the customer data means. Sources are call transcripts (VTT), voice notes (audio), Slack threads, emails (EML or a shared mailbox), and files (PDF, DOCX, PPTX, TXT, MD, CSV, XLSX). A pipeline of jobs normalizes each source into segments, chunks them, embeds them, extracts claims, checks each quote against the chunk, and links each claim to a column of the catalog. Search is hybrid: FTS5 with the trigram tokenizer plus sqlite-vec, merged with reciprocal rank fusion.

| Variable | Purpose |
| --- | --- |
| `TPM_EMBED_URL`, `TPM_EMBED_KEY`, `TPM_EMBED_MODEL`, `TPM_EMBED_DIMS` | OpenAI-compatible embeddings endpoint (Featherless, `Qwen/Qwen3-Embedding-4B`, 1024 kept dimensions). Without them, or in mode `off`, a local hashed trigram embedder runs and nothing leaves. |
| `TPM_ELEVENLABS_KEY`, `TPM_ELEVENLABS_MODEL`, `TPM_TRANSCRIBE_LANGUAGE` | ElevenLabs Scribe for voice notes (`scribe_v1`, diarization on). Without the key, or in mode `off`, an audio upload fails with a reason and the audio stays on the server. |
| `TPM_SECRET_KEY` | 32 bytes in hex. Encrypts connector tokens with AES-256-GCM. Without it the server writes a key to `data/secret.key`. |

Claim extraction uses the chat provider of mode `cloud`. In mode `off`, a local rule makes one claim from each sentence that names a catalog column. Every embed and extract call writes a row to `egress_log` with the destination, the model, the byte count, and a SHA-256 hash of the payload, never the text. A text guard blocks a payload with more than 30 percent numeric tokens or more than 8,000 characters. A CSV with more than 50 percent numeric cells is sensor data: it starts a run, and only its header names enter the corpus.

Connectors live in the registry (`data/registry.db`) and serve all workspaces. Teams transcripts come from Microsoft Graph (polling every 10 minutes, or a webhook at `/api/webhooks/graph` when `notificationUrl` is set). Email comes from one shared mailbox through the Graph delta query. Slack uses an internal app in Socket Mode plus a history backfill. A source that no rule maps to a workspace waits in the Unassigned list on the Connectors page. A workspace can set a retention period in days. A daily job then removes each older source with its chunks, vectors, and claims.

## Rule 4: nothing leaves

- `packages/egress` is the only package that can send data to a model. `packages/connectors` may open connections to Slack and Microsoft Graph to read sources. The ESLint config blocks `fetch`, sockets, dynamic imports and HTTP modules everywhere else, and blocks all I/O in `packages/core`.
- Each model call passes seven guards in order: schema whitelist, aggregation floor (n >= 100), size limits, rounding to 3 significant digits, a leak scanner for runs of 3 raw samples, a scanner for source names and file names, and record-then-send.
- `pnpm canary` runs the full pipeline and every model purpose on a synthetic dataset with a capturing provider and fails on any leak.
- The Data flow screen shows each payload verbatim, the guard results, the template hash and the response.

## Checks

```sh
pnpm check     # typecheck, lint, tests
pnpm canary    # rule 4 canary
```

## Layout

```text
apps/web          React, Tailwind, shadcn. The eight screens of PRD section 8.
apps/server       Hono API, SSE progress, worker thread, SQLite.
packages/core     Pure analysis: fingerprint, baseline, health gate, relations, roles, drift, faults, trace, calibration.
packages/adapters Stream and records adapters, layout detection, streaming CSV.
packages/egress   Gateway, guards, leak scanner, templates, validator, provider adapters, text channel (embedders, extraction).
packages/corpus   Normalizers (PDF, DOCX, PPTX, VTT, EML, CSV, XLSX), chunker, quote verifier, local extractor, linker, rank fusion.
packages/connectors Teams, email, and Slack connectors behind one interface.
packages/schemas  zod schemas shared by every package.
scripts           build-demo.ts, build-demo-records.ts, canary.ts
data              Git-ignored. Datasets, uploads, the registry, and one folder per workspace with its SQLite file and blobs.
```
