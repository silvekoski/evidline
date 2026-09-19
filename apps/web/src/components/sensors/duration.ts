const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export function formatDuration(samples: number, dt: number | null): string {
  const count = `${Number.isInteger(samples) ? samples : samples.toFixed(1)} sample${samples === 1 ? "" : "s"}`;
  if (dt === null) return count;
  const ms = samples * dt;
  const span = ms < hour ? `${Math.round(ms / minute)} min` : ms < 2 * day ? `${(ms / hour).toFixed(1)} h` : `${(ms / day).toFixed(1)} d`;
  return `${count} (${span})`;
}
