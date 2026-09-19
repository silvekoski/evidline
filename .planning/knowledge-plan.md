# Customer knowledge capture: build plan

Date: 2026-09-19. Source: the PRD "Customer Knowledge Capture". This file records the decisions that the PRD leaves open and the build order.

## Decisions

### Workspaces

- The registry database is `data/registry.db`. Tables: `workspace`, `connector`, `job`, `upload_link`.
- One workspace database is `data/workspaces/<slug>/tpm.db`. Blobs go to `data/workspaces/<slug>/blobs/<sha256>`.
- The server builds one `AppContext` (db, hub, gateway, corpus) and one Hono API app for each open workspace. A cache keeps at most 10 open workspaces. The router forwards `/api/w/:workspace/*` to the app of that workspace with the prefix removed. The current routes and services do not change.
- First start: if `data/tpm.db` exists and the Norrin workspace does not, the server checkpoints the file, moves `tpm.db` to `data/workspaces/norrin/tpm.db`, and adds the registry row.
- The web app makes one TanStack `QueryClient` for each workspace slug. A switch changes the client, so no key can show data from a different workspace. The API base is `/api/w/<slug>`, read from the URL.
- Corpus tables use plain SQL migrations with `PRAGMA user_version`. The `defineTable` helper stays for the run tables.

### Column catalog

- A `column` row is one source header in the workspace. The newest run that has the header sets `alias`, `role`, `signalType`, `hypothesis`, and `confidence`. Confidence is the minimum of the model hypothesis confidence and the engine role confidence. The model gave 0.65 or more to every column of the TE run, while the engine had 36 of 52 roles under 0.5. The minimum keeps the open-question list honest.
- The catalog refreshes after each run and after the model calls of a run.
- Low confidence is less than 0.5, the same limit as the command palette.

### Egress for text

- `@tpm/egress` gets a text channel next to the payload gateway: `embed(texts, kind)` and `extract(chunk, columns)`.
- Guards: numeric share of tokens at most 30 percent, at most 8,000 characters for one text. Each call writes one `egress_log` row: destination, model, bytes, sha256 of the payload, status. The row never holds the text.
- Embedders: `openai` (Featherless, `TPM_EMBED_URL`, `TPM_EMBED_KEY`, `TPM_EMBED_MODEL`) and `hash` (a local hashed trigram vector, 1024 dimensions, no network). Mode `off` or no embed config selects `hash`. `embedding_meta` records the embedder name and dimensions. A change starts a full re-embed.
- Claim extraction uses the chat provider of mode `cloud` (the Norrin endpoint). Mode `off` uses a local rule. Each sentence that names a column candidate becomes one claim with provenance `person`. The sentence is the quote.

### Linker

- Three candidate scores add together. An exact alias phrase gives 1.0. A column name or alias token in the statement gives 0.6. The cosine between the claim vector and the column description vector gives up to 1.0. The link limit is 0.5.
- The name match is a normalized substring test over the catalog, not an FTS5 index. The catalog has under 100 rows, so an index adds nothing.

### Pipeline jobs

- Job types: `normalize`, `chunk`, `embed`, `extract`, `link`, `run-sensor-file`, `connector-sync`. The quote check runs inside `extract`. Rejected claims are not stored. Counters `claims_accepted` and `claims_rejected` live in the `counter` table.
- One worker loop in the server process polls the registry `job` table each second. A failed job waits `5 s * 2^n` before try number n. The job stops after 5 tries.

### File parsers

- `.msg` (Outlook binary) is not parsed in version 1. The source gets the status `failed` with the reason. `.eml` works.
- XLSX uses the SheetJS CDN build (`xlsx` 0.20.3). The npm build (0.18.5) has open advisories.
- A sensor data file (more than 50 percent numeric cells) starts a pipeline run in the workspace from the blob. Only the header names and the column catalog summaries enter the corpus.

### Network rule

- `packages/connectors` may open connections to Slack and Microsoft Graph. The ESLint rule that blocks the network outside `packages/egress` gets this second exception. Connector calls carry tokens and cursors, never plant data. Model calls stay in `@tpm/egress`.

## Build order

1. M1: registry, workspace router, migration, sqlite-vec, jobs, text egress, hash embedder, schemas.
2. M2: upload connector, parsers, chunker, embed job, hybrid search, Sources page, source viewer, palette group.
3. M3: extractor, verifier, linker, column catalog, knowledge tab, open questions page.
4. M7 part: data spec route and page.
5. M4 to M6: Teams, Slack, email connectors with recorded-response tests.
6. Retention and delete.

## Progress (2026-09-20)

- In commits on main: M1 to M7 except the replay test, the Teams, email, and Slack connectors, source routing with an Unassigned list, Graph webhooks, ElevenLabs voice notes, retention per workspace, erasure by person, tag list import, transcript gaps, origin links, Slack files, claim markers with links. `pnpm check` passes with 305 tests.
- OCR: a page with under 20 characters of text layer renders to PNG at scale 2 and goes to a vision model through the text channel (`ocr` purpose). Live check on 2026-09-20: `Qwen/Qwen3-VL-32B-Instruct` on Featherless read a test page near-verbatim in 6.3 s. `Qwen/Qwen3-VL-8B-Instruct` and the 2.5-VL family are also there. The public model catalog answers 404, so the list came from probes.
- Featherless base URL is `https://api.featherless.ai/v1`. The `/openai/v1` prefix answers 404 on every route.
- Not done: the replay test and the golden set (need project material), `.msg`, IMAP, live runs of the connectors (need an Entra app, a Slack app, and a mailbox).
