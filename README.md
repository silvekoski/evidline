<p align="center">
  <img src="apps/server/assets/evidline-logo.png" alt="Evidline" width="360">
</p>

# Evidline

Evidline reads an undocumented sensor stream. It tells the operator what each column measures and which sensor drifts. It also tells whether the cause is a sensor fault or a process fault. Each inference shows its evidence. Raw data stays in the plant.

Norrin set the challenge at the AaltoAI Hackathon 2026. The build decisions are in `.planning/`.

## The problem

Norrin builds ML and LLM solutions for industrial customers. A paper machine has thousands of sensors. A sensor can drift for weeks while its values stay in the normal range, so no alarm starts. When product quality drops, the cause sits somewhere in the dashboards and the logs. The crew can open the machine to inspect the wear, but that is very expensive.

Business data has the same shape. Bank transactions and web shop events pass validation one row at a time, and a small entry error in each row goes unseen.

Norrin named two more pains. The first is that an LLM hallucinates on these problems. The second is that nobody can tell which log a conclusion comes from.

Understanding the customer data is the expensive part of each new project. The knowledge sits in Teams calls that nobody recorded, in emails, in Slack threads, and in the heads of floor engineers who leave.

## What Evidline does

Evidline has two sides.

**Process monitor.** A deterministic engine reads a CSV file, gives each column an opaque alias, and finds the role of each sensor from statistics only. A health gate checks the data before any diagnosis. A drift detector measures each sensor against its peers. A sensor that stays in range but departs from what its peers predict gets a flag. A fault separator tells a dead sensor from a slow process degradation, and ranks the sensors that carry the fault.

The operator can accept, question, or override each inference. A question can be typed or spoken as a hunch, and the agent runs more tests in that direction.

**Customer knowledge.** A corpus holds call transcripts, voice notes, Slack threads, emails, and the customer's own documents. A pipeline extracts claims about the data, checks each quote against its source, and links each claim to a sensor. The result is a data spec with a source link on each line. A Norrin engineer can use it to build the ML model and the dashboard.

A model only names and explains. It gets summaries, never raw rows. A validator rejects each sentence that it cannot trace to evidence. Every output works with the model off.

## The four rules

| Rule | How Evidline keeps it |
| --- | --- |
| No labels | The engine replaces each column header with an alias such as S01. Roles come from fingerprints, relations, and lags. Thresholds calibrate themselves by synthetic fault injection. The prompt templates are generic and hashed. |
| Evidence first | Each inference points to evidence objects. Each evidence object stores its method, window, numbers, and chart. No evidence, no claim. |
| Data before process | The health gate runs first and masks each unhealthy sensor. A dead sensor can never become a process diagnosis. |
| Nothing leaves | One egress gateway is the only code that can reach a model. Seven guards check each payload. The Data flow screen shows each payload verbatim. |

## Screens

| Screen | Content |
| --- | --- |
| Run | Drop a file. The pipeline needs no settings. |
| Sensors | Role, hypothesis name, confidence, and health for each sensor. A row opens the fingerprint, the role candidates, and the top relations with lags. Open models cross-check each name. |
| Quality | Baseline checks for each sensor, plus rules compiled from plain language. |
| Drift | Deviation over time, sorted by severity, with the onset and the responsible sensor. |
| Diagnosis | Incident cards with the fault class, ranked sensors, and numbered reasoning steps with evidence chips. A cross review asks a set of open models for a second opinion. |
| Log | The decision log. Each inference, its evidence, and each override, in a hash chain with a Verify button. |
| Data flow | What left the plant, to which host, and why. Each payload verbatim with its guard results. |
| Runs | Runs for each domain, side by side. |
| Knowledge | Sources, review claims, open questions, the data spec, and connectors. |

## Second domain

Business records run through the same stages. The agent detects the layout by itself. A records adapter derives one metric per field and time bucket, and each metric becomes one sensor.

A field that goes null is a dead sensor. A cents-for-euros change is a gain fault. A slow rise of format violations is a bias drift. No code changes.

## Quick start

Node 22 or later and pnpm 10.

```sh
pnpm install
pnpm build-demo data/tep-subset.csv           # writes data/demo-stream.csv and its truth file
pnpm exec tsx scripts/build-demo-records.ts   # writes data/demo-records.csv
pnpm --filter @tpm/web build
pnpm --filter @tpm/server start               # http://localhost:8787 serves the API and the built web app
```

For development, run `pnpm dev`. Vite serves the web app on port 5173 and proxies `/api` to the server on port 8787.

Drop a CSV file on the Run screen, or pick a file under `data/`.

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

The Knowledge section captures what the customer data means. Sources are call transcripts (VTT), voice notes (audio), Slack threads, emails (EML or a shared mailbox), and files (PDF, DOCX, PPTX, TXT, MD, CSV, XLSX). A pipeline of jobs normalizes each source into segments, chunks them, and embeds them. It then extracts claims, checks each quote against the chunk, and links each claim to a column of the catalog. Search is hybrid: FTS5 with the trigram tokenizer plus sqlite-vec, merged with reciprocal rank fusion.

