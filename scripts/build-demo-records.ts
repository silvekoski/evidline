import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mulberry32 } from "@tpm/core";

const SEED = 7;
const DAYS = 60;
const ROWS_PER_HOUR = 150;
const T0 = Date.parse("2026-03-01T00:00:00Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TERMINALS = Array.from({ length: 8 }, (_, i) => `T${i + 1}`);
const CENTS_TERMINAL = "T3";
const CITIES = ["Helsinki", "Espoo", "Tampere", "Vantaa", "Oulu", "Turku"];
const POSTCODES = ["00100", "02100", "33100", "01300", "90100", "20100"];
const NOTES = ["gift wrap", "leave at door", "call first", "ring twice", "no receipt"];
const TAX_RATE = 0.255;
const NULL_FROM_DAY = 40;
const CENTS_FROM_DAY = 35;
const TYPO_FROM_DAY = 20;
const TYPO_RATE_AT_END = 0.3;
const DEMAND_FROM_DAY = 50;
const DEMAND_DROP = 0.3;
const BASKET_DROP = 0.15;

const [outArg = "data/demo-records.csv"] = process.argv.slice(2);
const out = resolve(outArg);
const truthPath = out.replace(/\.csv$/, "") + ".truth.json";

const rng = mulberry32(SEED);
const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)]!;

function typo(text: string): string {
  const i = Math.floor(rng() * text.length);
  return text.slice(0, i) + text.charAt(i).toUpperCase() + (rng() < 0.5 ? "" : text.charAt(i)) + text.slice(i + 1);
}

const lines = ["time,orderId,terminal,postcode,city,net,tax,gross,note"];
let order = 0;
const counts = { rows: 0, nullPostcode: 0, centsRows: 0, typoRows: 0 };
for (let hour = 0; hour < DAYS * 24; hour++) {
  const day = hour / 24;
  const daily = 1 + 0.35 * Math.sin((2 * Math.PI * (hour % 24)) / 24 - Math.PI / 2);
  const demand = day >= DEMAND_FROM_DAY ? 1 - DEMAND_DROP : 1;
  const rows = Math.round(ROWS_PER_HOUR * daily * demand * (0.9 + 0.2 * rng()));
  for (let r = 0; r < rows; r++) {
    const time = new Date(T0 + hour * HOUR_MS + Math.floor(rng() * HOUR_MS)).toISOString();
    order++;
    const terminal = pick(TERMINALS);
    const place = Math.floor(rng() * CITIES.length);
    const basket = day >= DEMAND_FROM_DAY ? 1 - BASKET_DROP : 1;
    let net = Math.round(100 * basket * (15 + 60 * rng() * rng())) / 100;
    let tax = Math.round(100 * net * TAX_RATE) / 100;
    let gross = Math.round(100 * (net + tax)) / 100;
    if (terminal === CENTS_TERMINAL && day >= CENTS_FROM_DAY) {
      net = Math.round(net * 100);
      tax = Math.round(tax * 100);
      gross = Math.round(gross * 100);
      counts.centsRows++;
    }
    const nullPostcode = day >= NULL_FROM_DAY;
    if (nullPostcode) counts.nullPostcode++;
    let note = rng() < 0.6 ? pick(NOTES) : "";
    const typoRate = day >= TYPO_FROM_DAY ? (TYPO_RATE_AT_END * (day - TYPO_FROM_DAY)) / (DAYS - TYPO_FROM_DAY) : 0;
    if (note !== "" && rng() < typoRate) {
      note = typo(note);
      counts.typoRows++;
    }
    lines.push(
      [time, `ORD-${String(order).padStart(7, "0")}`, terminal, nullPostcode ? "" : POSTCODES[place]!, CITIES[place]!, net.toFixed(2), tax.toFixed(2), gross.toFixed(2), note].join(","),
    );
    counts.rows++;
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");

const dayMs = (day: number) => new Date(T0 + day * DAY_MS).toISOString();
const truth = {
  output: outArg,
  seed: SEED,
  t0: new Date(T0).toISOString(),
  days: DAYS,
  rows: counts.rows,
  fields: ["time", "orderId", "terminal", "postcode", "city", "net", "tax", "gross", "note"],
  faults: [
    { kind: "dead", field: "postcode", metric: "postcode.nullRate", fromDay: NULL_FROM_DAY, from: dayMs(NULL_FROM_DAY), rows: counts.nullPostcode, expected: "sensor-dead or sensor-drift: the null rate goes to 1" },
    { kind: "gain", field: "net", metric: "net.median[terminal=T3]", source: CENTS_TERMINAL, fromDay: CENTS_FROM_DAY, from: dayMs(CENTS_FROM_DAY), factor: 100, rows: counts.centsRows, expected: "sensor-drift-gain: the terminal sends cents" },
    { kind: "bias", field: "note", metric: "note.formatViolationRate", fromDay: TYPO_FROM_DAY, from: dayMs(TYPO_FROM_DAY), rateAtEnd: TYPO_RATE_AT_END, rows: counts.typoRows, expected: "sensor-drift-bias: the typo rate ramps" },
    { kind: "process", metrics: ["rows.count", "net.median", "gross.median"], fromDay: DEMAND_FROM_DAY, from: dayMs(DEMAND_FROM_DAY), rowDrop: DEMAND_DROP, basketDrop: BASKET_DROP, expected: "process fault: demand and basket value move together" },
  ],
};
writeFileSync(truthPath, JSON.stringify(truth, null, 2) + "\n");
console.log(`wrote ${outArg}: ${counts.rows} rows over ${DAYS} days`);
console.log(`postcode null from day ${NULL_FROM_DAY} (${counts.nullPostcode} rows), ${CENTS_TERMINAL} in cents from day ${CENTS_FROM_DAY} (${counts.centsRows} rows), note typos ramp from day ${TYPO_FROM_DAY} (${counts.typoRows} rows), demand -${DEMAND_DROP * 100}% and basket -${BASKET_DROP * 100}% from day ${DEMAND_FROM_DAY}`);
console.log(`wrote ${truthPath}`);
