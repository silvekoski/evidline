import { loadSource } from "@tpm/adapters";
import { binarySegmentation, median } from "@tpm/core";
const source = await loadSource(process.argv[2] ?? "data/tep-subset.csv");
const { grid } = source;
const counts = new Map<number, number>();
grid.values.forEach((x, i) => {
  const medians = Float64Array.from(grid.episodes, (e) => median(x.subarray(e.from, e.to)));
  const cps = binarySegmentation(medians);
  for (const c of cps) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (i < 6) console.log(grid.aliases[i], "episode change points", JSON.stringify(cps));
});
console.log("shared", JSON.stringify([...counts.entries()].sort((a, b) => a[0] - b[0])));
