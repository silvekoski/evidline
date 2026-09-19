# Core integration validation

Validated on 2026-09-19. The resumed implementation includes the pipeline, demo generators, canary, and integration tests. The resume fix moves demo fixture loading and pipeline setup into `beforeAll`, so absent fixtures skip safely and individual tests can run independently.

## Measured demo results

- Stream: 20,160 rows, 52 sensors, 21 episodes. Pipeline: 20,932 ms, below the 60 s limit.
- Dead injection: S18, row 12,096. The health incident is `sensor-dead`.
- Bias injection: S07, row 14,112, reaching 8 residual sigma. Estimated onset: 14,431, 319 samples after injection. CUSUM crossing: 562 samples after the estimated onset, or 881 samples after injection. At 3 minutes per sample, the crossing delay from injection is 1.84 days. S07 is responsible, ranked first, and in range at detection.
- Process fault 13: true onset 19,360; estimated onset 19,448, a difference of 88 samples (264 minutes).
- Records: 205,108 rows over 60 days, with the four planted faults.
- Canary: 11 successful calls, 13 records including two blocked negative cases, zero scanner hits on valid payloads. No external model is called.

## Departures retained from the saved implementation

These are implementation differences from the build spec, not new algorithm changes made during the resume:

- Shared baseline changes require `max(3, ceil(25% of sensors))` sensors. Change magnitude uses the scale before the change. A persistent health failure can shorten the baseline, with the cut snapped to an episode boundary. This keeps later faults out of the baseline.
- Peer drift magnitude uses blocks of `floor(n / 200)` even when trend blocks span a day. Calibration uses the same magnitude calculation. This preserves short deviations that a daily median can hide.
- Isolation tests use a window around detection, ending two trend blocks after the alarm, instead of the entire remaining series. Later process faults therefore do not invalidate earlier sensor isolation.
- `inRange` uses the block ending at the alarm for detected drift, rather than the final block. This follows the requested integration test's requirement to assess range at detection.
- Fault grouping can connect sensors through a shared neighbor. A group with at least `max(3, ceil(10% of sensors))` drivers can absorb coincident drivers. Grouping uses baseline autocorrelation time so a later step cannot inflate the time tolerance.
- Diagnostic statistics end at the next incident onset, with a minimum window of 100 samples. Incident display windows still extend to the end of the grid.
- Ranked contributions use normalized maximum deviations and place drivers before victims, rather than ranking by PCA contributions. PCA remains separate supporting evidence. This is a substantive departure from the specified ranking method.
- PCA residual contributions are corrected by loading leverage; the aggregate SPE remains the sum of squared residuals.
- The demo ramp starts at 70% of rows; the dead fault starts at 60%. The canary uses stationary AR(1) signals with unique perturbations rather than random walks.
- The records generator changes row count and basket value for the demand fault. It has no separate conversion field.

`runPipeline(grid, sink, options)` returns the ten core stages with timings and counts. The adapter and model-call stages remain with the caller. Both calibration results are merged into the final thresholds. Per-sensor baseline change points are passed to fault separation. No dependencies were added and no commit was made during the resume.