| Variable | Purpose |
| --- | --- |
| `TPM_EMBED_URL`, `TPM_EMBED_KEY`, `TPM_EMBED_MODEL`, `TPM_EMBED_DIMS` | OpenAI-compatible API base (`https://api.featherless.ai/v1`) and key. The embedder posts to `<base>/embeddings` with `Qwen/Qwen3-Embedding-4B` and keeps 1024 dimensions. Without them, or in mode `off`, a local hashed trigram embedder runs and nothing leaves. |
| `TPM_OCR_MODEL`, `TPM_OCR_URL`, `TPM_OCR_KEY` | Vision model for a PDF page without a text layer. Default `Qwen/Qwen3-VL-32B-Instruct` on the embeddings host and key. Each page goes as one PNG to `<base>/chat/completions`. About 6 s per page. |
| `TPM_ELEVENLABS_KEY`, `TPM_ELEVENLABS_MODEL`, `TPM_TRANSCRIBE_LANGUAGE` | ElevenLabs Scribe for voice notes (`scribe_v1`, diarization on). Without the key, or in mode `off`, an audio upload fails with a reason and the audio stays on the server. |
| `TPM_SECRET_KEY` | 32 bytes in hex. Encrypts connector tokens with AES-256-GCM. Without it the server writes a key to `data/secret.key`. |

Claim extraction uses the chat provider of mode `cloud`. In mode `off`, a local rule makes one claim from each sentence that names a catalog column. Every embed and extract call writes a row to `egress_log` with the destination, the model, the byte count, and a SHA-256 hash of the payload, never the text.

A text guard blocks a payload with more than 30 percent numeric tokens or more than 8,000 characters. A CSV with more than 50 percent numeric cells is sensor data: it starts a run, and only its header names enter the corpus.

Connectors live in the registry (`data/registry.db`) and serve all workspaces. Teams transcripts come from Microsoft Graph (polling every 10 minutes, or a webhook at `/api/webhooks/graph` when `notificationUrl` is set). Email comes from one shared mailbox through the Graph delta query. Slack uses an internal app in Socket Mode plus a history backfill. A source that no rule maps to a workspace waits in the Unassigned list on the Connectors page.

An erasure request removes every segment and claim of one speaker, drops the original files, and rebuilds the chunks. A workspace can set a retention period in days. A daily job then removes each older source with its chunks, vectors, and claims.

## Cross review

In mode `cloud`, the Diagnosis screen can ask a set of open models for a second opinion on one incident. Each reviewer gets the same guarded summary as `explain_diagnosis`, without the engine verdict. It answers with a fault class, a confidence, a summary and concerns. The engine still decides the fault class. A reviewer answer is a hypothesis. A validator hides text that names a number or an alias outside the payload.

The Sensors screen uses the same reviewers to cross-check each sensor name.

| Variable | Meaning |
| --- | --- |
| `TPM_REVIEW_KEY` | The API key. With the default Featherless URL, `TPM_EMBED_KEY` works as a fallback. Reviews are off without a key. |
| `TPM_REVIEW_URL` | Chat completions URL. Default `https://api.featherless.ai/v1/chat/completions`. |
| `TPM_REVIEW_MODELS` | Comma separated model ids. Default `Qwen/Qwen3.8-Flash-Next`, `deepseek-ai/DeepSeek-V4.1-Flash`, `zai-org/GLM-5.3-Flash`, `moonshotai/Kimi-K2-Instruct`. |
| `TPM_REVIEW_REGION` | Optional region label for the record. |

Reviewers run one after another, because Featherless bills concurrency units and rejects calls above the plan with HTTP 429. Reviews run only when the operator asks.

## Notifications

A run makes a notification when a sensor fails a health check or gets a drift flag, when a run finishes, and when a run fails. The bell in the header shows the unread count. Resend delivers each notification as an email when `RESEND_API_KEY`, `ALERT_FROM`, and `ALERT_TO` are set. `APP_URL` adds a link to the run screen. The Notifications screen holds the toggle for each kind.

## Nothing leaves

- `packages/egress` is the only package that can send data to a model. `packages/connectors` may open connections to Slack and Microsoft Graph to read sources. The ESLint config blocks `fetch`, sockets, dynamic imports and HTTP modules everywhere else, and blocks all I/O in `packages/core`.
- Each model call passes seven guards in order. They are the schema whitelist, the aggregation floor (n >= 100), size limits, rounding to 3 significant digits, a leak scanner for runs of 3 raw samples, a scanner for source names and file names, and record-then-send.
- `pnpm canary` runs the full pipeline and every model purpose on a synthetic dataset with a capturing provider and fails on any leak.
- The Data flow screen shows each payload verbatim, the guard results, the template hash and the response.
- Every model call names its endpoint host in its record. The Data flow totals list each host that received data. The primary model uses one host. Reviewers use one more host when `TPM_REVIEW_URL` differs from the primary endpoint.

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
