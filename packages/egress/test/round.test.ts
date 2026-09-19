import { describe, expect, it } from "vitest";
import { roundPayload, roundSig } from "../src/index";

describe("roundPayload", () => {
  it("keeps integers exact and rounds fractions to 3 significant digits", () => {
    const rounded = roundPayload({
      count: 1234567,
      ratio: 0.123456,
      list: [0.000123456, 2.5, 7, -98765.4321],
      nested: { p99: 1234.5678, text: "0.123456", flag: true, none: null },
    });
    expect(rounded).toEqual({
      count: 1234567,
      ratio: 0.123,
      list: [0.000123, 2.5, 7, -98800],
      nested: { p99: 1230, text: "0.123456", flag: true, none: null },
    });
  });

  it("rounds a single value the same way", () => {
    expect(roundSig(0.123456)).toBe(0.123);
    expect(roundSig(20000)).toBe(20000);
    expect(roundSig(roundSig(0.123456))).toBe(0.123);
  });
});
