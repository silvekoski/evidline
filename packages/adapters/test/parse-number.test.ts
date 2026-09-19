import { describe, expect, it } from "vitest";
import { parseNumber } from "../src/index";

describe("parseNumber", () => {
  it("accepts decimal points and decimal commas", () => {
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("-2,5")).toBe(-2.5);
    expect(parseNumber(" 7 ")).toBe(7);
    expect(parseNumber("1e3")).toBe(1000);
  });

  it("accepts thousands separators", () => {
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("1.234.567")).toBe(1234567);
  });

  it("returns NaN for empty and non-numeric text", () => {
    expect(parseNumber("")).toBeNaN();
    expect(parseNumber("   ")).toBeNaN();
    expect(parseNumber("abc")).toBeNaN();
    expect(parseNumber("NaN")).toBeNaN();
    expect(parseNumber("Infinity")).toBeNaN();
    expect(parseNumber("0x10")).toBeNaN();
    expect(parseNumber("2026-01-01")).toBeNaN();
  });
});
