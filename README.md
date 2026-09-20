<p align="center">
  <img src="apps/server/assets/evidline-banner.jpg" alt="Evidline: understand any sensor stream in minutes, with the customer's own words as proof.">
</p>

<p align="center">
  <a href="https://65.108.32.178.compute.verda.run">Live demo</a>
</p>

# Evidline

Figuratively speaking, Evidline reads an undocumented sensor stream and makes sense of it. It maps each of the hundreds of columns to what it measures, identifies drifting sensors, tells the difference between a sensor fault and a process fault, and shows relevant past sensor behavior to an engineer. Every inference shows its evidence, and the raw data never leaves the plant.

Norrin set the challenge at the AaltoAI Hackathon 2026. See the build decisions in `.planning/`.

## Problem context

Every paper machine has thousands of sensors. A sensor can drift for weeks without an alarm, because its values are still in the normal range. When quality drops, the cause is buried in dashboards and log data, and a physical inspection of the wear is very expensive.

Business data parallels the issue. A bank or a web shop can have hundreds of thousands of entries that are validated row by row, but a small error in any given row goes unseen and out of reach. Diagnosis is expensive, slow and error-prone.

ML and LLM systems learn this the hard way. An LLM hallucinates, and nobody can tell which log a conclusion comes from. The understanding in the customer's head does not live in any database. It lives in unrecorded Teams calls, emails, Slack threads and the heads of engineers.

## Core system behavior

Evidline is a process monitor and a knowledge-tapping customer interface. Two sides of the same coin.

### Process monitor

Evidline is a deterministic engine that reads a CSV. It assigns opaque aliases to sensors, finds roles based on statistics, and runs a health gate before diagnosis starts. It measures the drift of each sensor against its peers and flags the few that depart from their peers while they stay in range. It separates a dead sensor from slow process degradation, ranks the fault-carrying sensors, and links each to the evidence that shows the drift.

### Operator interaction

The operator can accept, question or override each inference, and ask for more data. A question can be typed or spoken as a hunch, and the agent runs more tests toward the hunch.

### Customer knowledge

The Evidline corpus holds call transcripts (VTT), voice notes, Slack threads, emails and documents. The pipeline normalizes each source into segments and chunks, embeds them, extracts claims, checks each quote against its source, and links each claim to a sensor or column. The result is a data spec with a source link per line, for building ML models and dashboards.

### Model output rules

The model only names and explains. It gets summaries, not raw rows. The validator rejects any sentence that cannot be traced back to evidence. Every output works with the model off.

## Four rules and their mechanisms

The Evidline constraints enforce traceability and safety, and the principle that raw data does not leave the plant.

| Rule | Mechanism |
| --- | --- |
| No labels | The engine replaces headers with opaque aliases like S01. It reads roles only from fingerprints, relations and lags. Thresholds calibrate themselves through synthetic fault injection. Prompt templates are generic and hashed. |
| Evidence first | Each inference points to evidence objects that contain the method, the time window, the actual numbers and a chart. No evidence means no claim. |
| Data before process | The health gate runs first and masks unhealthy sensors. A dead sensor cannot become a process diagnosis. |
| Nothing leaves | There is one egress gateway, and it is the only code path to a model. Seven guards check each payload as it exits the plant. The Data flow screen shows each payload verbatim. |

## User interface screens

| Screen | Content |
| --- | --- |
| Run | Drop a file. The pipeline needs no settings. |
| Sensors | Per sensor: role, hypothesis name, confidence and health. A row opens the fingerprint, the role candidates, and the top relations with lags. Open models cross-check each name. |
| Quality | Baseline checks plus rules compiled from plain language. |
| Drift | Deviation over time sorted by severity, with the onset and the responsible sensor. |
| Diagnosis | A card for each incident with the fault class and the ranked sensors. Numbered reasoning steps with evidence chips along the way. A cross review asks open models for a second opinion. |
| Log | The decision log with each inference, its evidence and each override, arranged in a hash chain with a Verify button. |
| Data flow | What left the plant, to which host and why. Each payload verbatim plus the results of the seven guards. |
| Runs | Runs for each domain side by side. |
| Knowledge | Sources, review claims, open questions, data spec and connectors. |

## Second domain mapping

Business records use the same stages. The agent detects the layout, and the adapter derives one metric per field and time bucket. Each metric becomes one sensor.

In the data semantics mapping, a field that goes null becomes a dead sensor. A cents-for-euros change becomes a gain fault. A slow rise of format violations becomes a bias drift. There are no code changes.

## Quick start

