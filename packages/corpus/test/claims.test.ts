import { describe, expect, it } from "vitest";
import { hashEmbed } from "@tpm/egress";
import { extractClaimsLocally, fuseRanks, linkClaim, verifyQuote, wordsToTurns } from "../src/index";

const columns = [
  { name: "xmeas_7", alias: "S07", phrases: ["reactor pressure"] },
  { name: "PM2_DR3_STM_VLV_POS", alias: "S12", phrases: ["dryer 3 steam valve"] },
];

describe("quote verifier", () => {
  it("accepts an exact quote after whitespace and case normalization", () => {
    expect(verifyQuote("The  valve STICKS", "Matti: the valve sticks after a wash.", false)).toMatchObject({ ok: true, method: "exact" });
  });
  it("rejects an invented quote", () => {
    expect(verifyQuote("the pump failed", "the valve sticks after a wash.", false).ok).toBe(false);
    expect(verifyQuote("the pump failed", "the valve sticks after a wash.", true).ok).toBe(false);
  });
  it("accepts a transcript quote with a small speech-to-text error", () => {
    const check = verifyQuote("höyryventtiili jumittuu pesun jälkeen", "Matti: Kuivaimen 3 höyryventiili jumittuu pesun jälkeen ja se näkyy datassa.", true);
    expect(check.ok).toBe(true);
    expect(check.similarity).toBeGreaterThanOrEqual(0.9);
  });
});

describe("local extractor", () => {
  it("makes a person claim from each sentence that names a column", () => {
    const chunk = "Matti Virtanen: xmeas_7 is the reactor pressure in kPa gauge. We log it every 3 minutes.\nAnna: The dryer 3 steam valve sticks after a wash.";
    const claims = extractClaimsLocally(chunk, null, columns);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ column: "xmeas_7", speaker: "Matti Virtanen", provenance: "person" });
    expect(claims[1]).toMatchObject({ column: "PM2_DR3_STM_VLV_POS", speaker: "Anna" });
    expect(verifyQuote(claims[0]!.quote, chunk, false).ok).toBe(true);
  });
  it("does not match a column name inside a longer word", () => {
    expect(extractClaimsLocally("The xmeas_71 sensor is broken today.", null, columns)).toHaveLength(0);
  });
});

describe("linker", () => {
  const cols = columns.map((c, i) => ({ ...c, id: i + 1, vector: hashEmbed(`${c.name} ${c.phrases.join(" ")}`) }));
  it("scores a named column above the limit and an unrelated column below it", () => {
    const links = linkClaim("The reactor pressure is in kPa gauge.", hashEmbed("The reactor pressure is in kPa gauge."), null, cols);
    expect(links[0]).toMatchObject({ columnId: 1 });
    expect(links[0]!.score).toBeGreaterThanOrEqual(1);
    expect(links.find((l) => l.columnId === 2)).toBeUndefined();
  });
  it("links a claim that the extractor named", () => {
    expect(linkClaim("It is logged every 3 minutes.", null, "S07", cols)).toEqual([{ columnId: 1, score: 1 }]);
  });
});

describe("rank fusion", () => {
  it("puts a hit found by both lists first", () => {
    const fused = fuseRanks([[1, 2, 3], [3, 4]]);
    expect(fused[0]).toMatchObject({ id: 3, ranks: [3, 1] });
    expect(fused[0]!.score).toBeCloseTo(1 / 63 + 1 / 61);
  });
});

describe("transcript words", () => {
  it("groups words into speaker turns with millisecond locators and breaks on a long gap", async () => {
    const w = (text: string, start: number, end: number, speaker: string, type: "word" | "spacing" = "word") => ({ text, start, end, type, speaker_id: speaker });
    const words = [w("Venttiili", 0.0, 0.5, "speaker_0"), w(" ", 0.5, 0.6, "speaker_0", "spacing"), w("jumittuu.", 0.6, 1.1, "speaker_0"), w("Okay.", 1.5, 1.9, "speaker_1"), w("Later", 9.0, 9.4, "speaker_1")];
    const turns = wordsToTurns(words);
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([["Speaker 0", "Venttiili jumittuu."], ["Speaker 1", "Okay."], ["Speaker 1", "Later"]]);
    expect(turns[0]!.locator).toEqual({ kind: "teams_call", startMs: 0, endMs: 1100, speaker: "Speaker 0" });
  });
});
