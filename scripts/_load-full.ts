import { loadSource } from "@tpm/adapters";
const path = process.argv[2] ?? "te_process.csv";
const t = performance.now();
let last = t;
const source = await loadSource(path, {
  onProgress: (rows) => {
    const now = performance.now();
    if (now - last > 10000) { last = now; console.log(`${rows} rows, ${((now - t) / 1000).toFixed(0)} s, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`); }
  },
});
const ms = performance.now() - t;
console.log(JSON.stringify({ ms, n: source.grid.n, dt: source.grid.dt, sensors: source.grid.aliases.length, stats: source.stats, episodesSample: source.grid.episodes.slice(0, 5), names: source.sourceNames.slice(0, 5) }, null, 1));