Requirements are Node 22 or later and pnpm 10.

To get everything running for a demo:

```sh
pnpm install
pnpm build-demo data/tep-subset.csv           # writes data/demo-stream.csv and its truth file
pnpm exec tsx scripts/build-demo-records.ts   # writes data/demo-records.csv
pnpm --filter @tpm/web build
pnpm --filter @tpm/server start               # http://localhost:8787 serves the API and the built web app
```

Development:

- `pnpm dev` runs the Vite dev server on port 5173. Vite serves the web app and proxies `/api` to the server on port 8787.

Workspace behavior:

- At start, the app loads the last workspace at `/w/<slug>`. Each workspace belongs to one customer, with its own runs, sources, claims and data spec. The switcher at the top of the sidebar changes the workspace.
- On the first start, the server moves `data/tpm.db` to `data/workspaces/norrin/tpm.db` and makes the Norrin workspace available at `/w/norrin`.

## Model modes and environment variables

The default mode is `off`, and every output works without a model. The Data flow screen switches the mode.

| Mode | Provider | Environment |
| --- | --- | --- |
| `off` | No provider at all. Text templates replace each model call. | |
| `cloud` | OpenAI-compatible chat completions. Outputs must conform to a strict JSON schema. | `TPM_OPENAI_URL`, `TPM_OPENAI_KEY`, `TPM_OPENAI_MODEL`, `TPM_OPENAI_REGION` |
| `cloud` | Azure OpenAI, when the OpenAI variables are absent and these are set. | `TPM_AZURE_ENDPOINT`, `TPM_AZURE_KEY`, `TPM_AZURE_DEPLOYMENT`, `TPM_AZURE_REGION` |
| `local` | Ollama. | `TPM_OLLAMA_HOST`, `TPM_OLLAMA_MODEL` |

Place the variables in a file named `.env` at the root of the repository. The file is git-ignored. The server loads it at start.

## Customer knowledge extraction and connectors

The Knowledge section captures the meaning of the customer data and pulls that information from many sources: VTT call transcripts, voice audio notes, Slack threads, emails (EML or a shared mailbox), and files (PDF, DOCX, PPTX, TXT, MD, CSV, XLSX). The pipeline normalizes each source into segments, chunks them, embeds them, extracts claims, checks each quote against the chunk, and links each claim to a catalog column. Search is hybrid: FTS5 with the trigram tokenizer plus sqlite-vec, merged with reciprocal rank fusion.

### Variables and purpose

| Variable | Purpose |
| --- | --- |
| `TPM_EMBED_URL`, `TPM_EMBED_KEY`, `TPM_EMBED_MODEL`, `TPM_EMBED_DIMS` | Base URL and key of an OpenAI-compatible embeddings API, such as `https://api.featherless.ai/v1`. The embedder posts to `<base>/embeddings` with `Qwen/Qwen3-Embedding-4B` and keeps 1024 dimensions. Without them, or in mode `off`, a local hashed trigram embedder runs and nothing leaves. |
| `TPM_OCR_MODEL`, `TPM_OCR_URL`, `TPM_OCR_KEY` | Vision model for a PDF page without a text layer. Default `Qwen/Qwen3-VL-32B-Instruct` on the embeddings host and key. Each page goes as one PNG to `<base>/chat/completions`. About 6 s per page. |
| `TPM_ELEVENLABS_KEY`, `TPM_ELEVENLABS_MODEL`, `TPM_TRANSCRIBE_LANGUAGE` | ElevenLabs Scribe for voice notes (`scribe_v1`, speaker diarization on). Without the key, or in mode `off`, an audio upload fails with a reason and the audio stays on the server. |
| `TPM_SECRET_KEY` | 32 bytes in hex. AES-256-GCM encrypts the connector tokens with it. If it is not set, the server writes a key to `data/secret.key`. |

### Claim extraction

- In mode `cloud`, extraction uses the chat provider.
- In mode `off`, a local rule makes one claim per sentence that names a catalog column.

### Egress logging

Every embed and extract call writes a row to `egress_log`. The row records the destination, the model, the byte count and a SHA-256 hash of the payload, never the text itself.

### Guards

- A text guard blocks a payload with more than 30 percent numeric tokens or more than 8,000 characters.
- A CSV with more than 50 percent numeric cells is sensor data. It starts a run, and only its header names enter the corpus.

### Connectors

A registry of connectors resides in `data/registry.db` and serves all workspaces.

