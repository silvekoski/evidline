import { describe, expect, it } from "vitest";
import { window } from "../src/types";
import { minEpisodeLength, usableEpisodes } from "../src/usable-episodes";

describe("usableEpisodes", () => {
  it("minEpisodeLength is the larger of the health block and the splittable span", () => {
    expect([1200, 20160, 76800, 239532].map(minEpisodeLength)).toEqual([64, 410, 1558, 4838]);
  });

  it("merges many short episodes into one window", () => {
    const short = Array.from({ length: 100 }, (_, i) => window(12 * i, 12 * i + 12));
    expect(usableEpisodes(short, 1200)).toEqual([window(0, 1200)]);
  });

  it("keeps long episodes and a single episode", () => {
    const long = [window(0, 400), window(400, 800), window(800, 1200)];
    expect(usableEpisodes(long, 1200)).toBe(long);
    const one = [window(0, 1200)];
    expect(usableEpisodes(one, 1200)).toBe(one);
  });
});
