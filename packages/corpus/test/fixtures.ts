import JSZip from "jszip";

export const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Matti Virtanen>Kuivaimen 3 höyryventtiili PM2_DR3_STM_VLV_POS jumittuu pesun jälkeen.</v>

00:00:04.500 --> 00:00:07.000
<v Matti Virtanen>Se näkyy datassa noin tunnin viiveellä.</v>

00:00:12.000 --> 00:00:15.000
<v Anna Data>Okay, so the valve position column lags the wash by one hour.</v>
`;

export const eml = `Message-ID: <abc123@example.com>
From: Matti Virtanen <matti@acme.example>
To: corpus+acme@norrin.example
Subject: Re: Tag list question
Date: Tue, 03 Mar 2026 10:15:00 +0200
Content-Type: text/plain; charset=utf-8

xmeas_7 is the reactor pressure in kPa gauge. We log it every 3 minutes.

Terveisin,
Matti

On Mon, 2 Mar 2026, Anna Data wrote:
> What is xmeas_7?
> And what is the unit?
`;

export const sensorCsv = ["time,xmeas_1,xmeas_2,xmv_1", ...Array.from({ length: 30 }, (_, i) => `2026-01-01T00:0${i % 10}:00Z,${i * 1.5},${i * 2.25},${i}`)].join("\n");

export const tagCsv = "tag;description;unit\nPM2_DR3_STM_VLV_POS;Dryer 3 steam valve position;%\nxmeas_7;Reactor pressure;kPa\n";

export const markdown = `# Data description

The file has one row every 3 minutes. The time column is UTC.

## Reactor

xmeas_7 is the reactor pressure. The unit is kPa gauge.

## Dryer

The dryer 3 steam valve position sticks after a wash.
`;

export async function pptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  slides.forEach((paragraphs, i) => {
    const body = paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function docx(blocks: { heading?: string; text: string }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paragraphs = blocks
    .map((b) => (b.heading ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${b.heading}</w:t></w:r></w:p>` : "") + `<w:p><w:r><w:t>${b.text}</w:t></w:r></w:p>`)
    .join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

export function pdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  for (const text of pages) {
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
