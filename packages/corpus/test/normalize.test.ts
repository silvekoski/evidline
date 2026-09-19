import { describe, expect, it } from "vitest";
import { chunkSegments, normalizeFile, parseVtt, speakerTurns, stripQuotedReplies } from "../src/index";
import { docx, eml, markdown, pdf, pptx, sensorCsv, tagCsv, vtt } from "./fixtures";

const file = (name: string, content: string | Buffer) => ({ name, mediaType: "application/octet-stream", content: Buffer.isBuffer(content) ? content : Buffer.from(content) });

describe("vtt", () => {
  it("parses cues with speakers and merges close cues of one speaker into a turn", () => {
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 4000, speaker: "Matti Virtanen" });
    const turns = speakerTurns(cues);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.locator).toEqual({ kind: "teams_call", startMs: 1000, endMs: 7000, speaker: "Matti Virtanen" });
    expect(turns[0]!.text).toContain("PM2_DR3_STM_VLV_POS");
  });

  it("normalizes an uploaded vtt as a teams call", async () => {
    const n = await normalizeFile(file("call.vtt", vtt));
    expect(n.kind).toBe("teams_call");
    expect(n.segments).toHaveLength(2);
  });
});

describe("email", () => {
  it("strips quoted replies and signatures", () => {
    const text = stripQuotedReplies("Answer here.\n\nTerveisin,\nMatti\n\nOn Mon wrote:\n> old");
    expect(text).toBe("Answer here.");
  });

  it("normalizes an eml with subject, sender, date, and one segment", async () => {
    const n = await normalizeFile(file("mail.eml", eml));
    expect(n.kind).toBe("email");
    expect(n.title).toBe("Re: Tag list question");
    expect(n.occurredAt).toBe("2026-03-03T08:15:00.000Z");
    expect(n.segments).toHaveLength(1);
    expect(n.segments[0]).toMatchObject({ speaker: "Matti Virtanen", locator: { kind: "email", messageId: "<abc123@example.com>" } });
    expect(n.segments[0]!.text).not.toContain("What is xmeas_7");
    expect(n.segments[0]!.text).not.toContain("Terveisin");
  });
});

describe("tabular", () => {
  it("marks a numeric csv as sensor data and keeps only the headers", async () => {
    const n = await normalizeFile(file("plant.csv", sensorCsv));
    expect(n.status).toBe("sensor_data");
    expect(n.headers).toEqual(["time", "xmeas_1", "xmeas_2", "xmv_1"]);
    expect(n.segments).toHaveLength(1);
    expect(n.segments[0]!.text).not.toContain("2.25");
  });

  it("turns a tag list with a semicolon delimiter into one segment per row", async () => {
    const n = await normalizeFile(file("tags.csv", tagCsv));
    expect(n.status).toBe("processed");
    expect(n.segments.map((s) => s.text)).toEqual(["tag: PM2_DR3_STM_VLV_POS; description: Dryer 3 steam valve position; unit: %", "tag: xmeas_7; description: Reactor pressure; unit: kPa"]);
    expect(n.segments[1]!.locator).toMatchObject({ kind: "file", sheet: "csv", row: 2 });
  });
});

describe("documents", () => {
  it("splits markdown by paragraph and starts a block at each heading", async () => {
    const n = await normalizeFile(file("notes.md", markdown));
    expect(n.segments.map((s) => s.block)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(n.segments[3]!.text).toBe("xmeas_7 is the reactor pressure. The unit is kPa gauge.");
    const loc = n.segments[3]!.locator;
    expect(loc.kind === "file" && markdown.slice(loc.charStart, loc.charEnd)).toBe("xmeas_7 is the reactor pressure. The unit is kPa gauge.");
  });

  it("reads pptx slides with slide numbers", async () => {
    const n = await normalizeFile(file("deck.pptx", await pptx([["Title", "Dryer 3 overview"], ["The valve sticks after a wash."]])));
    expect(n.segments.map((s) => [s.text, s.locator.kind === "file" ? s.locator.page : null])).toEqual([["Title", 1], ["Dryer 3 overview", 1], ["The valve sticks after a wash.", 2]]);
  });

  it("reads docx paragraphs and headings", async () => {
    const n = await normalizeFile(file("spec.docx", await docx([{ heading: "Reactor", text: "xmeas_7 is the reactor pressure." }, { heading: "Dryer", text: "The valve sticks." }])));
    expect(n.segments.map((s) => s.text)).toEqual(["Reactor", "xmeas_7 is the reactor pressure.", "Dryer", "The valve sticks."]);
    expect(new Set(n.segments.map((s) => s.block)).size).toBe(2);
  });

  it("reads pdf pages with page numbers and flags a pdf without text", async () => {
    const n = await normalizeFile(file("report.pdf", pdf(["The reactor pressure xmeas_7 is logged every 3 minutes.", "Dryer 3 valve position sticks after a wash."])));
    expect(n.status).toBe("processed");
    expect(n.segments.map((s) => (s.locator.kind === "file" ? s.locator.page : null))).toEqual([1, 2]);
    expect(n.segments[1]!.text).toContain("Dryer 3");
    const blank = await normalizeFile(file("scan.pdf", pdf(["", ""])));
    expect(blank.status).toBe("needs_ocr");
  });

  it("rejects msg and unknown types with a reason", async () => {
    await expect(normalizeFile(file("mail.msg", "x"))).rejects.toThrow(".eml");
    await expect(normalizeFile(file("data.bin", "x"))).rejects.toThrow("unsupported file type .bin");
  });
});

describe("chunker", () => {
  it("never splits a speaker turn and spans the locator over the turns", () => {
    const turns = speakerTurns(parseVtt(vtt));
    const chunks = chunkSegments("teams_call", turns);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.locator).toEqual({ kind: "teams_call", startMs: 1000, endMs: 15000, speaker: null });
    expect(chunks[0]!.text.startsWith("Matti Virtanen: ")).toBe(true);
  });

  it("uses the page as a hard limit and stays under the token limit", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says that the dryer valve sticks after each wash cycle.`).join(" ");
    const n = await normalizeFile(file("report.pdf", pdf(["Page one is short.", "Page two is short too."])));
    const chunks = chunkSegments("file", [...n.segments, { text: long, speaker: null, block: 3, locator: { kind: "file", page: 3, sheet: null, row: null, charStart: 0, charEnd: long.length } }]);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0]!.locator).toMatchObject({ page: 1 });
    expect(chunks[1]!.locator).toMatchObject({ page: 2 });
    expect(chunks.every((c) => c.tokens <= 400)).toBe(true);
  });

  it("makes one chunk per slack message with the parent as context", () => {
    const seg = (text: string, ts: string) => ({ text, speaker: "anna", block: 0, locator: { kind: "slack_thread", channelId: "C1", ts, threadTs: "1.0" } as const });
    const chunks = chunkSegments("slack_thread", [seg("Parent question", "1.0"), seg("Reply one", "1.1")]);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.text).toBe("anna: Parent question\n\nanna: Reply one");
  });
});
