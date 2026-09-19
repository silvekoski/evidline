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

## Measured on the demo stream (2026-09-19)

- Pipeline time about 19 s for 20,160 rows and 52 sensors. Baseline: the first 11,520 samples (the dead sensor cuts it at an episode boundary).
- Incidents: `Sensor fault: dead` on S18 from sample 11,835. `Sensor fault: drift` on S07 (ranked first, responsible, in range at detection, onset 14,431 against the injection at 14,112). `Process fault: degradation` for the fault 13 episode (onset 19,448 against the truth 19,360).
- The engine labels fault 13 as degradation, not slow degradation: the deviation after the onset is not monotone because the control loops react. The demo says what the engine says.
- Ranked contributions come from normalized maximum deviations with drivers before victims. PCA T2 and SPE stay as supporting evidence in the trace. The agent measured that raw PCA contributions ranked by unit size on this data.
- Roles on TE: 25 of 52 sensors are unknown or tied. Tightly coupled pressures form a redundancy group by the PRD rule. Sensors with a clear role for the demo: S46 (upstream, confidence 1.0), S12, S15, S17, S48, S49, S52 (redundant pairs of a level and its valve), S43 (downstream 0.67).

## Engine rules added after the records run (2026-09-19, evening)

- The records adapter quarantines constant metrics and number fields that are exact functions of other fields (`gross = net + tax`). It passes sibling sets to the grid: the same metric split over the values of one category field.
- Fault separation: drivers that leave their siblings while the other sources hold form a source incident (`Sensor fault: drift (gain)` for the cents terminal). Bias against gain uses the level ratio and the noise ratio between the baseline and the incident window, or the Spearman level test.
- Health failures with the same class and the same onset block form one incident (24 postcode-derived metrics become 2 incidents).
- The drift detector tries three models in order: the full peer model, the peer model without redundancy group members, then the distribution path. A sensor whose group moves together is still found.
- A driver becomes a victim of another driver when adding that driver as a regressor halves its deviation and brings it under the limit (measured in the original sigma).
- The minimum baseline is clamp(10% of n, 200, 1000) samples. A sensor that is constant in the baseline but changes later is healthy with a note, not dead.
- The noisy check needs the block level inside the baseline p1..p99 (a scale change is not noise). The plant-wide noise exemption counts raw block noise. Saturation needs a fine resolution: (p99 - p1) / step >= 50.
- The distance path uses a window of clamp(n / 40, 50, 5000) and a spread floor of 0.5 scale units. A 30% demand drop under a daily cycle of larger amplitude stays below the limit: the records demo shows the dead field and the gain fault, not the demand drop.
- The leak index collapses repeated consecutive values so a sample-and-hold sensor is caught and a repeated histogram share is not.

## Storage and the final state (2026-09-19, night)

- Derived evidence series are stored at most 4,096 points with a stride, and expanded on read. A stream run now costs about 12 MB in `data/tpm.db`; before it cost about 30 MB. There is no delete route: remove `data/tpm.db*` to start clean.
- Histogram shares stay at 3 significant digits. On the records demo one `name_role` payload of 132 collides with a run of three rounded raw samples and the leak guard blocks it. That is the guard at work, not a leak. The stream demo has 0 hits.
- The Norrin endpoint (OpenAI-compatible, Mistral Large 3) works in mode `cloud`: 55 calls sent for the stream demo, 0 blocked, model prose validated for all 3 incidents, hypothesis names on all 52 sensors.

## Palette search (2026-09-19, night)

- The command palette gets a query language instead of a substring filter: a list of clauses over fixed facets (health, role, stage, fault class, drift role, confidence, alias, text). The browser compiles known words itself, so search is instant and works with the model off.
- The model gets the same job as `compile_rule`: it compiles operator text into that filter through the gateway, as purpose `search`. It never sees the sensor list and never picks a result. The client applies the filter to real data, and the palette shows the filter as words with a link to the egress record.
- The palette calls the model only when the local result is empty and the text holds words outside the list. Every keystroke does not become an egress record.
- The template holds a worked example for AND against OR. Without it, Mistral Large 3 put `kind sensor` inside each clause, which matched every sensor.
- Web unit tests live in `apps/web/test` as a vitest project. The web typecheck covers `src` only.


## Diagnosis screen (2026-09-19, night)

- The Diagnosis screen follows the Drift layout: small incident cards on the left, one detail on the right, selected by the hash. The first incident in sort order is selected when the hash is empty.
- A card renders with no fetch. Its contribution strip is CSS only: a white block for the lead, gray blocks for ranks 2 to 5, a dim tail for the rest, and a hatch for an incident that the health gate decided.
- The detail renders one proof chart inline through `EvidenceChart`: the residual evidence that the isolation step cites, or the health evidence for a gated incident. The thin peer lines stay out of the inline chart because peers on other scales flatten the lead. The chip next to the caption opens the full chart.
- The PCA statistics are a CSS meter, not a recharts chart: two bars on a linear scale of 0 to 4 times the limit, a dotted limit line, a white fill above the limit and a dark fill inside it. A ratio above 4 shows a double chevron and the multiple.
- The ranked table keeps the engine order and never sorts. It shows the top 5 with a Show all button. A highlighted alias past row 5 opens the table.
- A hash alias resolves in this order: incident id, lead sensor, the health incident that owns the excluded alias, any incident that mentions the alias.
- `useEvidenceOfKind(ids, kind)` in `hooks` is the shared picker for an inline line chart. It picks in id order and stops at the first pending query, so the choice does not flip. `useResidual` on the Drift screen delegates to it.
- Radix `ScrollArea` sets `position: relative` inline, so `xl:sticky` on it never applied and `top-16` pushed the list down by 56 px on both screens. The sticky classes now sit on a wrapper div.
- On a hash selection the screen scrolls the detail into view and moves focus to it. Below xl the detail sits above the list, so a card tap would otherwise change nothing on screen.
