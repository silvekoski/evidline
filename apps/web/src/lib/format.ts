export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (Number.isInteger(x)) return x.toLocaleString("en-US");
  if (Math.abs(x) >= 1000) return x.toFixed(0);
  return String(Number(x.toPrecision(3)));
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
