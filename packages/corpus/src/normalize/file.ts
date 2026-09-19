import { extname } from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";
import { extractText } from "unpdf";
import { stripQuotedReplies } from "../email-clean";
import type { Attachment, Normalized, SegmentDraft } from "../types";
import { parseVtt, speakerTurns } from "../vtt";
import { classifySheets, parseCsv, parseXlsx } from "./tabular";
import { fileLocator, paragraphSegments } from "./text";

export type FileInput = { name: string; mediaType: string; content: Buffer; occurredAt?: string | null };

export const PAGE_TEXT_MIN_CHARS = 20;
export const supportedExtensions = [".pdf", ".docx", ".pptx", ".txt", ".md", ".vtt", ".eml", ".csv", ".xlsx"] as const;


const base = (input: FileInput, patch: Partial<Normalized>): Normalized => ({
  title: input.name,
  kind: "file",
  occurredAt: input.occurredAt ?? null,
  status: "processed",
  segments: [],
  headers: [],
  attachments: [],
  pages: null,
  ocrPages: [],
  ...patch,
});

async function pdf(input: FileInput): Promise<Normalized> {
  const { text } = await extractText(new Uint8Array(input.content), { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const segments = pages.flatMap((pageText, i) => paragraphSegments(pageText, { page: i + 1, block: i + 1 }));
  const ocrPages = pages.flatMap((pageText, i) => (pageText.replace(/\s+/g, "").length < PAGE_TEXT_MIN_CHARS ? [i + 1] : []));
  return base(input, { segments, pages: pages.length, ocrPages, status: ocrPages.length > 0 ? "needs_ocr" : "processed" });
}

async function docx(input: FileInput): Promise<Normalized> {
  const { value } = await mammoth.convertToHtml({ buffer: input.content });
  const markdown = value
    .replace(/<h\d[^>]*>/g, "\n\n# ")
    .replace(/<\/(h\d|p|li|tr)>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/t[dh]>/g, " ")
    .replace(/<[^>]+>/g, "");
  return base(input, { segments: paragraphSegments(decodeXml(markdown), { headings: true }) });
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function pptx(input: FileInput): Promise<Normalized> {
  const zip = await JSZip.loadAsync(input.content);
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(path)?.[1] ?? NaN) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const segments: SegmentDraft[] = [];
  for (const slide of slides) {
    const xml = await zip.file(slide.path)!.async("string");
    const paragraphs = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => decodeXml([...m[1]!.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).trim()).filter(Boolean);
    let offset = 0;
    for (const paragraph of paragraphs) {
      segments.push({ text: paragraph, speaker: null, block: slide.n, locator: fileLocator(offset, offset + paragraph.length, slide.n) });
      offset += paragraph.length + 1;
    }
  }
  return base(input, { segments });
}

function vtt(input: FileInput): Normalized {
  return base(input, { kind: "teams_call", segments: speakerTurns(parseVtt(input.content.toString("utf8"))) });
}

export async function eml(input: FileInput): Promise<Normalized> {
  const mail = await simpleParser(input.content);
  const raw = mail.text ?? (mail.html ? htmlToText(mail.html, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }] }) : "");
  const text = stripQuotedReplies(raw);
  const messageId = mail.messageId ?? `${input.name}`;
  const from = mail.from?.value[0];
  const speaker = from?.name || from?.address || null;
  const attachments: Attachment[] = mail.attachments.filter((a) => a.filename).map((a) => ({ name: a.filename!, mediaType: a.contentType, content: a.content }));
  const segments: SegmentDraft[] = text ? [{ text, speaker, block: 0, locator: { kind: "email", messageId, charStart: 0, charEnd: text.length } }] : [];
  return base(input, { kind: "email", title: mail.subject ?? input.name, occurredAt: mail.date?.toISOString() ?? input.occurredAt ?? null, segments, attachments });
}

function tabular(input: FileInput, ext: string): Normalized {
  const sheets = ext === ".csv" ? [parseCsv(input.content.toString("utf8"))] : parseXlsx(input.content);
  const result = classifySheets(sheets);
  return base(input, { segments: result.segments, headers: result.headers, status: result.sensor ? "sensor_data" : "processed" });
}

export async function normalizeFile(input: FileInput): Promise<Normalized> {
  const ext = extname(input.name).toLowerCase();
  switch (ext) {
    case ".pdf":
      return pdf(input);
    case ".docx":
      return docx(input);
    case ".pptx":
      return pptx(input);
    case ".txt":
    case ".md":
      return base(input, { segments: paragraphSegments(input.content.toString("utf8"), { headings: ext === ".md" }) });
    case ".vtt":
      return vtt(input);
    case ".eml":
      return eml(input);
    case ".csv":
    case ".xlsx":
      return tabular(input, ext);
    case ".msg":
      throw new Error("Outlook .msg files are not supported in version 1. Save the email as .eml and upload it again.");
    default:
      throw new Error(`unsupported file type ${ext || "(none)"}. Supported: ${supportedExtensions.join(", ")}`);
  }
}
