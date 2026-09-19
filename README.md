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

## Model modes

The default mode is `off`. Every output works without a model. The Data flow screen switches the mode.

| Mode | Provider | Environment |
| --- | --- | --- |
| `off` | None. Text templates replace each model call. | |
| `cloud` | OpenAI-compatible chat completions with strict JSON schema output | `TPM_OPENAI_URL`, `TPM_OPENAI_KEY`, `TPM_OPENAI_MODEL`, `TPM_OPENAI_REGION` |
| `cloud` | Azure OpenAI, when the variables above are absent | `TPM_AZURE_ENDPOINT`, `TPM_AZURE_KEY`, `TPM_AZURE_DEPLOYMENT`, `TPM_AZURE_REGION` |
| `local` | Ollama | `TPM_OLLAMA_HOST`, `TPM_OLLAMA_MODEL` |

Put the variables in `.env` at the repository root. The file is git-ignored and the server loads it at start.

## Rule 4: nothing leaves

- `packages/egress` is the only package that can reach the network. The ESLint config blocks `fetch`, sockets, dynamic imports and HTTP modules everywhere else, and blocks all I/O in `packages/core`.
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
packages/egress   Gateway, guards, leak scanner, templates, validator, provider adapters.
packages/schemas  zod schemas shared by every package.
scripts           build-demo.ts, build-demo-records.ts, canary.ts
data              Git-ignored. Datasets, uploads and the SQLite file.
```
