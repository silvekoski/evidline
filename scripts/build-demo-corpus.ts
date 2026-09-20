import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";

// A fictional customer corpus for the knowledge layer. The customer people write the way
// plant people write: tag numbers, equipment names, plain words, typos, small talk. The
// model column names (xmeas_7) appear only where they would in real life: the tag list
// that maps tags to the export, the export notes written for Norrin, and Norrin's own mails.

const out = process.argv[2] ?? join(import.meta.dirname, "..", "data", "demo-corpus");
mkdirSync(out, { recursive: true });
const write = (name: string, body: string | Buffer) => {
  writeFileSync(join(out, name), body);
  console.log(`wrote ${name}`);
};

// Teams writes a cue every few seconds and cuts sentences where the speaker breathes.
type Turn = [string, string | null, string];
const clock = (s: number): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}.${String(Math.round((s % 1) * 1000)).padStart(3, "0")}`;
};
function vtt(turns: Turn[]): string {
  const cues: string[] = [];
  for (const [start, who, text] of turns) {
    const [h, m, s] = start.split(":").map(Number) as [number, number, number];
    let t = h * 3600 + m * 60 + s;
    const words = text.split(" ");
    for (let i = 0; i < words.length; i += 9) {
      const piece = words.slice(i, i + 9).join(" ");
      const dur = 0.38 * Math.min(9, words.length - i) + 0.6;
      cues.push(`${clock(t)} --> ${clock(t + dur)}\n${who ? `<v ${who}>${piece}</v>` : piece}`);
      t += dur + 0.15;
    }
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

type Mail = { id: string; from: [string, string]; to: string; cc?: string; subject: string; date: string; body: string[]; html?: boolean; inReplyTo?: string };
const disclaimer = [
  "",
  "--",
  "Tämä viesti on tarkoitettu vain vastaanottajalle. This message is intended only for the addressee and may contain confidential information. If you are not the intended recipient, please delete it and notify the sender.",
  "Saimaa Kemia Oy | Tehtaantie 4, 55100 Vuoksenranta | Y-tunnus 0123456-7",
];
function eml(mail: Mail): string {
  const body = mail.html
    ? `<html><body><div style="font-family:Calibri,sans-serif;font-size:11pt">${mail.body.map((l) => (l === "" ? "<br>" : `<p style="margin:0">${l}</p>`)).join("")}</div></body></html>`
    : mail.body.join("\r\n");
  const headers = [
    `Message-ID: <${mail.id}@saimaakemia.example>`,
    mail.inReplyTo ? `In-Reply-To: <${mail.inReplyTo}@saimaakemia.example>` : "",
    `From: ${mail.from[0]} <${mail.from[1]}>`,
    `To: ${mail.to}`,
    mail.cc ? `Cc: ${mail.cc}` : "",
    `Subject: ${mail.subject}`,
    `Date: ${mail.date}`,
    "MIME-Version: 1.0",
    `Content-Type: ${mail.html ? "text/html" : "text/plain"}; charset=utf-8`,
    "X-Mailer: Microsoft Outlook 16.0",
  ].filter((line) => line !== "");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

// A text PDF with a company header, a footer, and a page number on each page.
function pdf(title: string, pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  const esc = (l: string) => l.replace(/[()\\]/g, "\\$&");
  pages.forEach((lines, i) => {
    const header = `BT /F1 8 Tf 60 812 Td (${esc(`Saimaa Kemia Oy    ${title}`)}) Tj ET`;
    const footer = `BT /F1 8 Tf 60 30 Td (${esc(`Printed 2026-02-11 from the document system. Uncontrolled when printed.    Page ${i + 1} of ${pages.length}`)}) Tj ET`;
    const stream = `${header} ${footer} BT /F1 10.5 Tf 14 TL 60 770 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  });
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return assemble(objects, catalog);
}

// A scanned PDF: each page is one JPEG drawn from text, a little skewed, a little dirty.
function scannedPdf(pages: string[][]): Buffer {
  const objects: (string | Buffer)[] = [];
  const add = (body: string | Buffer) => objects.push(body) && objects.length;
  const pageIds: number[] = [];
  const pagesId = pages.length * 3 + 1;
  pages.forEach((lines, i) => {
    const w = 1240;
    const h = 1754;
    const canvas = createCanvas(w, h);
    const g = canvas.getContext("2d");
    g.fillStyle = "#f4f1ea";
    g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((i % 2 === 0 ? 0.6 : -0.4) * (Math.PI / 180));
    g.translate(-w / 2, -h / 2);
    g.fillStyle = "#1a1a1a";
    g.font = "26px monospace";
    lines.forEach((line, n) => g.fillText(line, 110, 150 + n * 40));
    g.font = "20px monospace";
    g.fillText(`Sivu ${i + 1}/${pages.length}`, 1060, 1690);
    g.restore();
    let seed = 7 + i;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    g.fillStyle = "rgba(40,40,40,0.35)";
    for (let n = 0; n < 400; n++) g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 0, 18, h);
    const jpeg = canvas.toBuffer("image/jpeg", 62);
    const image = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, "latin1"), jpeg, Buffer.from("\nendstream", "latin1")]));
    const stream = `q 595 0 0 842 0 0 cm /Im${i} Do Q`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /XObject << /Im${i} ${image} 0 R >> >> >>`));
  });
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return assemble(objects, catalog);
}

function assemble(objects: (string | Buffer)[], catalog: number): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((o, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), typeof o === "string" ? Buffer.from(o, "latin1") : o, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

// A slide deck: one paragraph per line, the first line of each slide is its title.
async function pptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  slides.forEach((paragraphs, i) => {
    const body = paragraphs.map((p) => `<a:p><a:r><a:t>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