- Teams: polls Microsoft Graph every 10 minutes, or uses the webhook at `/api/webhooks/graph` when `notificationUrl` is set.
- Email: the Graph delta query on one shared mailbox.
- Slack: an internal app in Socket Mode, plus a history backfill.

A source that no rule maps to a workspace waits in the Unassigned list on the Connectors page.

### Data governance

- An erasure request removes every segment and claim of one speaker, drops the original files, and rebuilds the chunks.
- A workspace can set a retention period in days. A daily job removes each source older than the period, together with its chunks, vectors and claims.

## Cross review and validation

In mode `cloud`, the Diagnosis screen can ask open models for a second opinion. The operator selects one incident, and the screen sends it to one or more review models. Each reviewer receives the same guarded summary as `explain_diagnosis`, with no engine verdict. Each reviewer returns a fault class, a confidence, a summary and one or more concerns.

The engine still decides the fault class. A reviewer answer is a hypothesis, not a verdict. The same validator that checks the primary model hides reviewer text that names a number or an alias outside the payload. The Sensors screen asks the same reviewers to cross-check each sensor name.

| Variable | Meaning |
| --- | --- |
| `TPM_REVIEW_KEY` | The API key for the review endpoint. With the default Featherless URL, `TPM_EMBED_KEY` works as a fallback. Without a key, reviews are off. |
| `TPM_REVIEW_URL` | Chat completions URL. Default `https://api.featherless.ai/v1/chat/completions`. |
| `TPM_REVIEW_MODELS` | Comma separated model ids. Default `Qwen/Qwen3.8-Flash-Next`, `deepseek-ai/DeepSeek-V4.1-Flash`, `zai-org/GLM-5.3-Flash`, `moonshotai/Kimi-K2-Instruct`. |
| `TPM_REVIEW_REGION` | Optional region label for the record. |

Reviewers run one after another, because Featherless bills concurrency units and rejects calls above the plan with HTTP 429. Reviews run only when the operator asks.

## Notifications

A run makes a notification at three points: a sensor fails a health check or gets a drift flag, a run finishes, or a run fails. The bell in the header shows the number of unread notifications.

When `RESEND_API_KEY`, `ALERT_FROM` and `ALERT_TO` are set, Resend delivers each notification as an email. `APP_URL` adds a link to the run screen. The Notifications screen holds a toggle for each kind.

## Nothing leaves

The only package that may send data to a model is `packages/egress`. `packages/connectors` may open connections to Slack and Microsoft Graph to read sources. The ESLint config blocks `fetch`, sockets, dynamic imports and HTTP modules everywhere else, and blocks all I/O in `packages/core`.

Seven guards protect each model call, in this order:

1. Schema whitelist. Only a payload that matches a summary schema can pass.
2. Aggregation floor. Each aggregate covers at least 100 samples.
3. Size limits.
4. Rounding to 3 significant digits.
5. Leak scanner for runs of 3 raw samples.
6. Scanner for source names and file names.
7. Record, then send.

`pnpm canary` runs the full pipeline and every model purpose on a synthetic dataset with a capturing provider. It fails on any leak.

The Data flow screen shows each payload verbatim, the guard results, the template hash and the response. Every model call records its endpoint host, and the totals list each host that received data. The primary model uses one host. Reviewers use one more host when `TPM_REVIEW_URL` differs from the primary endpoint.

## Checks

```sh
pnpm check     # typecheck, lint, tests
pnpm canary    # egress canary
```

## Deploy

Each push to `main` runs `.github/workflows/deploy.yml`. The workflow connects to the Verda instance over SSH and runs `scripts/deploy.sh`.

## Layout

```text
apps/web          React, Tailwind, shadcn. The run screens, the knowledge screens, and the system screens.
apps/server       Hono API, SSE progress, worker thread, SQLite, notifications.
packages/core     Pure analysis: fingerprint, baseline, health gate, relations, roles, drift, faults, trace, calibration.
packages/adapters Stream and records adapters, layout detection, streaming CSV.
packages/egress   Gateway, guards, leak scanner, templates, validator, provider adapters, text channel (embedders, extraction).
packages/corpus   Normalizers (PDF, DOCX, PPTX, VTT, EML, CSV, XLSX), chunker, quote verifier, local extractor, linker, rank fusion.
packages/connectors Teams, email, Slack, and Resend behind one interface.
packages/schemas  zod schemas shared by every package.
scripts           build-demo.ts, build-demo-records.ts, build-demo-corpus.ts, canary.ts, deploy.sh
data              Git-ignored. Datasets, uploads, the registry, and one folder per workspace with its SQLite file and blobs.
```
