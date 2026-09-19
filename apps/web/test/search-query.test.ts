import { describe, expect, it } from "vitest";
import { compileQuery, describeQuery, facetKey, matches, type Searchable } from "../src/lib/search-query";

const item = (text: string, ...facets: string[]): Searchable => ({ text, facets: new Set(facets) });
const s12 = item("s12 reactor pressure controlled dead", "kind:sensor", "sensor:S12", "role:controlled", "health:dead", "confidence:low");
const s07 = item("s07 stripper flow actuator healthy", "kind:sensor", "sensor:S07", "role:actuator", "health:healthy", "drift:drifting", "drift:responsible", "drift:in-range", "confidence:high");
const incident = item("inf-1 sensor fault: dead", "kind:inference", "stage:diagnosis", "faultClass:sensor-dead", "family:sensor", "sensor:S12");
const drift = item("inf-2 s07 drifts from its peers", "kind:inference", "stage:drift", "sensor:S07", "drift:drifting", "drift:responsible");
const all = [s12, s07, incident, drift];
const hits = (text: string) => all.filter((x) => matches(x, compileQuery(text).query));

describe("compileQuery", () => {
  it("maps known words to facets and keeps unknown words as text", () => {
    const { query, unknown } = compileQuery("dead pressure sensors");
    expect(query.clauses).toEqual([
      [{ field: "health", value: "dead" }, { field: "faultClass", value: "sensor-dead" }],
      [{ field: "text", value: "pressure" }],
      [{ field: "kind", value: "sensor" }],
    ]);
    expect(unknown).toEqual(["pressure"]);
  });

  it("reads aliases, plurals, phrases, stop words and or", () => {
    expect(compileQuery("S07").query.clauses).toEqual([[{ field: "sensor", value: "S07" }]]);
    expect(compileQuery("actuators").query.clauses).toEqual([[{ field: "role", value: "actuator" }]]);
    expect(compileQuery("which are in range").query.clauses).toEqual([[{ field: "drift", value: "in-range" }]]);
    expect(compileQuery("process faults").query.clauses).toEqual([[{ field: "family", value: "process" }]]);
    expect(compileQuery("dead or stuck").query.clauses).toHaveLength(1);
    expect(compileQuery("dead or stuck").query.clauses[0]).toHaveLength(4);
    expect(compileQuery("").query.clauses).toEqual([]);
  });
});

describe("matches", () => {
  it("needs every clause and any facet inside a clause", () => {
    expect(hits("dead")).toEqual([s12, incident]);
    expect(hits("dead sensors")).toEqual([s12]);
    expect(hits("dead or actuator")).toEqual([s12, s07, incident]);
    expect(hits("responsible")).toEqual([s07, drift]);
    expect(hits("drifting in range")).toEqual([s07]);
    expect(hits("pressure")).toEqual([s12]);
    expect(hits("S12")).toEqual([s12, incident]);
    expect(hits("low confidence")).toEqual([s12]);
    expect(hits("valve")).toEqual([]);
    expect(hits("")).toEqual(all);
  });

  it("matches a text facet without its plural s", () => {
    expect(matches(item("reactor pressure"), { clauses: [[{ field: "text", value: "Pressures" }]] })).toBe(true);
    expect(facetKey("role", "actuator")).toBe("role:actuator");
  });
});

describe("describeQuery", () => {
  it("writes the filter as words", () => {
    expect(describeQuery({ clauses: [] })).toBe("everything");
    expect(describeQuery(compileQuery("dead or dropout pressure sensors").query)).toBe(
      'health dead or fault sensor-dead or health dropout or fault sensor-dropout, "pressure", sensor',
    );
  });
});
