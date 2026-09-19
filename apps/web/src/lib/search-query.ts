import { FaultClass, HealthClass, InferenceStatus, Role, SignalType, Stage, healthToFault, type SearchFacet, type SearchQuery } from "@tpm/schemas";

export type Searchable = { text: string; facets: Set<string> };

type Field = SearchFacet["field"];

export const facetKey = (field: Field, value: string): string => `${field}:${value}`;

const facet = (field: Field, value: string): SearchFacet => ({ field, value }) as SearchFacet;
const driftFaults = FaultClass.options.filter((fc) => fc.startsWith("sensor-drift"));

const vocabulary = new Map<string, SearchFacet[]>();
const add = (words: string, ...facets: SearchFacet[]) => {
  for (const word of words.split("|")) vocabulary.set(word, [...(vocabulary.get(word) ?? []), ...facets]);
};

add("sensor|field|signal|column|tag", facet("kind", "sensor"));
add("inference|claim", facet("kind", "inference"));
for (const role of Role.options) add(role, facet("role", role));
for (const type of SignalType.options) add(type, facet("signalType", type));
add("healthy", facet("health", "healthy"));
for (const health of HealthClass.options) add(health, facet("health", health), facet("faultClass", healthToFault(health)));
add("spiky", ...vocabulary.get("spikes")!);
add("noise", ...vocabulary.get("noisy")!);
add("saturation", ...vocabulary.get("saturated")!);
add("missing", ...vocabulary.get("dropout")!);
add("flat|flatline|frozen", ...vocabulary.get("stuck")!, ...vocabulary.get("dead")!);
for (const stage of Stage.options) add(stage, facet("stage", stage));
add("incident|fault", facet("stage", "diagnosis"));
add("check", facet("stage", "health"));
add("drift", facet("drift", "drifting"), ...driftFaults.map((fc) => facet("faultClass", fc)));
add("drifting", facet("drift", "drifting"), ...driftFaults.map((fc) => facet("faultClass", fc)));
add("bias", facet("faultClass", "sensor-drift-bias"));
add("gain", facet("faultClass", "sensor-drift-gain"));
add("hidden|control loop", facet("faultClass", "sensor-drift-hidden"));
add("degradation|degrading|degraded", facet("faultClass", "process-degradation"), facet("faultClass", "process-slow-degradation"));
add("slow degradation", facet("faultClass", "process-slow-degradation"));
add("oscillation|oscillating|oscillates", facet("faultClass", "process-oscillation"));
add("shift|step shift", facet("faultClass", "process-step"));
add("logging", facet("faultClass", "data-logging"));
add("process|process fault", facet("family", "process"));
add("sensor fault", facet("family", "sensor"));
add("data fault", facet("family", "data"));
add("responsible|cause|causing|culprit|driver|root", facet("drift", "responsible"));
add("victim", facet("drift", "victim"));
add("in-range|in range|normal range|within range", facet("drift", "in-range"));
for (const status of InferenceStatus.options) add(status, facet("status", status));
add("override|overrides", facet("status", "overridden"));
add("new|open", facet("status", "proposed"));
add("low|weak|uncertain|unsure|doubtful", facet("confidence", "low"));
add("high|strong|confident|sure|certain", facet("confidence", "high"));

const stopWords = new Set(
  "the a an of in on at for with which what where who whose that this these those is are was were be all any show find list give get me my us go to and has have than from by it its i do does please want see look search jump confidence".split(" "),
);

const lookup = (word: string) => vocabulary.get(word) ?? vocabulary.get(word.replace(/s$/, "")) ?? vocabulary.get(`${word}s`);

export function compileQuery(text: string): { query: SearchQuery; unknown: string[] } {
  const tokens = text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const clauses: SearchFacet[][] = [];
  const unknown: string[] = [];
  let join = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "or") {
      join = clauses.length > 0;
      continue;
    }
    const next = tokens[i + 1];
    const bigram = next === undefined ? undefined : (vocabulary.get(`${token} ${next}`) ?? vocabulary.get(`${token} ${next.replace(/s$/, "")}`));
    let facets: SearchFacet[];
    if (bigram) {
      facets = bigram;
      i++;
    } else if (stopWords.has(token)) {
      continue;
    } else if (/^s\d{2,4}$/.test(token)) {
      facets = [facet("sensor", token.toUpperCase())];
    } else {
      const known = lookup(token);
      facets = known ?? [facet("text", token.slice(0, 40))];
      if (!known) unknown.push(token);
    }
    if (join) clauses[clauses.length - 1]!.push(...facets);
    else clauses.push([...facets]);
    join = false;
  }
  return { query: { clauses: clauses.slice(0, 8) }, unknown };
}

const matchesText = (text: string, term: string) => text.includes(term) || text.includes(term.replace(/s$/, ""));

export const matches = (item: Searchable, query: SearchQuery): boolean =>
  query.clauses.every((clause) =>
    clause.some((f) => (f.field === "text" ? matchesText(item.text, f.value.toLowerCase()) : item.facets.has(facetKey(f.field, f.value)))),
  );

const label: Record<Field, string> = {
  kind: "",
  sensor: "",
  text: "",
  role: "role",
  signalType: "signal type",
  health: "health",
  stage: "stage",
  family: "fault family",
  faultClass: "fault",
  status: "status",
  drift: "drift",
  confidence: "confidence",
};

export const describeQuery = (query: SearchQuery): string =>
  query.clauses.length === 0
    ? "everything"
    : query.clauses.map((clause) => clause.map((f) => (f.field === "text" ? `"${f.value}"` : `${label[f.field]} ${f.value}`.trim())).join(" or ")).join(", ");
