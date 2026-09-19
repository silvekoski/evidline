# Build decisions

Date: 2026-09-19. These decisions fill the gaps in PRD.md. Each agent must follow them.

## Dataset facts

- `te_process.csv` is the Rieth 2017 Tennessee Eastman set. 6.0 GB, 15.3 M rows, 57 columns.
- Columns: `faultNumber`, `simulationRun`, `sample`, `xmeas_1..41`, `xmv_1..11`, `source`, `fault_status`.
- 21,000 episodes. Train episodes have 500 samples, test episodes have 960. The sample interval is 3 min.
- File order: fault 0 train runs 1..500, then for each run, faults 1..20 train, then the same for test.
- The file has no timestamps. `sample` is a counter that resets at each episode.

## Source adapter

- Layout detection reads the first 5,000 rows. Stream: mostly numeric columns and a regular time index. Records: irregular timestamps, ID and category columns.
- Text columns in a stream file are never sensors. The adapter stores them as quarantined metadata.
- A numeric column that is a +1 counter with resets marks episode boundaries. Columns that are constant inside every episode are episode metadata. The pipeline never reads metadata.
- Episodes concatenate in file order. Time is the row index. The `Series` type carries `t0` and `dt` in ms when a timestamp column exists, else `null`.
- The adapter keeps a grid of at most 262,144 points for each sensor. Larger files use bucket means. The bucket size is a power of 2.
- Aliases are `S01`, `S02`, ... in column order. The plant DB stores the source header next to the alias. No payload field can carry it.

## Demo stream

- `scripts/build-demo.ts` writes `data/demo-stream.csv` from `te_process.csv`: 20 normal test episodes, then one fault 13 test episode. Columns: `time` (3 min steps from 2026-01-01T00:00:00Z) and the 52 sensor columns with their original headers.
- The script injects a dead sensor and a slow in-range bias drift with `inject-faults.ts`. It writes `data/demo-stream.truth.json` next to the file. The app never reads the truth file. Tests do.
- The Run screen lists files in `data/` and accepts a dropped file. A dropped file streams to `data/uploads/`.

## Versions

typescript 5.9, vite 7, @vitejs/plugin-react 5, vitest 4, react 19, react-router 7, @tanstack/react-table 8, @tanstack/react-query 5, recharts 3, tailwindcss 4, hono 4, @hono/node-server 1, better-sqlite3 13, zod 4, eslint 9, typescript-eslint 8.

## Model

- Model mode default: `off`. Providers: `azure` (chat completions, JSON schema response format) and `ollama` (`/api/chat` with JSON schema `format`). Config from environment. No keys exist on the build machine, so a mock provider server tests the gateway.
- Voice hunch (P1) is cut. A Whisper model download is a third-party request.

## Time units

- Windows are row index ranges `[from, to)`. With `dt`, the UI also shows days. Without `dt`, the unit is samples.

## Added after the contract review (2026-09-19)

- G1 (under 2 minutes) applies to the demo stream. The full 6 GB file is a load test, not a demo path.
- The demo stream keeps the `sample` counter column so the adapter finds the 21 episode boundaries. The time column is synthetic (3 min steps) and the script says so.
- The second domain uses a seeded synthetic web shop file from `scripts/build-demo-records.ts`. No dataset download: the disk is full and a download is a third-party request.
- Model-off fallbacks per purpose are in the build spec. `name_role` has no fallback: the hypothesis stays null.
- Injected demo faults start after 60% of the rows so the baseline cannot hide them.

## Model endpoint (2026-09-19)

- Norrin gave an OpenAI-compatible endpoint (vLLM, Mistral Large 3, EU hosting on DataCrunch). Mode `cloud` uses it through the `openai` provider. The key lives in `.env` (git-ignored); the server loads it with `process.loadEnvFile`.
- The endpoint supports strict JSON schema output. A live call takes about 1 s.