// A Word document: a heading starts a new block, the rest of the block is body text.
async function docx(blocks: { heading?: string; text: string }[]): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paragraphs = blocks
    .map((b) => (b.heading ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(b.heading)}</w:t></w:r></w:p>` : "") + `<w:p><w:r><w:t>${esc(b.text)}</w:t></w:r></w:p>`)
    .join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

// Calls. Teams transcripts: greetings, a late joiner, fillers, a phone that rings, the
// occasional word the recognizer got wrong.

write(
  "2026-02-12 Kickoff Saimaa Kemia data handover.vtt",
  vtt([
    ["00:00:01", "Anna Lehtinen", "Okay I think we are recording now. Can everyone see the slide? Ville you are on mute."],
    ["00:00:09", "Ville Korhonen", "Sorry. Yes, hi everyone. Thanks for taking the time. Anna will drive, I am mostly here to listen."],
    ["00:00:17", "Anna Lehtinen", "Great. So Jarkko, maybe you could start with what is actually in the export you sent on Monday. We opened it and there are fifty something columns with names like ex meas one and ex em vee one."],
    ["00:00:34", "Jarkko Rantanen", "Yeah, sorry about that. So it is a historian export from the reactor line, R one oh one, plus the separator and the stripper section. Every row is a three minute sample. Um, the column names, that is the export tool. It renames our tags to the model numbering from the old simulator project. The mapping is in the tag list, I will send that as a CSV today or tomorrow."],
    ["00:01:05", "Anna Lehtinen", "Perfect, that is exactly what we need. And the time column?"],
    ["00:01:09", "Jarkko Rantanen", "Local time, Helsinki. And, this is a good one, the export ran over the DST change weekend so there is one repeated hour at the end of October. Do not be surprised."],
    ["00:01:22", "Anna Lehtinen", "Noted. Is the pressure in bar or kilopascal, because we saw values around two thousand seven hundred."],
    ["00:01:30", "Jarkko Rantanen", "Kilopascal gauge. The operators talk in bar but the historian stores kPa gauge. So two thousand seven hundred is about twenty seven bar, normal operating point for the reactor pressure, that is P I ten eleven."],
    ["00:01:50", null, "[Mikko Virtanen joined the meeting]"],
    ["00:01:53", "Mikko Virtanen", "Hi, sorry, the previous one ran over. Where are we?"],
    ["00:01:57", "Anna Lehtinen", "Hi Mikko. Units and time base. We were about to go to the reactor temperature, you had a comment on that in the email."],
    ["00:02:05", "Mikko Virtanen", "Right, yes. The thermocouple on the reactor, T I ten thirteen, was replaced on the fourteenth of January. Before that it read about two degrees low for maybe three weeks. So if you see a step up in the reactor temperature in January, that is the instrument, not the process. I do not want your model to learn that."],
    ["00:02:33", "Anna Lehtinen", "That is exactly the kind of thing we are looking for. Anything else like that?"],
    ["00:02:38", "Mikko Virtanen", "The purge valve. P V twenty forty one. It sticks after every wash of the purge line, the position goes flat for an hour or so and you see the compressor power climb, J I twenty twenty. Maintenance knows, there is a positioner on order since, I do not know, November?"],
    ["00:03:02", "Anna Lehtinen", "How often are the washes?"],
    ["00:03:05", "Mikko Virtanen", "Roughly weekly. Tuesday morning shift usually. It is in the maintenance log, Jarkko can send that too."],
    ["00:03:12", "Jarkko Rantanen", "Sure. One more thing on the columns. The composition ones, the last twenty or so columns, come from the gas chromatographs. The feed analyzer has a six minute cycle and the purge and product analyzers fifteen minutes. So those repeat the same value between analyzer updates. Please do not treat the repeats as stuck sensors, we had that discussion with the previous vendor."],
    ["00:03:40", "Ville Korhonen", "Good to know, we will keep that in mind. Anna, the missing values question?"],
    ["00:03:45", "Anna Lehtinen", "Yes. What does a missing value look like in the export?"],
    ["00:03:49", "Jarkko Rantanen", "Empty cell. Bad quality on the tag comes out as an empty cell. And there was a historian outage on the second of December, about five hours, everything is empty there."],
    ["00:04:02", "Anna Lehtinen", "Okay. Last one for today, who do we ask when you are on holiday? You mentioned you are off in week nine."],
    ["00:04:10", "Jarkko Rantanen", "Mikko for anything on the reactor and the valves, and Sari Nieminen for the lab and the analyzers. I will add her to the mails."],
    ["00:04:19", "Anna Lehtinen", "Thanks, that is all from us. I will send the notes. Same time next week?"],
    ["00:04:24", "Jarkko Rantanen", "Works for me. Moi moi."],
    ["00:04:26", "Mikko Virtanen", "Bye."],
  ]),
);

write(
  "2026-03-05 Weekly Saimaa Kemia review.vtt",
  vtt([
    ["00:00:02", "Anna Lehtinen", "Hi all. Short one today I hope. First the slow drift we flagged last week, the reactor cooling water outlet, T I ten twenty one. It climbs slowly from mid February. Mikko, is that real?"],
    ["00:00:18", "Mikko Virtanen", "Yes, that is fouling on the cooling coil. Totally normal. We clean it every spring, last cleaning was April last year. The outlet temperature goes up something like half a degree per week until the cleaning."],
    ["00:00:37", "Anna Lehtinen", "So the drift is real and expected. Is there anything that compensates for it?"],
    ["00:00:43", "Mikko Virtanen", "The temperature controller opens the cooling water valve, F V ten ten, a bit more every week. When it gets to about ninety percent we book the cleaning. We are at, hmm, seventy something now."],
    ["00:01:00", null, "[phone ringing]"],
    ["00:01:03", "Sari Nieminen", "Sorry, that was mine. On the lab side, the purge analyzer gets calibrated every Monday at eight. Takes about twenty minutes, and during that time the values just hold the last reading. So Monday morning flat lines on the purge composition are us, not a fault."],
    ["00:01:25", "Anna Lehtinen", "Monday eight o'clock hold on the purge analyzer. And the product analyzer?"],
    ["00:01:31", "Sari Nieminen", "Same, but Thursdays. And the D component in the product, that is the one quality number the customer actually looks at. Spec is below zero point six mole percent."],
    ["00:01:47", "Jarkko Rantanen", "One correction from last time, sorry. I said the purge valve is ex em vee six in the export. That is right, but our tag is P V twenty forty one. Same valve, so if you see either name, it is the same thing."],
    ["00:02:03", "Anna Lehtinen", "Thanks, we will map those. Ville, anything?"],
    ["00:02:07", "Ville Korhonen", "Only the invoice question, but that is for Riitta, not this call. I will mail her."],
    ["00:02:13", "Anna Lehtinen", "Okay. Then thanks everyone, talk next week."],
  ]),
);

write(
  "2026-03-26 Saimaa Kemia drift review.vtt",
  vtt([
    ["00:00:02", "Anna Lehtinen", "Two things today. The compressor power and the reactor cooling. Mikko, did you see the compressor plot I sent?"],
    ["00:00:11", "Mikko Virtanen", "I did. So every Tuesday there is that bump in the compressor power, that is the purge valve sticking after the wash. But since the third of March the bump is gone. We changed the stem lubrication and it has not stuck since. Knock on wood."],
    ["00:00:32", "Anna Lehtinen", "So after the third of March a stuck purge valve is not expected any more."],
    ["00:00:37", "Mikko Virtanen", "Correct. If it sticks again that is news to us, please tell us."],
    ["00:00:43", "Jarkko Rantanen", "On the cooling side, F V ten ten is at eighty six percent today. Cleaning is booked for the twentieth of April. After the cleaning it drops to around forty percent and the outlet temperature drops maybe eight degrees, so you will see a big step there. That is planned."],
    ["00:01:05", "Anna Lehtinen", "Good, step on the twentieth of April is planned maintenance. One more, is the fifth flow column, ex meas five, the recycle flow?"],
    ["00:01:14", "Jarkko Rantanen", "Yes, F I ten oh five, recycle flow from the compressor back to the reactor feed, in kscmh. It moves with the recycle valve and with the compressor power."],
    ["00:01:30", "Sari Nieminen", "And a lab note. The reactor feed chromatograph gets a new column on the sixth of April. Expect a level shift of maybe half a mole percent on the feed composition after that. Not a process change."],
    ["00:01:46", "Anna Lehtinen", "Sixth of April, feed analyzer, half a mole percent. Got it. Thanks all."],
    ["00:01:51", "Sari Nieminen", "Kiitos, moikka."],
  ]),
);

// Mailbox. The shared mailbox gets the useful threads and everything else.

const jarkko: [string, string] = ["Jarkko Rantanen", "jarkko.rantanen@saimaakemia.example"];
const mikko: [string, string] = ["Mikko Virtanen", "mikko.virtanen@saimaakemia.example"];
const sari: [string, string] = ["Sari Nieminen", "sari.nieminen@saimaakemia.example"];
const timo: [string, string] = ["Timo Heikkinen", "timo.heikkinen@saimaakemia.example"];
const riitta: [string, string] = ["Riitta Hakala", "riitta.hakala@saimaakemia.example"];
const anna: [string, string] = ["Anna Lehtinen", "anna.lehtinen@norrin.example"];
const corpus = "corpus+norrin@norrin.example";

write(
  "2026-02-13 Tag list and units.eml",
  eml({
    id: "9f2a1c-01",
    from: anna,
    to: `Jarkko Rantanen <${jarkko[1]}>`,
    cc: corpus,
    subject: "Tag list and units",
    date: "Fri, 13 Feb 2026 16:05:10 +0200",
    body: ["Hi Jarkko,", "", "Thanks for the call yesterday. Could you send the tag list when you have a minute, and confirm the pressure unit? We also want to double check xmeas_8: is the reactor level in percent or in liters?", "", "Have a good weekend,", "Anna", "", "Anna Lehtinen | Data engineer | Norrin Oy | +358 40 123 4567"],
  }),
);

write(
  "2026-02-16 RE Tag list and units.eml",
  eml({
    id: "9f2a1c-02",
    from: jarkko,
    to: `Anna Lehtinen <${anna[1]}>`,
    cc: corpus,
    subject: "RE: Tag list and units",
    date: "Mon, 16 Feb 2026 09:42:11 +0200",
    inReplyTo: "9f2a1c-01",
    html: true,
    body: [
      "Hi Anna,",
      "",
      "Tag list attached as CSV (tag-list-vuoksenranta.csv). The model_name column is what the export tool writes as the header. A few notes that are not in the file:",
      "",
      "- PI-1011, reactor pressure, is kPa gauge. Alarm high is 2895 kPa and the trip is 3000 kPa.",
      "- LI-1012, reactor level, is percent of the sight glass range, not liters. So your xmeas_8 question: percent.",
      "- LI-3012, the stripper level, oscillates with a period of about 40 minutes whenever the stripper steam valve FV-3009 is in manual. That is normal for us, the operators put it in manual for the steam trap test.",
      "- FV-1004, the A and C feed valve, was in manual at 61 % from 3 to 9 January because of a positioner fault.",
      "- The time column is Europe/Helsinki local time. I can re-export in UTC if that is easier for you.",
      "",
      "Terveisin,",
      "Jarkko",
      "",
      "Jarkko Rantanen | Automaatioinsinööri / Automation engineer | Saimaa Kemia Oy, Vuoksenrannan tehdas | +358 50 987 6543",
      ...disclaimer,
      "",
      "-----Alkuperäinen viesti-----",
      "Lähettäjä: Anna Lehtinen <anna.lehtinen@norrin.example>",
      "Lähetetty: perjantai 13. helmikuuta 2026 16.05",
      "Vastaanottaja: Jarkko Rantanen",
      "Aihe: Tag list and units",
      "",
      "> Hi Jarkko,",
      "> Thanks for the call yesterday. Could you send the tag list when you have a minute, and confirm the pressure unit?",
    ],
  }),
);

write(
  "2026-02-16 Automatic reply Tag list and units.eml",
  eml({
    id: "9f2a1c-03",
    from: sari,
    to: `Anna Lehtinen <${anna[1]}>`,
    cc: corpus,
    subject: "Automaattinen vastaus: Tag list and units",
    date: "Mon, 16 Feb 2026 09:42:30 +0200",
    inReplyTo: "9f2a1c-01",
    body: ["Olen lomalla 16.2. - 20.2.2026 enkä lue sähköpostia. Kiireellisissä laboratorioasioissa ota yhteyttä vuorolaborantti, puh. 05 123 4500.", "", "I am out of office 16 to 20 February 2026 and do not read email. For urgent laboratory matters, call the shift laboratory, +358 5 123 4500.", "", "Sari Nieminen"],
  }),
);

write(
  "2026-02-19 UTC export and separator pressure unit.eml",
  eml({
    id: "a11ce0-01",
    from: timo,
    to: corpus,
    subject: "UTC export and separator pressure unit",
    date: "Thu, 19 Feb 2026 15:48:02 +0200",
    body: ["Hi,", "", "Answers to your two questions from the Teams chat.", "", "PI-2013, the separator pressure, is in bar.", "", "The export is in local time, I do not think we can change that. Jarkko may know more, he is back tomorrow.", "", "Timo Heikkinen", "Tuotannonsuunnittelija | Production planner", "Saimaa Kemia Oy", ...disclaimer],
  }),
);

write(
  "2026-02-20 RE UTC export and separator pressure unit.eml",
  eml({
    id: "a11ce0-02",
    from: jarkko,
    to: corpus,
    cc: `Timo Heikkinen <${timo[1]}>`,
    subject: "RE: UTC export and separator pressure unit",
    date: "Fri, 20 Feb 2026 11:20:44 +0200",
    inReplyTo: "a11ce0-01",
    body: [
      "Hi Anna,",
      "",
      "Correction to what Timo wrote below: PI-2013, the separator pressure, is in kPa gauge like every other pressure in the export. It is not in bar. The value around 2700 should make that clear. Sorry for the confusion.",
      "",
      "About the time base: I re-exported the same period in UTC. The file name ends with _utc. The rows are identical, only the time column changed. Use whichever you prefer, but do not mix the two files.",
      "",
      "The repeated hour on 2025-10-26 exists only in the local time file.",
      "",
      "Terveisin,",
      "Jarkko",
      "",
      "On Thu, 19 Feb 2026, Timo Heikkinen wrote:",
      "> PI-2013, the separator pressure, is in bar.",
      "> The export is in local time, I do not think we can change that.",
    ],
  }),
);

write(
  "2026-02-20 RE RE UTC export and separator pressure unit.eml",
  eml({
    id: "a11ce0-03",
    from: anna,
    to: `Jarkko Rantanen <${jarkko[1]}>`,
    cc: corpus,
    subject: "RE: RE: UTC export and separator pressure unit",
    date: "Fri, 20 Feb 2026 11:34:01 +0200",
    inReplyTo: "a11ce0-02",
    body: ["Thanks Jarkko, got it. We use the local time file.", "", "Anna", "", "Sent from Outlook for iOS"],
  }),
);

write(
  "2026-01-22 RE P-302 trip yesterday.eml",
  eml({
    id: "d00d1e-03",
    from: mikko,
    to: `Jarkko Rantanen <${jarkko[1]}>`,
    cc: corpus,
    subject: "RE: P-302 trip yesterday",
    date: "Thu, 22 Jan 2026 07:55:12 +0200",
    inReplyTo: "d00d1e-02",
    body: [
      "Morning,",
      "",
      "Yes, the trip at 10:14 yesterday was P-302 on high bearing temperature. Pump was down 40 min. In the trends you see the stripper underflow FI-3017 go to zero, the stripper level LI-3012 climb to 82 %, and the steam valve FV-3009 closed by the operator to 20 %.",
      "",
      "Not the strainer this time, the bearing was just hot after the seal work in December. Greased it, fine since.",
      "",
      "Mikko",
      "",
      "Lähetetty iPhonesta",
      "",
      "> Was that P-302 again yesterday around ten? The stripper level chart looks like the January event.",
      "> Jarkko",
    ],
  }),
);

write(
  "2026-02-03 Historian question missing values.eml",
  eml({
    id: "beef01-01",
    from: anna,
    to: `Jarkko Rantanen <${jarkko[1]}>`,
    cc: corpus,
    subject: "Historian question: missing values in xmeas_10",
    date: "Tue, 03 Feb 2026 10:12:00 +0200",
    body: ["Hi Jarkko,", "", "We see about 2 percent empty cells in xmeas_10, which the tag list says is FI-2001, the purge rate. The gaps are spread over the whole period, and there are almost none in the other flows. Is that a known thing?", "", "Anna"],
  }),
);

write(
  "2026-02-03 RE Historian question missing values.eml",
  eml({
    id: "beef01-02",
    from: jarkko,
    to: `Anna Lehtinen <${anna[1]}>`,
    cc: corpus,
    subject: "RE: Historian question: missing values in xmeas_10",
    date: "Tue, 03 Feb 2026 13:40:27 +0200",
    inReplyTo: "beef01-01",
    body: [
      "Hi Anna,",
      "",
      "Yes, known. FI-2001 is a thermal mass flow meter on the purge line and it drops out for a few seconds whenever the purge valve moves fast. The DCS marks those samples bad quality and the export leaves the cell empty. Nothing wrong with the process.",
      "",
      "The same meter has a small zero offset, 0.02 kscmh at no flow, from the loop check. We left it, it does not affect control.",
      "",
      "Jarkko",
      "",
      "> We see about 2 percent empty cells in xmeas_10, which the tag list says is FI-2001, the purge rate.",
    ],
  }),
);

write(
  "2026-03-10 RE Question about xmeas_16 and xmeas_18.eml",
  eml({
    id: "7b31de-02",
    from: mikko,
    to: corpus,
    subject: "RE: Question about xmeas_16 and xmeas_18",
    date: "Tue, 10 Mar 2026 14:17:03 +0200",
    inReplyTo: "7b31de-01",
    body: [
      "Hello,",
      "",
      "The two you ask about are the stripper pressure PI-3011 (kPa gauge) and the stripper temperature TI-3013 (deg C). They move together because the stripper runs close to saturation, that is physics, not a sensor problem.",
      "",
      "The one between them, FI-3017, is the stripper underflow in m3/h. When the bottoms pump P-302 trips, FI-3017 drops to zero within one sample and the stripper level rises fast. That happened on 21 January and on 27 February.",
      "",
      "And the steam valve Jarkko mentioned is FV-3009.",
      "",
      "Regards,",
      "Mikko",
      "",
      "Lähetetty iPhonesta",
      "",
      "> Hi, quick one: the columns xmeas_16 and xmeas_18 track each other almost exactly. Is that expected? And what is xmeas_17 in between? Anna",
    ],
  }),
);

write(
  "2026-03-18 Compressor recycle valve.eml",
  eml({
    id: "c0ffee-01",
    from: sari,
    to: corpus,
    subject: "Compressor recycle valve",
    date: "Wed, 18 Mar 2026 08:03:50 +0200",
    body: [
      "Hi,",
      "",
      "Mikko is in a course this week so I answer for him. You asked about the valve position that never goes to zero. That is FV-2005, the compressor recycle valve. Operators keep it between 15 and 30 percent. Above 40 percent the compressor is close to surge and the compressor power JI-2020 gets noisy.",
      "",
      "One more thing while I remember: TI-2022, the separator cooling water outlet temperature, shifted down about 4 degrees on 1 March. We changed the cooling water source from the river to the closed loop that day. Not a fault.",
      "",
      "Best regards,",
      "Sari Nieminen",
      "Laboratorio ja analysaattorit | Laboratory and analyzers",
      "Saimaa Kemia Oy",
      ...disclaimer,
    ],
  }),
);

write(
  "2026-03-02 Steering group meeting 12.3.eml",
  eml({
    id: "meet01-01",
    from: riitta,
    to: `Ville Korhonen <ville.korhonen@norrin.example>, Anna Lehtinen <${anna[1]}>, Jarkko Rantanen <${jarkko[1]}>`,
    cc: corpus,
    subject: "Steering group meeting 12.3. klo 13-14",
    date: "Mon, 02 Mar 2026 08:20:33 +0200",
    html: true,
    body: [
      "Hei kaikki,",
      "",
      "Steering group on Thursday 12.3. at 13:00, Teams. Agenda:",
      "1. Project status (Ville)",
      "2. Data quality findings so far (Anna)",
      "3. Budget and invoicing Q1 (Riitta)",
      "4. Next steps and the summer shutdown schedule",
      "",
      "Please send slides by Wednesday noon. Parking: use the visitor spots by gate 2, gate 1 is closed for the road works until April.",
      "",
      "Terveisin",
      "Riitta Hakala",
      "Tehtaanjohtaja | Plant manager",
      "Saimaa Kemia Oy",
      ...disclaimer,
    ],
  }),
);

write(
  "2026-03-12 RE Steering group meeting 12.3.eml",
  eml({
    id: "meet01-02",
    from: jarkko,
    to: `Riitta Hakala <${riitta[1]}>`,
    cc: corpus,
    subject: "RE: Steering group meeting 12.3. klo 13-14",
    date: "Thu, 12 Mar 2026 12:41:09 +0200",
    inReplyTo: "meet01-01",
    body: ["Running 10 min late, start without me.", "", "J"],
  }),
);

write(
  "2026-03-20 Kesälomat 2026 automaatio.eml",
  eml({
    id: "loma01-01",
    from: jarkko,
    to: `Riitta Hakala <${riitta[1]}>`,
    cc: corpus,
    subject: "Kesälomat 2026 automaatio",
    date: "Fri, 20 Mar 2026 15:02:44 +0200",
    body: ["Hei Riitta,", "", "Automaation lomatoiveet:", "Rantanen 29.6. - 26.7.", "Koskinen 6.7. - 2.8.", "Salo 27.7. - 16.8.", "", "Kesäseisokki on viikolla 30, joten Koskinen jää sitä varten. Norrinin projektin osalta Anna tietää että olen heinäkuun poissa.", "", "Jarkko"],
  }),
);

// Documents from the plant. Tags and equipment names, the way the plant writes them.

write(
  "tag-list-vuoksenranta.csv",
  [
    "tag;model_name;description;unit;low;high;comment",
    "FI-1001;xmeas_1;A feed flow to reactor;kscmh;0;1;",
    "FI-1002;xmeas_2;D feed flow to reactor;kg/h;3000;4500;",
    "FI-1003;xmeas_3;E feed flow to reactor;kg/h;3500;5000;",
    "FI-1004;xmeas_4;A+C feed flow;kscmh;8;10;",
    "FI-1005;xmeas_5;Recycle flow to reactor;kscmh;25;30;from K-201",
    "FI-1006;xmeas_6;Reactor feed rate;kscmh;40;45;",
    "PI-1011;xmeas_7;Reactor R-101 pressure;kPa g;2600;2850;PIC-1011 PV",
    "LI-1012;xmeas_8;Reactor R-101 level;%;60;80;sight glass range",
    "TI-1013;xmeas_9;Reactor R-101 temperature;degC;118;124;TC replaced 14.1.2026",
    "FI-2001;xmeas_10;Purge rate;kscmh;0.2;0.5;thermal mass, drops out",
    "TI-2011;xmeas_11;Separator V-201 temperature;degC;75;85;",
    "LI-2012;xmeas_12;Separator V-201 level;%;40;60;",
    "PI-2013;xmeas_13;Separator V-201 pressure;kPa g;2600;2750;",
    "FI-2014;xmeas_14;Separator underflow;m3/h;20;30;",
    "LI-3012;xmeas_15;Stripper T-301 level;%;40;60;noisy, damping 2 s",
    "PI-3011;xmeas_16;Stripper T-301 pressure;kPa g;3050;3150;",
    "FI-3017;xmeas_17;Stripper underflow;m3/h;20;25;P-302 discharge",
    "TI-3013;xmeas_18;Stripper T-301 temperature;degC;60;70;",
    "FI-3019;xmeas_19;Stripper steam flow;kg/h;200;260;",
    "JI-2020;xmeas_20;Compressor K-201 work;kW;330;350;calculated",
    "TI-1021;xmeas_21;Reactor cooling water outlet temp;degC;92;100;",
    "TI-2022;xmeas_22;Separator cooling water outlet temp;degC;72;80;",
    "AI-1023;xmeas_23;Reactor feed comp A;mol%;30;35;GC 6 min",
    "AI-1023;xmeas_24;Reactor feed comp B;mol%;;;GC 6 min",
    "AI-1023;xmeas_25;Reactor feed comp C;mol%;;;GC 6 min",
    "AI-1023;xmeas_26;Reactor feed comp D;mol%;;;GC 6 min",
    "AI-1023;xmeas_27;Reactor feed comp E;mol%;;;GC 6 min",
    "AI-1023;xmeas_28;Reactor feed comp F;mol%;;;GC 6 min",
    "AI-2029;xmeas_29;Purge gas comp A;mol%;30;35;GC 15 min",
    "AI-2029;xmeas_30;Purge gas comp B;mol%;;;GC 15 min",
    "AI-2029;xmeas_31;Purge gas comp C;mol%;;;GC 15 min",
    "AI-2029;xmeas_32;Purge gas comp D;mol%;;;GC 15 min",
    "AI-2029;xmeas_33;Purge gas comp E;mol%;;;GC 15 min",
    "AI-2029;xmeas_34;Purge gas comp F;mol%;;;GC 15 min",
    "AI-2029;xmeas_35;Purge gas comp G;mol%;;;GC 15 min",
    "AI-2029;xmeas_36;Purge gas comp H;mol%;;;GC 15 min",
    "AI-4037;xmeas_37;Product comp D;mol%;0;0.6;GC 15 min, spec",
    "AI-4037;xmeas_38;Product comp E;mol%;;;GC 15 min",
    "AI-4037;xmeas_39;Product comp F;mol%;;;GC 15 min",
    "AI-4037;xmeas_40;Product comp G;mol%;;;GC 15 min",
    "AI-4037;xmeas_41;Product comp H;mol%;;;GC 15 min",
    "FV-1001;xmv_1;D feed valve;%;50;70;LIC-1012 output",
    "FV-1002;xmv_2;E feed valve;%;45;60;",
    "FV-1003;xmv_3;A feed valve;%;20;30;",
    "FV-1004;xmv_4;A+C feed valve;%;55;65;",
    "FV-2005;xmv_5;Compressor recycle valve;%;15;30;anti-surge",
    "PV-2041;xmv_6;Purge valve;%;35;50;PIC-1011 output, sticks after wash",
    "FV-2007;xmv_7;Separator pot liquid flow valve;%;35;45;",
    "FV-3008;xmv_8;Stripper liquid product flow valve;%;40;50;",
    "FV-3009;xmv_9;Stripper steam valve;%;40;55;",
    "FV-1010;xmv_10;Reactor cooling water flow valve;%;35;95;",
    "FV-2011;xmv_11;Condenser cooling water flow valve;%;15;25;",
    "PV-2041;xmv_6;Purge valve;%;35;50;duplicate row from old list, ignore",
  ].join("\n") + "\n",
);

write(
  "maintenance-log-2026-Q1.csv",
  [
    "date,work_order,equipment,description,technician,hours",
    "2026-01-03,WO-26011,FV-1004,Positioner fault. Valve to manual 61% until spare positioner arrives.,T. Koskinen,1.5",
    "2026-01-07,WO-26013,K-201,Oil sample taken. Result ok.,P. Salo,0.5",
    "2026-01-09,WO-26011,FV-1004,Positioner replaced. Valve back to auto.,T. Koskinen,3",
    "2026-01-13,WO-26019,PV-2041,Purge line wash. Valve stuck 38% for 70 min after wash. Tapped positioner.,P. Salo,2",
    "2026-01-14,WO-26020,TI-1013,Thermocouple replaced. Old element read approx 2 degC low.,T. Koskinen,2",
    "2026-01-15,WO-26021,LIGHTING,Replaced 4 lamps stripper platform level 3.,P. Salo,1",
    "2026-01-20,WO-26024,PV-2041,Purge line wash. Stuck 55 min after wash.,P. Salo,2",
    "2026-01-21,WO-26026,P-302,Trip on high bearing temp. Greased. Restarted after 40 min.,P. Salo,1.5",
    "2026-01-27,WO-26030,PV-2041,Purge line wash. Stuck 65 min.,P. Salo,2",
    "2026-02-03,WO-26035,PV-2041,Purge line wash. Stem lubricated before wash. No sticking.,P. Salo,2.5",
    "2026-02-05,WO-26037,E-202,Condenser tube side inspection hatch bolts retorqued.,T. Koskinen,2",
    "2026-02-10,WO-26041,PV-2041,Purge line wash. Stuck 80 min. Lubrication did not hold.,P. Salo,2",
    "2026-02-27,WO-26055,P-302,Trip. Seal flush strainer blocked with scale. Cleaned and restarted.,T. Koskinen,3",
    "2026-03-01,WO-26058,E-202,Separator cooling water switched from river intake to closed loop. 4 h at reduced rate.,J. Rantanen,6",
    "2026-03-03,WO-26060,PV-2041,New lubrication procedure (weekly). No sticking after wash.,P. Salo,1",
    "2026-03-09,WO-26063,AI-2029,Purge GC column replaced during Monday calibration. Cal took 45 min.,S. Nieminen,1.5",
    "2026-03-16,WO-26068,GATE-1,Road works fence moved for the contractor.,P. Salo,0.5",
  ].join("\n") + "\n",
);

write(
  "historian-export-notes.md",
  [
    "# Historian export notes, Vuoksenranta reactor line",
    "",
    "Prepared by Jarkko Rantanen for the Norrin project, 2026-02-11. Draft, not a controlled document.",
    "",
    "## Sampling and time",
    "",
    "One row every 3 minutes. The `time` column is local time (Europe/Helsinki). The historian samples each tag on change and the export tool interpolates to the 3 minute grid with the last value.",
    "",
    "Historian down 2025-12-02 09:10 to 14:25 local. Every column empty in that window.",
    "",
    "## Column names",
    "",
    "The export tool writes the model names from the 2019 simulator study as headers: xmeas_1 to xmeas_41 for measurements and xmv_1 to xmv_11 for valve positions. The plant tags are in tag-list-vuoksenranta.csv, column model_name. Nobody at the plant uses the model names, so when you talk to operators, use the tag.",
    "",
    "## Quality",
    "",
    "A tag with bad quality comes out as an empty cell. A value frozen for more than 30 minutes on a flow or pressure tag is a field bus segment fault, not a process condition. Analyzer tags are the exception, see below.",
    "",
    "## Analyzers",
    "",
    "xmeas_23 to xmeas_28 come from the reactor feed GC (AI-1023, 6 minute cycle). xmeas_29 to xmeas_36 from the purge GC (AI-2029) and xmeas_37 to xmeas_41 from the product GC (AI-4037), both 15 minute cycle. Between two results the value repeats.",
    "",
    "Purge GC calibrates Mondays 08:00, product GC Thursdays 08:00. Values hold about 20 minutes.",
    "",
    "## Known events in the export period",
    "",
    "- 2026-01-03 to 01-09: FV-1004 (xmv_4) in manual at 61 % (positioner).",
    "- 2026-01-14: TI-1013 (xmeas_9) thermocouple replaced, about 2 degC step up.",
    "- 2026-01-21 and 02-27: P-302 trips. FI-3017 (xmeas_17) to zero, LI-3012 (xmeas_15) up.",
    "- Weekly, Tuesday morning: purge line wash. PV-2041 (xmv_6) tends to stick about an hour after.",
    "- 2026-03-01: separator cooling water source changed. TI-2022 (xmeas_22) down about 4 degC.",
    "",
    "## Units",
    "",
    "Pressures kPa gauge. Temperatures degC. Levels % of instrument range. Flows as in the tag list. Valve positions % open.",
    "",
  ].join("\n"),
);

write(
  "sensor-sample-week-07.csv",
  ["time,xmeas_7,xmeas_9,xmv_6,xmeas_20", ...Array.from({ length: 480 }, (_, i) => `2026-02-10T${String(Math.floor(i / 20)).padStart(2, "0")}:${String((i % 20) * 3).padStart(2, "0")}:00+02:00,${(2705 + 12 * Math.sin(i / 9)).toFixed(1)},${(120.4 + 0.6 * Math.cos(i / 15)).toFixed(2)},${i > 60 && i < 84 ? "38.0" : (42 + 3 * Math.sin(i / 7)).toFixed(1)},${(338 + (i > 60 && i < 84 ? 9 : 0) + 2 * Math.sin(i / 5)).toFixed(1)}`)].join("\n") + "\n",
);

write(
  "Process description R-101 rev C.pdf",
  pdf("VRK-PD-101 rev C", [
    [
      "PROCESS DESCRIPTION",
      "Reactor line R-101, Vuoksenranta plant",
      "Document VRK-PD-101, revision C",
      "",
      "Revision history",
      "A  2017-03-10  First issue                          M. Laine",
      "B  2019-06-14  Simulator study tags added          M. Laine",
      "C  2024-05-20  Operating window and alarms updated  H. Aaltonen",
      "",
      "Approved: R. Hakala, plant manager, 2024-05-24",
      "",
      "",
      "1. Scope",
      "This document describes the reactor line R-101 with its separator, compressor and",
      "stripper section for operators, engineers and contractors. It replaces revision B.",
    ],
    [
      "2. Reactor",
      "Gaseous reactants A, C, D and E enter reactor R-101 and form the liquid products G and H.",
      "The reactor is a stirred vessel with an internal cooling coil. Reactor pressure PI-1011 is",
      "controlled by the purge valve PV-2041. Reactor level LI-1012 is controlled by the D feed",
      "valve FV-1001. Reactor temperature TI-1013 is controlled by the cooling water valve FV-1010.",
      "",
      "Normal operating window: pressure 2600 to 2850 kPa gauge, level 60 to 80 percent,",
      "temperature 118 to 124 degrees C. The high pressure alarm is at 2895 kPa and the safety",
      "interlock closes the feed valves at 3000 kPa.",
      "",
      "3. Separator and compressor",
      "The reactor product cools in condenser E-202 and separates in vessel V-201. The vapor goes",
      "back to the reactor through compressor K-201. The recycle valve FV-2005 protects the",
      "compressor from surge. Compressor power JI-2020 is a good early indicator of a sticking",
      "purge valve: when PV-2041 sticks closed, the recycle load and the compressor power rise.",
    ],
    [
      "4. Stripper",
      "The liquid from V-201 goes to stripper T-301. Steam through FV-3009 strips the light",
      "components, which return to the reactor feed. The bottoms pump P-302 sends the product",
      "to storage. Stripper level LI-3012 is the most sensitive level in the unit and oscillates",
      "when the steam valve is in manual.",
      "",
      "5. Analyzers",
      "Three gas chromatographs measure the reactor feed (AI-1023, 6 minute cycle), the purge",
      "(AI-2029, 15 minute cycle) and the product (AI-4037, 15 minute cycle). The product",
      "specification is component D below 0.6 mol percent.",
      "",
      "6. Utilities",
      "Cooling water comes from the river intake (summer) or the closed loop (winter, from 2026",
      "all year). Steam is 10 bar from the plant boiler. Instrument air 6 bar.",
    ],
  ]),
);

write(
  "Process description R-101 rev B (superseded).pdf",
  pdf("VRK-PD-101 rev B, SUPERSEDED", [
    [
      "PROCESS DESCRIPTION",
      "Reactor line R-101, Vuoksenranta plant",
      "Document VRK-PD-101, revision B, 2019-06-14",
      "",
      "NOTE: superseded by revision C (2024-05-20). Kept for the simulator study record.",
      "",
      "2. Reactor",
      "Reactor pressure PI-1011 is controlled by the purge valve PV-2041. Setpoint 2650 kPa gauge.",
      "Normal window 2550 to 2800 kPa gauge. High pressure alarm at 2850 kPa. Interlock at 3000 kPa.",
      "Reactor temperature TI-1013 setpoint 121.0 degrees C.",
      "",
      "Simulator study 2019: the plant tags map to the model names of the study, see appendix A.",
      "The historian export tool uses the model names.",
    ],
  ]),
);

write(
  "Loop check report R-101 2026-01 (scan).pdf",
  scannedPdf([
    [
      "SAIMAA KEMIA OY   VUOKSENRANTA   INSTRUMENT DEPT",
      "LOOP CHECK REPORT   R-101   JANUARY 2026",
      "Checked: T. Koskinen   Approved: J. Rantanen   30.1.2026",
      "",
      "LOOP      RESULT       NOTE",
      "PI-1011   OK           0.2 % of span, zero checked at 0 kPa",
      "LI-1012   OK           displacer cleaned, no drift",
      "TI-1013   REPLACED     14.1.2026, old element 2.1 degC low",
      "FI-1001   OK           orifice plate inspected",
      "FI-2001   ATTENTION    0.02 kscmh at zero flow, adjust next outage",
      "TI-2011   OK",
      "LI-2012   OK",
      "PI-2013   OK           kPa gauge, range 0-4000",
      "LI-3012   OK           noisy, 2 s damping added",
      "FI-3017   OK           magflow, empty pipe detection on",
      "JI-2020   OK           calculated from motor current and voltage",
      "",
      "VALVES",
      "FV-1004   POSITIONER   replaced 9.1.2026, was manual 61 % six days",
      "PV-2041   ATTENTION    stem friction high after purge wash, sticks ~1 h",
      "FV-2005   OK           stroke 0-100 % in 12 s",
      "FV-3009   OK",
      "FV-1010   OK           at 68 %, fouling trend since November",
      "",
      "SUMMARY: 21 loops, 18 OK, 2 attention, 1 replaced.",
      "PV-2041 needs new positioner or stem lubrication plan.",
      "FI-2001 zero drift does not affect control.",
      "",
      "",
      "Allekirjoitus: ______________________",
    ],
  ]),
);

write(
  "shift-handover-week-08.txt",
  [
    "VUOKSENRANTA R-101 SHIFT HANDOVER WK 08/2026",
    "",
    "ma 16.2. yö -> aamu (Salo -> Koskinen)",
    "Reactor steady, PI-1011 2710. Purge GC cal 08 by lab, 25 min.",
    "FV-1010 71 %, creeping up, coil fouling as usual. Nothing else.",
    "",
    "ti 17.2. aamu (Koskinen)",
    "Purge line wash 06:40-07:10. PV-2041 stuck 39 % until 08:20, tapped positioner -> auto ok.",
    "JI-2020 347 kW during stick, 338 after. No alarm. Told Salo.",
    "Contractor on site for gate 1 road works, keep gate 2 free for the tanker.",
    "",
    "ke 18.2. ilta (Mäkelä)",
    "LI-3012 swinging +-8 % 40 min period. FV-3009 was left in manual from day shift steam trap test!! Put back to auto, swing died in 2 h. AGAIN. Talk to day shift.",
    "",
    "to 19.2. aamu (Koskinen)",
    "Product GC cal 08:00. AI-4037 D held 0.41 mol% 20 min. Lab says fine.",
    "Small step TI-2022 down ~1 deg around 14:00, river colder after sluice opened upstream.",
    "Canteen closed Friday, bring own lunch.",
    "",
    "pe 20.2. yö (Salo)",
    "Quiet. FI-2001 purge a bit high 0.44 because PV-2041 opened more to hold pressure after A feed FV-1003 went 25 -> 28 %.",
    "",
    "OPEN: spare positioner PV-2041 still not delivered (ordered Nov!). Coil cleaning when FV-1010 > 90 %.",
    "",
  ].join("\n"),
);

write(
  "2026-03-24 Incident report P-302 trip 2026-02-27.md",
  [
    "# Incident report: stripper bottoms pump P-302 trip, 2026-02-27",
    "",
    "Report VRK-IR-2026-004. Author: Mikko Virtanen. Reviewed: Jarkko Rantanen. Classification: process upset, no release, no injury.",
    "",
    "## Sequence",
    "",
    "- 13:42 P-302 trips on seal flush low flow. Stripper underflow FI-3017 falls from 22.8 to 0 m3/h in one sample.",
    "- 13:45 Stripper level LI-3012 starts to rise at about 1.5 percent per minute.",
    "- 13:51 Operator closes the stripper steam valve FV-3009 to 20 percent to slow the rise.",
    "- 14:03 LI-3012 high alarm at 85 percent.",
    "- 14:22 Seal flush line cleaned, P-302 restarted. FI-3017 back to 24 m3/h.",
    "- 15:10 LI-3012 back in the normal band. FV-3009 back to automatic.",
    "",
    "## Effect on the data",
    "",
    "Between 13:42 and 15:10 the stripper tags (LI-3012, PI-3011, FI-3017, TI-3013, FI-3019) are outside their normal ranges. The reactor tags stay normal. Product component D from AI-4037 rises to 0.72 mol percent at 14:30 and returns below 0.6 at 15:45. That product went to the off-spec tank.",
    "",
    "## Root cause",
    "",
    "The seal flush strainer of P-302 was blocked by scale from the closed loop cooling water. The same strainer caused the trip on 2026-01-21. A monthly strainer check is now on the maintenance plan (WO template MT-P302-01).",
    "",
    "## Actions",
    "",
    "| # | Action | Owner | Due |",
    "| --- | --- | --- | --- |",
    "| 1 | Monthly strainer check P-302 | T. Koskinen | 2026-04-01 |",
    "| 2 | Review closed loop water treatment with the supplier | J. Rantanen | 2026-04-30 |",
    "| 3 | Add LI-3012 rate of rise alarm | H. Aaltonen | 2026-05-15 |",
    "",
  ].join("\n"),
);

write(
  "alarm-list-extract-R101.csv",
  [
    "tag,alarm,limit,unit,priority,operator_action",
    "PI-1011,PAH,2895,kPa g,H,Open PV-2041 in manual and check K-201",
    "PI-1011,PAHH,3000,kPa g,HH,Interlock closes FV-1001 FV-1002 FV-1003 FV-1004",
    "LI-1012,LAL,50,%,M,Check D feed FV-1001 and separator underflow",
    "LI-1012,LAH,90,%,H,Reduce feeds",
    "TI-1013,TAH,150,degC,HH,Interlock trips the reactor",
    "TI-1013,TAH pre,128,degC,H,Open FV-1010 fully",
    "LI-2012,LAL,30,%,M,Check FV-2007",
    "LI-3012,LAH,85,%,H,Check P-302 and FV-3008",
    "LI-3012,LAL,20,%,M,Check FV-3009 steam",
    "JI-2020,JAH,360,kW,M,Check PV-2041 for sticking and FV-2005 position",
    "TI-1021,TAH,102,degC,M,Plan coil cleaning",
    "AI-4037,QAH,0.6,mol%,H,Divert product to off-spec tank",
  ].join("\n") + "\n",
);

write(
  "lab-sample-schedule.md",
  [
    "# Laboratory and analyzer schedule, R-101",
    "",
    "Owner: Sari Nieminen. Valid from 2026-01-01. Replaces the 2024 schedule.",
    "",
    "| Analyzer | Stream | Cycle | Calibration | Hold during calibration |",
    "| --- | --- | --- | --- | --- |",
    "| AI-1023 | reactor feed | 6 min | first Monday of the month, 08:00 | about 20 min |",
    "| AI-2029 | purge gas | 15 min | every Monday, 08:00 | about 20 min |",
    "| AI-4037 | product | 15 min | every Thursday, 08:00 | about 20 min |",
    "",
    "Manual lab samples of the product go out at 06:00, 14:00 and 22:00. The lab result for component D is the reference for AI-4037. A difference above 0.05 mol percent triggers an analyzer check.",
    "",
    "During a calibration the historian keeps the last good value. A value that repeats for exactly 20 minutes on a Monday or Thursday morning is a calibration hold, not a fault.",
    "",
    "Sample bottles: order from the lab store, not from purchasing. Bottles left on the platform after 22:00 are thrown away.",
    "",
  ].join("\n"),
);

write(
  "Control narrative R-101 rev 4.md",
  [
    "# Control narrative, reactor line R-101, revision 4",
    "",
    "Saimaa Kemia Oy, Vuoksenranta. Document VRK-CN-101. Approved 2025-11-03 by process control lead H. Aaltonen.",
    "",
    "## 1. Reactor pressure control",
    "",
    "PIC-1011 reads PI-1011 and writes to the purge valve PV-2041. Setpoint 2705 kPa gauge. PI controller, 40 second integral time. A pressure above 2800 kPa opens the purge valve to at least 60 percent through the override block.",
    "",
    "## 2. Reactor level control",
    "",
    "LIC-1012 reads LI-1012 and writes to the D feed valve FV-1001. Setpoint 75 percent. Slow loop, 12 minute integral time. Below 55 percent the E feed FV-1002 ramps down by the low level logic.",
    "",
    "## 3. Reactor temperature control",
    "",
    "TIC-1013 reads TI-1013 and writes to the cooling water valve FV-1010. Setpoint 120.4 degrees C. The cooling water outlet temperature TI-1021 is monitored only, not in a loop. It rises as the coil fouls.",
    "",
    "## 4. Separator and compressor",
    "",
    "LIC-2012 reads LI-2012 and writes to FV-2007. Compressor K-201 runs at fixed speed. The anti-surge controller writes to the recycle valve FV-2005 from a computed flow margin. The recycle valve never closes fully, minimum 12 percent.",
    "",
    "## 5. Stripper",
    "",
    "LIC-3012 reads LI-3012 and writes to the liquid product valve FV-3008. The steam valve FV-3009 follows a ratio to the stripper feed. Operators may put FV-3009 in manual for a steam trap test. It must go back to automatic after the test, see the operating instruction OI-301-07.",
    "",
    "## 6. Composition control",
    "",
    "The product analyzer AI-4037 feeds a supervisory controller that trims the A feed valve FV-1003 every 15 minutes. The purge analyzer AI-2029 has no closed loop. The feed analyzer AI-1023 is for monitoring.",
    "",
  ].join("\n"),
);

write(
  "PID legend and tag numbering.md",
  [
    "# P&ID legend and tag numbering, Vuoksenranta",
    "",
    "Document VRK-STD-004, revision B, 2019-06-14.",
    "",
    "A tag has two letters, a dash, and four digits. The first letter is the measured variable and the second the function.",
    "",
    "| Letters | Meaning |",
    "| --- | --- |",
    "| FI | Flow indication |",
    "| FV | Flow control valve |",
    "| PI | Pressure indication |",
    "| PV | Pressure control valve |",
    "| LI | Level indication |",
    "| TI | Temperature indication |",
    "| AI | Analyzer indication |",
    "| JI | Power indication |",
    "",
    "The first digit of the number is the area: 1 reactor, 2 separator and compressor, 3 stripper, 4 product handling. The other three digits are the loop number in the area.",
    "",
    "Equipment: R-101 reactor, E-202 condenser, V-201 separator, K-201 recycle compressor, T-301 stripper, P-302 stripper bottoms pump.",
    "",
    "Units in the DCS: pressure in kPa gauge, temperature in degrees Celsius, level in percent of range, gas flow in kscmh (thousand standard cubic meters per hour), liquid flow in m3/h or kg/h as marked on the tag list, valve position in percent open.",
    "",
  ].join("\n"),
);

write(
  "2026-03-31 Production report March 2026.md",
  [
    "# Production report, reactor line R-101, March 2026",
    "",
    "Prepared by Timo Heikkinen, production planning. Distribution: plant management, Norrin project.",
    "",
    "## Summary",
    "",
    "Production of G and H was 96.2 percent of plan. Three events cost production time: the analyzer column change on 9 March (no loss, quality hold only), the closed loop cooling change on 1 March (four hours at reduced rate), and the A feed supply limit from 22 to 24 March (three days at 80 percent).",
    "",
    "## Quality",
    "",
    "Product component D from AI-4037 stayed below 0.6 mol percent except for one hour on 27 February that fell in the February report. The March average was 0.42 mol percent.",
    "",
    "## Events with an effect on the trends",
    "",
    "- 2026-03-01 08:00 to 12:00: reduced rate at 70 percent while the cooling water source changed. All feed flows lower. TI-2022 shifted down about 4 degrees C and stayed there.",
    "- 2026-03-09 08:00 to 08:45: purge GC calibration with column change. AI-2029 values held.",
    "- 2026-03-22 to 2026-03-24: A feed limited to 80 percent by the supplier. FI-1001 and FV-1003 low, A in the reactor feed about 3 mol percent lower than normal.",
    "- No purge valve sticking after 3 March. PV-2041 behaved after the stem lubrication change.",
    "",
    "## Personnel",
    "",
    "One new operator (J. Lahti) started on the C shift on 16 March. Summer holiday plans are due by 15 April.",
    "",
    "## Outlook",
    "",
    "Cooling coil cleaning on 20 April, planned 36 hours. Expect FV-1010 to drop from about 88 to 40 percent and TI-1021 to drop about 8 degrees C after the restart.",
    "",
  ].join("\n"),
);

write(
  "Operator training R-101 module 3 notes.txt",
  [
    "OPERATOR TRAINING, R-101, MODULE 3: READING THE TRENDS",
    "Trainer notes, H. Aaltonen, 2025-09. Internal.",
    "",
    "Slide 1. The three reactor loops. Pressure PIC-1011 to purge valve PV-2041. Level LIC-1012 to D feed FV-1001. Temperature TIC-1013 to cooling water FV-1010.",
    "",
    "Slide 2. What a sticking purge valve looks like. PV-2041 position goes flat. PI-1011 drifts up a few kPa. JI-2020 climbs 5 to 15 kW. FI-2001 purge rate falls. Fix: tap the positioner, then call instrument dept.",
    "",
    "Slide 3. What coil fouling looks like. Over weeks FV-1010 opens more and more for the same temperature. TI-1021 climbs. When the valve is near 90 percent, call maintenance for the coil cleaning.",
    "",
    "Slide 4. What a P-302 trip looks like. FI-3017 goes to zero in one sample. LI-3012 climbs fast. Close FV-3009 to 20 percent, restart the pump, then return the steam valve to auto.",
    "",
    "Slide 5. Analyzer holds are not faults. A flat composition trace for 20 minutes on Monday or Thursday morning is a calibration. A flat trace at any other time for more than 30 minutes is an analyzer fault, call the lab.",
    "",
    "Slide 6. Units. Pressures in kPa gauge, not bar. 100 kPa is one bar. Temperatures in degrees C. Levels in percent.",
    "",
    "Slide 7. Quiz. Ten questions, answers on the intranet.",
    "",
  ].join("\n"),
);

write(
  "instrument-calibration-log-2025-2026.csv",
  [
    "date,tag,instrument,as_found_error,as_left_error,unit,technician,note",
    "2025-11-04,PI-1011,Rosemount 3051,-3.1,0.4,kPa,T. Koskinen,annual",
    "2025-11-04,PI-2013,Rosemount 3051,-1.8,0.2,kPa,T. Koskinen,annual",
    "2025-11-05,TI-1013,type K thermocouple,-1.6,-1.6,degC,T. Koskinen,left as found; replacement ordered",
    "2025-11-05,TI-1021,Pt100,0.3,0.1,degC,T. Koskinen,annual",
    "2025-11-06,LI-1012,displacer,1.2,0.3,%,P. Salo,annual",
    "2025-11-06,LI-3012,dp cell,-0.8,0.2,%,P. Salo,annual",
    "2026-01-14,TI-1013,type K thermocouple,-2.1,0.1,degC,T. Koskinen,element replaced",
    "2026-01-30,FI-2001,thermal mass,0.02,0.02,kscmh,T. Koskinen,zero offset at no flow left as found",
    "2026-03-09,AI-2029,GC,n/a,n/a,mol%,S. Nieminen,column replaced",
  ].join("\n") + "\n",
);

write(
  "Turvallisuustiedote 2026-02 R-101.md",
  [
    "# Turvallisuustiedote, reaktorilinja R-101, helmikuu 2026",
    "",
    "Saimaa Kemia Oy, Vuoksenrannan tehdas. Laatija: käyttöpäällikkö R. Hakala. Jakelu: kaikki vuorot, kunnossapito, laboratorio.",
    "",
    "## Painehälytykset tammikuussa",
    "",
    "Reaktorin paine PI-1011 ylitti hälytysrajan 2895 kPa kaksi kertaa tammikuussa, molemmat 13. tammikuuta poistoventtiilin PV-2041 jumituttua pesun jälkeen. Lukitusraja 3000 kPa ei ylittynyt. Kompressorin teho JI-2020 nousi samalla noin 10 kW.",
    "",
    "## Toimenpiteet",
    "",
    "Poistoventtiilin karan voitelu lisätään viikoittaiseen pesuohjelmaan. Uusi asennoitin on tilattu (tilaus PO-26-0142). Operaattorit tarkistavat venttiilin asennon manuaalisesti pesun jälkeen kunnes asennoitin on vaihdettu.",
    "",
    "## Muistutus",
    "",
    "Strippauskolonnin höyryventtiili FV-3009 palautetaan automaatille heti höyrylukkotestin jälkeen. Manuaalilla pinta LI-3012 alkaa heilua noin 40 minuutin jaksolla.",
    "",
    "## Muuta",
    "",
    "Portti 1 on suljettu tietöiden takia huhtikuun loppuun. Käyttäkää porttia 2. Kypärä ja suojalasit pakolliset myös parkkipaikalla tietyöalueen kohdalla.",
    "",
  ].join("\n"),
);

write(
  "Purchase order PO-26-0142 positioner PV-2041.pdf",
  pdf("Purchase order PO-26-0142", [
    [
      "PURCHASE ORDER PO-26-0142",
      "Saimaa Kemia Oy, Vuoksenranta plant, maintenance",
      "Supplier: Nordic Valve Service Oy, Lahti",
      "Ordered: 2025-11-18 by T. Koskinen    Requested delivery: 2025-12-15",
      "",
      "Line  Item                                              Qty   Unit price   Total",
      "1     Smart positioner, model NVS-8400, 4-20 mA, HART   1     1 840,00     1 840,00",
      "      for purge valve PV-2041, DN80, stem 20 mm",
      "2     Mounting kit NVS-8400 / DN80                     1       190,00       190,00",
      "3     Commissioning on site, half day                   1       650,00       650,00",
      "",
      "Total excl. VAT                                                         2 680,00 EUR",
      "",
      "Delivery note: supplier informed 2026-01-12 that the positioner is back-ordered,",
      "new delivery estimate week 12/2026. Maintenance uses weekly stem lubrication until then.",
      "",
      "Terms: 30 days net. Deliver to gate 2, maintenance store.",
    ],
  ]),
);

write(
  "HSE toolbox talk 2026-02.md",
  [
    "# HSE toolbox talk, February 2026",
    "",
    "Topic: winter walking routes and the road works at gate 1.",
    "",
    "- Gate 1 is closed until the end of April. All traffic through gate 2. The tanker unloading bay stays free between 06:00 and 08:00.",
    "- The walking route from the parking to the control room is sanded twice a day. Report ice to the gatehouse.",
    "- Helmet and safety glasses are mandatory in the road works area, including the parking lot next to it.",
    "- Near miss in January: a contractor van reversed into the fence at gate 1. No injury. Reversing without a spotter is not allowed on site.",
    "",
    "Questions to the HSE coordinator. Next talk in March: hot work permits before the summer shutdown.",
    "",
  ].join("\n"),
);

write(
  "2026-03-19 RE Purge valve positioner installed.eml",
  eml({
    id: "5b7e2a-01",
    from: mikko,
    to: `Anna Lehtinen <${anna[1]}>`,
    cc: `${jarkko[0]} <${jarkko[1]}>, ${corpus}`,
    subject: "Purge valve positioner installed",
    date: "Thu, 19 Mar 2026 15:03:44 +0200",
    body: [
      "Hi Anna,",
      "",
      "Quick note: the new positioner from PO-26-0142 went into PV-2041 today, MOC-2026-014 signed off at 14:20. Stroke test passed. The weekly stem lubrication workaround is gone from the wash checklist.",
      "",
      "You should not see the Tuesday compressor power bump from the old sticking valve any more from today onward. Tell us if it comes back.",
      "",
      "Terveisin,",
      "Mikko",
      "",
      "Mikko Virtanen | Käyttöinsinööri / Process engineer | Saimaa Kemia Oy, Vuoksenrannan tehdas",
      ...disclaimer,
    ],
  }),
);

write(
  "MOC-2026-014 purge valve positioner replacement.docx",
  await docx([
    { heading: "Management of change MOC-2026-014", text: "Saimaa Kemia Oy, Vuoksenrannan tehdas. Reactor line R-101. Raised by M. Virtanen. Approved by J. Rantanen and T. Koskinen. Date 2026-03-18." },
    {
      heading: "Change",
      text: "Replace the positioner on the purge valve PV-2041 with the smart positioner from purchase order PO-26-0142, Nordic Valve Service Oy, model NVS-8400. The old pneumatic positioner sticks after every wash of the purge line and needs the weekly stem lubrication from the February safety bulletin.",
    },
    { heading: "Reason", text: "The positioner arrived from the supplier in week 12 as re-quoted. Staying on the old positioner risks a pressure trip on a wash day if the stem lubrication step is missed." },
    { heading: "Risk assessment", text: "The valve is isolated and set to manual before the swap. The shift operator watches reactor pressure PI-1011 during the two hour work window. No process risk if the work permit sequence is followed." },
    {
      heading: "Implementation",
      text: "Nordic Valve Service Oy on site 2026-03-19, day shift. Instrument department, P. Salo, assists. The positioner is commissioned and stroke tested before handover. The weekly stem lubrication step comes off the wash checklist once commissioning is signed off.",
    },
    { heading: "Sign-off", text: "Commissioned 2026-03-19 at 14:20. Stroke test passed, 0 to 100 percent in 8 seconds. J. Rantanen accepts the change. Copy to the data team at Norrin for their records." },
  ]),
);

write(
  "Operator training R-101 module 4 alarm response.pptx",
  await pptx([
    ["OPERATOR TRAINING, R-101, MODULE 4: ALARM RESPONSE", "Trainer notes, H. Aaltonen, 2026-03. Internal."],
    ["Slide 1. Alarm priorities.", "High: reactor pressure PI-1011 above 2895 kPa, reactor level LI-1012 outside 20 to 80 percent.", "Low: analyzer hold longer than 30 minutes, cooling valve FV-1010 above 90 percent."],
    ["Slide 2. High reactor pressure PI-1011.", "Check the purge valve PV-2041 position first.", "Since the positioner change on 19 March a stuck valve is not expected.", "If the valve responds, the alarm should clear within two minutes."],
    ["Slide 3. The P-302 trip sequence, in order.", "1. FI-3017 goes to zero.", "2. LI-3012 climbs fast.", "3. Close FV-3009 to 20 percent.", "4. Restart the pump.", "5. Return the steam valve to auto."],
    ["Slide 4. Cooling coil fouling, FV-1010.", "The valve opens further each week for the same reactor temperature.", "Book the coil cleaning near 90 percent, before it reaches the high alarm.", "After a cleaning, expect TI-1021 to drop about 8 degrees C."],
    ["Slide 5. Quiz.", "Eight questions, answers on the intranet."],
  ]),
);

write(
  "2026-04-23 Saimaa Kemia April sync.vtt",
  vtt([
    ["00:00:02", "Anna Lehtinen", "Hi all. Two things today, the cooling coil cleaning and the purge valve. Mikko, how did the cleaning go?"],
    ["00:00:11", "Mikko Virtanen", "Went as planned, twentieth and twenty first of April. FV-1010 dropped from about eighty eight to forty percent right after the restart, and TI-1021 came down about eight degrees. Exactly what we told you last time."],
    ["00:00:29", "Anna Lehtinen", "Good, that matches. And the purge valve, any sign of the old sticking since the positioner change?"],
    ["00:00:36", "Mikko Virtanen", "None. Zero bumps on the compressor power since the nineteenth of March. The MOC closed it out properly."],
    ["00:00:45", "Jarkko Rantanen", "On the analyzer side, the reactor feed chromatograph got its new column on the sixth as planned. There is a small level shift on the feed composition, about half a mole percent, like Sari said it would be. Not a process change."],
    ["00:01:03", "Sari Nieminen", "Confirmed, the shift is in the calibration record. Nothing else from the lab this month."],
    ["00:01:10", "Anna Lehtinen", "Great, a quiet month for once. Thanks everyone, talk next time."],
    ["00:01:15", "Jarkko Rantanen", "Kiitos, moikka."],
  ]),
);

write(
  "2026-04-30 Production report April 2026.md",
  [
    "# Production report, reactor line R-101, April 2026",
    "",
    "Prepared by Timo Heikkinen, production planning. Distribution: plant management, Norrin project.",
    "",
    "## Summary",
    "",
    "Production of G and H was 98.4 percent of plan. One planned event cost production time: the cooling coil cleaning on 20 to 21 April, 36 hours at reduced rate. No unplanned stoppages.",
    "",
    "## Quality",
    "",
    "Product component D from AI-4037 stayed below 0.6 mol percent all month. The April average was 0.39 mol percent, the best of the year so far.",
    "",
    "## Events with an effect on the trends",
    "",
    "- 2026-04-06: reactor feed chromatograph AI-1023 got a new column. Feed composition shifted about 0.5 mol percent, a calibration effect, not a process change.",
    "- 2026-04-20 08:00 to 2026-04-21 20:00: cooling coil cleaning. FV-1010 dropped from about 88 to 40 percent, TI-1021 dropped about 8 degrees C after the restart.",
    "- No purge valve sticking this month. PV-2041 has had zero events since the positioner replacement on 19 March (MOC-2026-014).",
    "",
    "## Personnel",
    "",
    "Summer holiday schedule for the automation team is confirmed: Jarkko week 9 already covered, Mikko weeks 27 to 28, Sari weeks 29 to 30.",
    "",
    "## Outlook",
    "",
    "No major maintenance planned for May. Next scheduled event is the annual instrument calibration round in November.",
    "",
  ].join("\n"),
);

console.log(`\n${out}`);
