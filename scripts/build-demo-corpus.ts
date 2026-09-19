import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "data", "demo-corpus");
mkdirSync(out, { recursive: true });
const write = (name: string, body: string | Buffer) => {
  writeFileSync(join(out, name), body);
  console.log(`wrote ${name}`);
};

const vtt = (cues: [string, string, string][]): string =>
  `WEBVTT\n\n${cues.map(([start, who, text]) => `${start}.000 --> ${end(start)}.000\n<v ${who}>${text}</v>`).join("\n\n")}\n`;
const end = (start: string): string => {
  const [h, m, s] = start.split(":").map(Number) as [number, number, number];
  const total = h * 3600 + m * 60 + s + 6;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

write(
  "2026-02-12 Kickoff Saimaa Kemia data handover.vtt",
  vtt([
    ["00:00:04", "Anna Lehtinen", "Okay, recording is on. Thanks everyone. Jarkko, could you start with what is in the export you sent on Monday?"],
    ["00:00:12", "Jarkko Rantanen", "Sure. It is a historian export from the Vuoksenranta reactor line, unit R-101 and the separator and stripper section. Every row is one three minute sample. The time column is local time, Europe/Helsinki, and the export ran on the DST change weekend so there is one repeated hour in late October."],
    ["00:00:41", "Anna Lehtinen", "Good to know. And the column names, xmeas one to forty one and xmv one to eleven, those are the simulator names, not your tags?"],
    ["00:00:52", "Jarkko Rantanen", "Correct. The historian has our own tag names, but the export tool maps them to the model numbering. I will send the tag list as a CSV. In short, xmeas seven is the reactor pressure, xmeas eight is the reactor level and xmeas nine is the reactor temperature."],
    ["00:01:18", "Mikko Virtanen", "One thing about xmeas nine. The thermocouple on R-101 was replaced on the fourteenth of January. Before that it read about two degrees low for maybe three weeks. So if you see a step in January, that is the instrument, not the process."],
    ["00:01:40", "Anna Lehtinen", "That is exactly the kind of thing we need. Is the pressure in bar or kilopascal?"],
    ["00:01:46", "Jarkko Rantanen", "Kilopascal gauge. Operators talk in bar, but the historian stores kPa gauge. Normal operating point is around two thousand seven hundred."],
    ["00:02:02", "Mikko Virtanen", "And xmv six, the purge valve, that one is interesting. It sticks after every wash cycle of the purge line. You will see the valve position flat for an hour or so while the compressor work, xmeas twenty, climbs. Maintenance knows about it."],
    ["00:02:30", "Anna Lehtinen", "How often are the wash cycles?"],
    ["00:02:33", "Mikko Virtanen", "Roughly weekly, usually Tuesday morning shift. It is in the maintenance log."],
    ["00:02:45", "Jarkko Rantanen", "The composition columns, xmeas twenty three to forty one, come from the gas chromatographs. The reactor feed analyzer has a six minute cycle and the purge and product analyzers have a fifteen minute cycle. So those columns repeat values between analyzer updates. Do not treat the repeats as stuck sensors."],
    ["00:03:15", "Anna Lehtinen", "Understood. Sampling three minutes, analyzers six and fifteen. Anything about missing values?"],
    ["00:03:22", "Jarkko Rantanen", "A bad quality tag comes out as an empty cell. There was a historian outage on the second of December for about five hours, all columns are empty there."],
    ["00:03:40", "Anna Lehtinen", "Perfect. Last one for today, who is the contact for process questions when you are on holiday?"],
    ["00:03:47", "Jarkko Rantanen", "Mikko for anything on the reactor and the valves, and Sari Nieminen for the lab and analyzer side."],
  ]),
);

write(
  "2026-03-05 Weekly Saimaa Kemia review.vtt",
  vtt([
    ["00:00:03", "Anna Lehtinen", "Welcome back. We looked at the drift on xmeas twenty one, the reactor cooling water outlet temperature. It climbs slowly from mid February."],
    ["00:00:16", "Mikko Virtanen", "Yes, that is fouling on the cooling coil. We clean it every spring. Last cleaning was in April last year. The outlet temperature rises about half a degree per week until the cleaning."],
    ["00:00:38", "Anna Lehtinen", "So the drift is real and expected. Is there anything that compensates?"],
    ["00:00:44", "Mikko Virtanen", "The controller opens xmv ten, the reactor cooling water flow valve, a bit more every week. When xmv ten reaches about ninety percent, we schedule the cleaning."],
    ["00:01:02", "Sari Nieminen", "On the lab side, the purge analyzer, xmeas twenty nine to thirty six, gets calibrated every Monday at eight. The calibration takes about twenty minutes and during that time the values hold the last reading."],
    ["00:01:22", "Anna Lehtinen", "Noted, Monday eight o'clock hold on the purge composition. What about the product analyzer?"],
    ["00:01:30", "Sari Nieminen", "Same schedule, but on Thursdays. And xmeas thirty seven, the D component in the product, is the one quality tag the customer cares about. The spec limit is below zero point six mole percent."],
    ["00:01:52", "Jarkko Rantanen", "One correction from last time. I said the purge valve is xmv six. That is right for the model numbering, but our tag is PV-2041. Same thing."],
    ["00:02:08", "Anna Lehtinen", "Thanks. We will map PV-2041 to xmv six."],
  ]),
);

const eml = (id: string, from: [string, string], to: string, subject: string, date: string, body: string, inReplyTo?: string): string =>
  [
    `Message-ID: <${id}@saimaakemia.example>`,
    inReplyTo ? `In-Reply-To: <${inReplyTo}@saimaakemia.example>` : "",
    `From: ${from[0]} <${from[1]}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter((line) => line !== "")
    .join("\r\n");

write(
  "2026-02-16 RE Tag list and units.eml",
  eml(
    "9f2a1c-02",
    ["Jarkko Rantanen", "jarkko.rantanen@saimaakemia.example"],
    "Anna Lehtinen <anna.lehtinen@norrin.example>, corpus+norrin@norrin.example",
    "RE: Tag list and units",
    "Mon, 16 Feb 2026 09:42:11 +0200",
    [
      "Hi Anna,",
      "",
      "Tag list attached as CSV. A few notes that are not in the file:",
      "",
      "- xmeas_7 (PI-1011) is reactor pressure in kPa gauge. The alarm high limit is 2895 kPa and the trip is at 3000 kPa.",
      "- xmeas_8 (LI-1012) is reactor level in percent of the sight glass range, not liters.",
      "- xmeas_15 (LI-3012) is the stripper level. It oscillates with a period of about 40 minutes when the stripper steam valve xmv_9 is in manual. That is normal for us.",
      "- xmv_4 (FV-1004) is the A and C feed valve. It was in manual at 61 percent from 3 to 9 January because of a positioner fault.",
      "- The time column is Europe/Helsinki local time. I can re-export in UTC if that is easier.",
      "",
      "Terveisin,",
      "Jarkko",
      "",
      "Jarkko Rantanen | Automation engineer | Saimaa Kemia Oy, Vuoksenranta plant",
      "",
      "-----Alkuperäinen viesti-----",
      "Lähettäjä: Anna Lehtinen",
      "Lähetetty: perjantai 13. helmikuuta 2026 16:05",
      "Aihe: Tag list and units",
      "",
      "> Hi Jarkko, could you send the tag list and confirm the pressure unit?",
    ].join("\r\n"),
    "9f2a1c-01",
  ),
);

write(
  "2026-03-10 RE Question about xmeas_16 and xmeas_18.eml",
  eml(
    "7b31de-02",
    ["Mikko Virtanen", "mikko.virtanen@saimaakemia.example"],
    "corpus+norrin@norrin.example",
    "RE: Question about xmeas_16 and xmeas_18",
    "Tue, 10 Mar 2026 14:17:03 +0200",
    [
      "Hello,",
      "",
      "xmeas_16 is the stripper pressure (PI-3011, kPa gauge) and xmeas_18 is the stripper temperature (TI-3013, degrees C). They move together because the stripper runs close to saturation.",
      "",
      "xmeas_17 is the stripper underflow in m3/h. When the stripper bottoms pump P-302 trips, xmeas_17 drops to zero within one sample and xmeas_15 rises fast. That happened on 21 January and on 27 February.",
      "",
      "Also, xmv_9 is the stripper steam valve, the same one Jarkko mentioned. Our tag is FV-3009.",
      "",
      "Regards,",
      "Mikko",
      "",
      "Sent from my iPhone",
    ].join("\r\n"),
    "7b31de-01",
  ),
);

write(
  "2026-03-18 Compressor recycle valve.eml",
  eml(
    "c0ffee-01",
    ["Sari Nieminen", "sari.nieminen@saimaakemia.example"],
    "corpus+norrin@norrin.example",
    "Compressor recycle valve",
    "Wed, 18 Mar 2026 08:03:50 +0200",
    [
      "Hi,",
      "",
      "You asked about xmv_5. It is the compressor recycle valve, our tag FV-2005. Operators keep it between 15 and 30 percent. When it goes above 40 percent, the compressor is close to surge and xmeas_20, the compressor work in kW, becomes noisy.",
      "",
      "One more: xmeas_22 is the separator cooling water outlet temperature. We changed the cooling water source from the river to the closed loop on 1 March, so the level of xmeas_22 shifted down by about 4 degrees from that day. It is not a fault.",
      "",
      "Best regards,",
      "Sari Nieminen",
      "Laboratory and analyzers, Saimaa Kemia Oy",
    ].join("\r\n"),
  ),
);

write(
  "tag-list-vuoksenranta.csv",
  [
    "tag;model_name;description;unit;low;high",
    "FI-1001;xmeas_1;A feed flow to reactor;kscmh;0;1",
    "FI-1002;xmeas_2;D feed flow to reactor;kg/h;3000;4500",
    "FI-1003;xmeas_3;E feed flow to reactor;kg/h;3500;5000",
    "FI-1004;xmeas_4;A and C feed flow;kscmh;8;10",
    "FI-1005;xmeas_5;Recycle flow to reactor;kscmh;25;30",
    "FI-1006;xmeas_6;Reactor feed rate;kscmh;40;45",
    "PI-1011;xmeas_7;Reactor R-101 pressure;kPa gauge;2600;2850",
    "LI-1012;xmeas_8;Reactor R-101 level;%;60;80",
    "TI-1013;xmeas_9;Reactor R-101 temperature;degC;118;124",
    "FI-2001;xmeas_10;Purge rate;kscmh;0.2;0.5",
    "TI-2011;xmeas_11;Separator V-201 temperature;degC;75;85",
    "LI-2012;xmeas_12;Separator V-201 level;%;40;60",
    "PI-2013;xmeas_13;Separator V-201 pressure;kPa gauge;2600;2750",
    "FI-2014;xmeas_14;Separator underflow;m3/h;20;30",
    "LI-3012;xmeas_15;Stripper T-301 level;%;40;60",
    "PI-3011;xmeas_16;Stripper T-301 pressure;kPa gauge;3050;3150",
    "FI-3017;xmeas_17;Stripper underflow;m3/h;20;25",
    "TI-3013;xmeas_18;Stripper T-301 temperature;degC;60;70",
    "FI-3019;xmeas_19;Stripper steam flow;kg/h;200;260",
    "JI-2020;xmeas_20;Compressor K-201 work;kW;330;350",
    "TI-1021;xmeas_21;Reactor cooling water outlet temperature;degC;92;100",
    "TI-2022;xmeas_22;Separator cooling water outlet temperature;degC;72;80",
    "AI-1023;xmeas_23;Reactor feed component A;mol%;30;35",
    "AI-2029;xmeas_29;Purge gas component A;mol%;30;35",
    "AI-4037;xmeas_37;Product component D;mol%;0;0.6",
    "FV-1001;xmv_1;D feed valve;%;50;70",
    "FV-1002;xmv_2;E feed valve;%;45;60",
    "FV-1003;xmv_3;A feed valve;%;20;30",
    "FV-1004;xmv_4;A and C feed valve;%;55;65",
    "FV-2005;xmv_5;Compressor recycle valve;%;15;30",
    "PV-2041;xmv_6;Purge valve;%;35;50",
    "FV-2007;xmv_7;Separator pot liquid flow valve;%;35;45",
    "FV-3008;xmv_8;Stripper liquid product flow valve;%;40;50",
    "FV-3009;xmv_9;Stripper steam valve;%;40;55",
    "FV-1010;xmv_10;Reactor cooling water flow valve;%;35;95",
    "FV-2011;xmv_11;Condenser cooling water flow valve;%;15;25",
  ].join("\n") + "\n",
);

write(
  "maintenance-log-2026-Q1.csv",
  [
    "date,work_order,equipment,tag,description,technician",
    "2026-01-03,WO-26011,FV-1004,xmv_4,Positioner fault. Valve set to manual 61 percent until spare positioner arrives.,T. Koskinen",
    "2026-01-09,WO-26011,FV-1004,xmv_4,Positioner replaced. Valve back in automatic.,T. Koskinen",
    "2026-01-13,WO-26019,PV-2041,xmv_6,Purge line wash. Valve stuck at 38 percent for 70 minutes after wash.,P. Salo",
    "2026-01-14,WO-26020,TI-1013,xmeas_9,Thermocouple replaced. Old element read about 2 degC low.,T. Koskinen",
    "2026-01-20,WO-26024,PV-2041,xmv_6,Purge line wash. Valve stuck 55 minutes after wash.,P. Salo",
    "2026-01-21,WO-26026,P-302,xmeas_17,Stripper bottoms pump trip on high bearing temperature. Restarted after 40 minutes.,P. Salo",
    "2026-01-27,WO-26030,PV-2041,xmv_6,Purge line wash. Valve stuck 65 minutes after wash.,P. Salo",
    "2026-02-03,WO-26035,PV-2041,xmv_6,Purge line wash. No sticking this time after lubrication of the stem.,P. Salo",
    "2026-02-10,WO-26041,PV-2041,xmv_6,Purge line wash. Valve stuck 80 minutes after wash.,P. Salo",
    "2026-02-27,WO-26055,P-302,xmeas_17,Stripper bottoms pump trip. Seal flush blocked. Cleaned and restarted.,T. Koskinen",
    "2026-03-01,WO-26058,E-202,xmeas_22,Separator cooling water switched from river intake to closed loop.,J. Rantanen",
    "2026-03-09,WO-26063,AI-2029,xmeas_29,Purge GC column replaced during Monday calibration. Calibration took 45 minutes instead of 20.,S. Nieminen",
  ].join("\n") + "\n",
);

write(
  "historian-export-notes.md",
  [
    "# Historian export notes, Vuoksenranta reactor line",
    "",
    "Prepared by Jarkko Rantanen for Norrin, 2026-02-11.",
    "",
    "## Sampling and time",
    "",
    "The export holds one row every 3 minutes. The `time` column is local time in Europe/Helsinki. The historian samples each tag on change and the export tool interpolates to the 3 minute grid with the last value.",
    "",
    "The historian was down from 2025-12-02 09:10 to 14:25 local time. Every column is empty in that window.",
    "",
    "## Quality",
    "",
    "A tag with bad quality comes out as an empty cell. A frozen value for more than 30 minutes on a flow or pressure tag is a communication fault of the field bus segment, not a process condition. The analyzer tags are an exception, see below.",
    "",
    "## Analyzers",
    "",
    "xmeas_23 to xmeas_28 come from the reactor feed gas chromatograph AI-1023 with a 6 minute cycle. xmeas_29 to xmeas_36 come from the purge chromatograph AI-2029 and xmeas_37 to xmeas_41 from the product chromatograph AI-4037, both with a 15 minute cycle. Between two analyzer results the value repeats.",
    "",
    "The purge analyzer calibrates on Mondays at 08:00 and the product analyzer on Thursdays at 08:00. During a calibration the values hold for about 20 minutes.",
    "",
    "## Known events in the export period",
    "",
    "- 2026-01-03 to 2026-01-09: xmv_4 in manual at 61 percent (positioner fault).",
    "- 2026-01-14: TI-1013 (xmeas_9) thermocouple replaced. About a 2 degC step up.",
    "- 2026-01-21 and 2026-02-27: stripper bottoms pump P-302 trips. xmeas_17 drops to zero, xmeas_15 rises.",
    "- Weekly Tuesday morning: purge line wash. PV-2041 (xmv_6) tends to stick for about an hour after the wash.",
    "- 2026-03-01: separator cooling water source changed. xmeas_22 shifts down about 4 degC.",
    "",
    "## Units",
    "",
    "Pressures are kPa gauge. Temperatures are degrees Celsius. Levels are percent of the instrument range. Flows are as in the tag list. Valve positions are percent open.",
    "",
  ].join("\n"),
);

function pdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  for (const lines of pages) {
    const stream = `BT /F1 11 Tf 14 TL 60 760 Td ${lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

write(
  "Process description R-101 rev C.pdf",
  pdf([
    [
      "Saimaa Kemia Oy, Vuoksenranta plant",
      "Process description, reactor line R-101, revision C, 2024-05-20",
      "",
      "1. Reactor",
      "Gaseous reactants A, C, D and E enter reactor R-101 and form liquid products G and H.",
      "The reactor is a stirred vessel with an internal cooling coil. Reactor pressure PI-1011 is",
      "controlled by the purge valve PV-2041. Reactor level LI-1012 is controlled by the D feed",
      "valve FV-1001. Reactor temperature TI-1013 is controlled by the cooling water valve FV-1010.",
      "",
      "Normal operating window: pressure 2600 to 2850 kPa gauge, level 60 to 80 percent,",
      "temperature 118 to 124 degrees C. The high pressure alarm is at 2895 kPa and the safety",
      "interlock closes the feed valves at 3000 kPa.",
    ],
    [
      "2. Separator and compressor",
      "The reactor product cools in condenser E-202 and separates in vessel V-201. The vapor goes",
      "back to the reactor through compressor K-201. The recycle valve FV-2005 protects the",
      "compressor from surge. Compressor power JI-2020 is a good early indicator of a sticking",
      "purge valve: when PV-2041 sticks closed, the recycle load and the compressor power rise.",
      "",
      "3. Stripper",
      "The liquid from V-201 goes to stripper T-301. Steam through FV-3009 strips the light",
      "components, which return to the reactor feed. The bottoms pump P-302 sends the product",
      "to storage. Stripper level LI-3012 is the most sensitive level in the unit and oscillates",
      "when the steam valve is in manual.",
      "",
      "4. Analyzers",
      "Three gas chromatographs measure the reactor feed (AI-1023, 6 minute cycle), the purge",
      "(AI-2029, 15 minute cycle) and the product (AI-4037, 15 minute cycle). The product",
      "specification is component D below 0.6 mol percent.",
    ],
  ]),
);

write(
  "sensor-sample-week-07.csv",
  ["time,xmeas_7,xmeas_9,xmv_6,xmeas_20", ...Array.from({ length: 480 }, (_, i) => `2026-02-10T${String(Math.floor(i / 20)).padStart(2, "0")}:${String((i % 20) * 3).padStart(2, "0")}:00+02:00,${(2705 + 12 * Math.sin(i / 9)).toFixed(1)},${(120.4 + 0.6 * Math.cos(i / 15)).toFixed(2)},${i > 60 && i < 84 ? "38.0" : (42 + 3 * Math.sin(i / 7)).toFixed(1)},${(338 + (i > 60 && i < 84 ? 9 : 0) + 2 * Math.sin(i / 5)).toFixed(1)}`)].join("\n") + "\n",
);

write(
  "shift-handover-week-08.txt",
  [
    "VUOKSENRANTA R-101 SHIFT HANDOVER, WEEK 08 2026",
    "",
    "Mon 16.2. night -> morning (Salo -> Koskinen)",
    "Reactor steady, PI-1011 at 2710 kPa. Purge analyzer calibration at 08 done by lab, took 25 min.",
    "FV-1010 at 71 %, creeping up slowly, coil fouling as usual before spring cleaning.",
    "",
    "Tue 17.2. morning (Koskinen)",
    "Purge line wash 06:40 to 07:10. PV-2041 stuck at 39 % until 08:20, tapped the positioner, went back to auto.",
    "JI-2020 went to 347 kW during the stick, back to 338 kW after. No alarm.",
    "",
    "Wed 18.2. evening (Mäkelä)",
    "LI-3012 swinging plus minus 8 % with 40 min period. FV-3009 was in manual since the day shift test, put it back to auto, swing died out in two hours.",
    "",
    "Thu 19.2. morning (Koskinen)",
    "Product GC calibration 08:00. AI-4037 D component held at 0.41 mol% for 20 min. Lab says fine.",
    "Small step in TI-2022 downwards around 14:00, about 1 degree, river water colder after the sluice opened upstream.",
    "",
    "Fri 20.2. night (Salo)",
    "Quiet. FI-2001 purge rate a bit high at 0.44 kscmh because PV-2041 opened more to hold pressure after the A feed FV-1003 went from 25 to 28 %.",
    "",
    "Open items: spare positioner for PV-2041 still not delivered. Coil cleaning to be scheduled when FV-1010 passes 90 %.",
    "",
  ].join("\n"),
);

write(
  "2026-02-20 RE UTC export and separator pressure unit.eml",
  eml(
    "a11ce0-02",
    ["Jarkko Rantanen", "jarkko.rantanen@saimaakemia.example"],
    "corpus+norrin@norrin.example",
    "RE: UTC export and separator pressure unit",
    "Fri, 20 Feb 2026 11:20:44 +0200",
    [
      "Hi Anna,",
      "",
      "Correction to what Timo wrote below: xmeas_13, the separator pressure PI-2013, is in kPa gauge like every other pressure in the export. It is not in bar. The value around 2700 should make that clear.",
      "",
      "About the time base: I re-exported the same period in UTC. The file name ends with _utc. The rows are identical, only the time column changed. Use whichever you prefer, but do not mix the two files.",
      "",
      "The repeated hour on 2025-10-26 exists only in the local time file.",
      "",
      "Terveisin,",
      "Jarkko",
      "",
      "On Thu, 19 Feb 2026, Timo Heikkinen wrote:",
      "> xmeas_13 is the separator pressure in bar.",
      "> The export is in local time, I do not think we can change that.",
    ].join("\r\n"),
    "a11ce0-01",
  ),
);

write(
  "2026-02-19 UTC export and separator pressure unit.eml",
  eml(
    "a11ce0-01",
    ["Timo Heikkinen", "timo.heikkinen@saimaakemia.example"],
    "corpus+norrin@norrin.example",
    "UTC export and separator pressure unit",
    "Thu, 19 Feb 2026 15:48:02 +0200",
    [
      "Hi,",
      "",
      "Answers to your two questions.",
      "",
      "xmeas_13 is the separator pressure in bar.",
      "",
      "The export is in local time, I do not think we can change that. Jarkko may know more.",
      "",
      "Timo Heikkinen",
      "Production planner, Saimaa Kemia Oy",
    ].join("\r\n"),
  ),
);

write(
  "2026-03-24 Incident report P-302 trip 2026-02-27.md",
  [
    "# Incident report: stripper bottoms pump P-302 trip, 2026-02-27",
    "",
    "Author: Mikko Virtanen. Reviewed: Jarkko Rantanen. Classification: process upset, no release.",
    "",
    "## Sequence",
    "",
    "- 13:42 P-302 trips on seal flush low flow. FI-3017 (xmeas_17) falls from 22.8 to 0 m3/h in one sample.",
    "- 13:45 LI-3012 (xmeas_15) starts to rise at about 1.5 percent per minute.",
    "- 13:51 Operator closes the stripper steam valve FV-3009 (xmv_9) to 20 percent to slow the rise.",
    "- 14:03 LI-3012 high alarm at 85 percent.",
    "- 14:22 Seal flush line cleaned, P-302 restarted. FI-3017 back to 24 m3/h.",
    "- 15:10 LI-3012 back in the normal band. FV-3009 back to automatic.",
    "",
    "## Effect on the data",
    "",
    "Between 13:42 and 15:10 the stripper tags xmeas_15, xmeas_16, xmeas_17, xmeas_18 and xmeas_19 are outside their normal ranges. The reactor tags stay normal. Product component D (xmeas_37) rises to 0.72 mol percent at 14:30 and returns below 0.6 by 16:00, so one hour of product went to the off-spec tank.",
    "",
    "## Root cause",
    "",
    "The seal flush strainer of P-302 was blocked by scale from the closed loop cooling water. The same strainer caused the trip on 2026-01-21. A monthly strainer check is now on the maintenance plan.",
    "",
  ].join("\n"),
);

write(
  "alarm-list-extract-R101.csv",
  [
    "tag,model_name,alarm,limit,unit,priority,action",
    "PI-1011,xmeas_7,PAH,2895,kPa gauge,high,Open PV-2041 in manual and check compressor",
    "PI-1011,xmeas_7,PAHH,3000,kPa gauge,critical,Interlock closes FV-1001 FV-1002 FV-1003 FV-1004",
    "LI-1012,xmeas_8,LAL,50,%,medium,Check D feed FV-1001 and separator underflow",
    "LI-1012,xmeas_8,LAH,90,%,high,Reduce feeds",
    "TI-1013,xmeas_9,TAH,150,degC,critical,Interlock trips the reactor",
    "TI-1013,xmeas_9,TAH pre,128,degC,high,Open FV-1010 fully",
    "LI-2012,xmeas_12,LAL,30,%,medium,Check FV-2007",
    "LI-3012,xmeas_15,LAH,85,%,high,Check P-302 and FV-3008",
    "LI-3012,xmeas_15,LAL,20,%,medium,Check FV-3009 steam",
    "JI-2020,xmeas_20,JAH,360,kW,medium,Check PV-2041 for sticking and FV-2005 position",
    "TI-1021,xmeas_21,TAH,102,degC,medium,Plan coil cleaning",
    "AI-4037,xmeas_37,QAH,0.6,mol%,high,Divert product to off-spec tank",
  ].join("\n") + "\n",
);

write(
  "Loop check report R-101 2026-01.pdf",
  pdf([
    [
      "Saimaa Kemia Oy, Vuoksenranta plant, instrument department",
      "Loop check report, reactor line R-101, January 2026",
      "Checked by T. Koskinen, approved by J. Rantanen, 2026-01-30",
      "",
      "Loop      Model    Result                                Note",
      "PI-1011   xmeas_7  OK, 0.2 percent of span             Transmitter zero checked at 0 kPa",
      "LI-1012   xmeas_8  OK                                   Displacer cleaned, no drift found",
      "TI-1013   xmeas_9  Replaced 2026-01-14                 Old element read 2.1 degC low against reference",
      "FI-1001   xmeas_1  OK                                   Orifice plate inspected",
      "FI-2001   xmeas_10 Attention                            Reads 0.02 kscmh at zero flow, zero drift, adjust next outage",
      "TI-2011   xmeas_11 OK",
      "LI-2012   xmeas_12 OK",
      "PI-2013   xmeas_13 OK                                   kPa gauge, range 0 to 4000",
      "LI-3012   xmeas_15 OK                                   Noisy signal, 2 second damping added",
      "FI-3017   xmeas_17 OK                                   Magnetic flowmeter, empty pipe detection on",
      "JI-2020   xmeas_20 OK                                   Calculated from motor current and voltage",
    ],
    [
      "Valves",
      "",
      "Tag       Model    Result                                Note",
      "FV-1004   xmv_4    Positioner replaced 2026-01-09      Was in manual at 61 percent for six days",
      "PV-2041   xmv_6    Attention                            Stem friction high after purge line wash, sticks about one hour",
      "FV-2005   xmv_5    OK                                   Stroke test 0 to 100 percent in 12 seconds",
      "FV-3009   xmv_9    OK",
      "FV-1010   xmv_10   OK                                   At 68 percent, fouling trend visible since November",
      "",
      "Summary: 21 loops checked, 18 OK, 2 attention, 1 replaced. The purge valve PV-2041 needs",
      "a new positioner or a stem lubrication plan. The purge flow transmitter FI-2001 has a small",
      "zero drift that does not affect control.",
    ],
  ]),
);

write(
  "lab-sample-schedule.md",
  [
    "# Laboratory and analyzer schedule, R-101",
    "",
    "Owner: Sari Nieminen. Valid from 2026-01-01.",
    "",
    "| Analyzer | Model columns | Cycle | Calibration | Hold during calibration |",
    "| --- | --- | --- | --- | --- |",
    "| AI-1023 reactor feed GC | xmeas_23 to xmeas_28 | 6 min | first Monday of the month, 08:00 | about 20 min |",
    "| AI-2029 purge GC | xmeas_29 to xmeas_36 | 15 min | every Monday, 08:00 | about 20 min |",
    "| AI-4037 product GC | xmeas_37 to xmeas_41 | 15 min | every Thursday, 08:00 | about 20 min |",
    "",
    "Manual lab samples of the product go out at 06:00, 14:00 and 22:00. The lab result for component D is the reference for AI-4037. A difference above 0.05 mol percent triggers an analyzer check.",
    "",
    "During a calibration the historian keeps the last good value. A value that repeats for exactly 20 minutes on a Monday or Thursday morning is a calibration hold, not a fault.",
    "",
  ].join("\n"),
);

write(
  "2026-03-26 Saimaa Kemia drift review.vtt",
  vtt([
    ["00:00:02", "Anna Lehtinen", "Two items today. The compressor work and the reactor cooling. Mikko, you saw the compressor plot?"],
    ["00:00:10", "Mikko Virtanen", "Yes. Every Tuesday there is the bump in xmeas twenty, that is the purge valve stick after the wash. But since the third of March the bump is gone. We changed the stem lubrication and it seems to work."],
    ["00:00:30", "Anna Lehtinen", "So after third March a stuck xmv six is not expected any more."],
    ["00:00:35", "Mikko Virtanen", "Correct. If it sticks again, that is news to us."],
    ["00:00:41", "Jarkko Rantanen", "On the cooling side, FV-1010, that is xmv ten, is at eighty six percent today. Cleaning is booked for the twentieth of April. After the cleaning it drops to around forty percent and xmeas twenty one drops about eight degrees."],
    ["00:01:05", "Anna Lehtinen", "Good, so a step on twentieth April is planned maintenance. One more, is xmeas five the recycle flow?"],
    ["00:01:12", "Jarkko Rantanen", "Yes, FI-1005, recycle flow from the compressor to the reactor feed, in kscmh. It moves with xmv five, the recycle valve, and with the compressor work."],
    ["00:01:30", "Sari Nieminen", "And a lab note. The reactor feed GC, AI-1023, will get a new column on the sixth of April. Expect a level shift of maybe half a mole percent in xmeas twenty three to twenty eight after that day."],
  ]),
);

write(
  "Control narrative R-101 rev 4.md",
  [
    "# Control narrative, reactor line R-101, revision 4",
    "",
    "Saimaa Kemia Oy, Vuoksenranta. Approved 2025-11-03 by process control lead H. Aaltonen.",
    "",
    "## 1. Reactor pressure control",
    "",
    "PIC-1011 reads PI-1011 (xmeas_7) and writes to PV-2041 (xmv_6). Setpoint 2705 kPa gauge. The loop is PI with a 40 second integral time. A pressure above 2800 kPa opens the purge valve to at least 60 percent through a high select. The loop also has a feedforward from the reactor feed rate FI-1006 (xmeas_6).",
    "",
    "## 2. Reactor level control",
    "",
    "LIC-1012 reads LI-1012 (xmeas_8) and writes to FV-1001 (xmv_1), the D feed valve. Setpoint 75 percent. This is a slow loop with a 12 minute integral time. When the reactor level falls below 55 percent, the E feed FV-1002 (xmv_2) is cut back by a ratio block.",
    "",
    "## 3. Reactor temperature control",
    "",
    "TIC-1013 reads TI-1013 (xmeas_9) and writes to FV-1010 (xmv_10), the cooling water valve. Setpoint 120.4 degrees C. The cooling water outlet temperature TI-1021 (xmeas_21) is a monitored variable only. It is not in any loop, which is why the fouling trend shows up there first.",
    "",
    "## 4. Separator and compressor",
    "",
    "LIC-2012 reads LI-2012 (xmeas_12) and writes to FV-2007 (xmv_7). Compressor K-201 runs at fixed speed. The anti-surge controller writes to FV-2005 (xmv_5) from a computed flow margin. The recycle valve never closes below 12 percent. The condenser cooling water valve FV-2011 (xmv_11) holds the separator temperature TI-2011 (xmeas_11) at 80 degrees C.",
    "",
    "## 5. Stripper",
    "",
    "LIC-3012 reads LI-3012 (xmeas_15) and writes to FV-3008 (xmv_8), the liquid product valve. The steam valve FV-3009 (xmv_9) follows a ratio to the stripper feed. Operators may put FV-3009 in manual for a steam trap test. In manual the level loop alone cannot hold the level and a 40 minute oscillation follows.",
    "",
    "## 6. Composition control",
    "",
    "The product analyzer AI-4037 (xmeas_37 to xmeas_41) feeds a supervisory controller that trims the A feed FV-1003 (xmv_3) every 15 minutes. The purge analyzer AI-2029 has no closed loop. The feed analyzer AI-1023 is for monitoring only.",
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
    "Production of G and H was 96.2 percent of plan. Three events cost production time: the analyzer column change on 9 March (no loss, quality hold only), the closed loop cooling change on 1 March (four hours at reduced rate), and a feed limitation from the A supply on 22 to 24 March.",
    "",
    "## Quality",
    "",
    "Product component D (AI-4037, xmeas_37) stayed below 0.6 mol percent except for one hour on 27 February that fell in the February report. The March average was 0.42 mol percent.",
    "",
    "## Events with an effect on the data",
    "",
    "- 2026-03-01 08:00 to 12:00: reduced rate at 70 percent while the cooling water source changed. All flows (xmeas_1 to xmeas_6, xmeas_10) lower. xmeas_22 shifted down about 4 degrees C and stayed there.",
    "- 2026-03-09 08:00 to 08:45: purge GC calibration with column change. xmeas_29 to xmeas_36 held.",
    "- 2026-03-22 to 2026-03-24: A feed limited to 80 percent by the supplier. FI-1001 (xmeas_1) and FV-1003 (xmv_3) low, A in reactor feed (xmeas_23) about 3 mol percent lower than normal.",
    "- No purge valve sticking after 3 March. PV-2041 (xmv_6) behaved after the stem lubrication change.",
    "",
    "## Outlook",
    "",
    "Cooling coil cleaning on 20 April, planned 36 hours. Expect FV-1010 (xmv_10) to drop from about 88 to 40 percent and TI-1021 (xmeas_21) to drop about 8 degrees C after the restart.",
    "",
  ].join("\n"),
);

write(
  "2026-01-22 RE P-302 trip yesterday.eml",
  eml(
    "d00d1e-03",
    ["Mikko Virtanen", "mikko.virtanen@saimaakemia.example"],
    "Jarkko Rantanen <jarkko.rantanen@saimaakemia.example>, corpus+norrin@norrin.example",
    "RE: P-302 trip yesterday",
    "Thu, 22 Jan 2026 07:55:12 +0200",
    [
      "Morning,",
      "",
      "Yes, the trip at 10:14 yesterday was P-302 on high bearing temperature. The pump was down for 40 minutes. In the data you see FI-3017 (xmeas_17) go to zero, LI-3012 (xmeas_15) climb to 82 percent, and the steam valve FV-3009 pulled back by the operator.",
      "",
      "Not related to the strainer this time, the bearing was simply hot after the seal work in December. We greased it and it has been fine since.",
      "",
      "Mikko",
      "",
      "> Was that P-302 again yesterday around ten? The stripper level chart looks like the January event.",
      "> Jarkko",
    ].join("\r\n"),
    "d00d1e-02",
  ),
);

write(
  "2026-02-03 Historian question missing values.eml",
  eml(
    "beef01-01",
    ["Anna Lehtinen", "anna.lehtinen@norrin.example"],
    "Jarkko Rantanen <jarkko.rantanen@saimaakemia.example>",
    "Historian question: missing values in xmeas_10",
    "Tue, 03 Feb 2026 10:12:00 +0200",
    [
      "Hi Jarkko,",
      "",
      "We see about 2 percent empty cells in xmeas_10, the purge rate, spread over the whole period, and almost none in the other flows. Is that a known thing?",
      "",
      "Anna",
    ].join("\r\n"),
  ),
);

write(
  "2026-02-03 RE Historian question missing values.eml",
  eml(
    "beef01-02",
    ["Jarkko Rantanen", "jarkko.rantanen@saimaakemia.example"],
    "Anna Lehtinen <anna.lehtinen@norrin.example>, corpus+norrin@norrin.example",
    "RE: Historian question: missing values in xmeas_10",
    "Tue, 03 Feb 2026 13:40:27 +0200",
    [
      "Hi Anna,",
      "",
      "Yes. FI-2001 (xmeas_10) is a thermal mass flow meter on the purge line and it drops out for a few seconds when the purge valve moves fast. The DCS marks those samples as bad quality and the export leaves the cell empty. It is not a process event. If you need a filled series, hold the last value, that is what the operators see anyway.",
      "",
      "The same meter also has the small zero offset from the loop check, 0.02 kscmh at no flow.",
      "",
      "Jarkko",
    ].join("\r\n"),
    "beef01-01",
  ),
);

write(
  "Turvallisuustiedote 2026-02 R-101.md",
  [
    "# Turvallisuustiedote, reaktorilinja R-101, helmikuu 2026",
    "",
    "Saimaa Kemia Oy, Vuoksenrannan tehdas. Laatija: käyttöpäällikkö R. Hakala.",
    "",
    "## Painehälytykset tammikuussa",
    "",
    "Reaktorin paine PI-1011 (xmeas_7) ylitti hälytysrajan 2895 kPa kaksi kertaa tammikuussa, molemmat 13. tammikuuta poistoventtiilin PV-2041 (xmv_6) jumituttua pesun jälkeen. Lukitusraja 3000 kPa ei ylittynyt. Kompressorin teho JI-2020 (xmeas_20) nousi samalla 352 kilowattiin.",
    "",
    "## Toimenpiteet",
    "",
    "Poistoventtiilin karan voitelu lisätään viikoittaiseen pesuohjelmaan. Uusi asennoitin on tilattu. Operaattorit tarkistavat venttiilin asennon manuaalisesti pesun jälkeen kunnes asennoitin on vaihdettu.",
    "",
    "## Muistutus",
    "",
    "Strippauskolonnin höyryventtiili FV-3009 (xmv_9) palautetaan automaatille heti höyrylukkotestin jälkeen. Manuaalilla pinta LI-3012 (xmeas_15) alkaa heilua noin 40 minuutin jaksolla.",
    "",
  ].join("\n"),
);

write(
  "Operator training R-101 module 3 notes.txt",
  [
    "OPERATOR TRAINING, R-101, MODULE 3: READING THE TRENDS",
    "Trainer notes, H. Aaltonen, 2025-09",
    "",
    "Slide 1. The three reactor loops. Pressure PIC-1011 to purge valve PV-2041. Level LIC-1012 to D feed FV-1001. Temperature TIC-1013 to cooling water FV-1010.",
    "",
    "Slide 2. What a sticking purge valve looks like. The valve position xmv_6 goes flat. Pressure xmeas_7 drifts up a few kPa. Compressor power xmeas_20 climbs 5 to 15 kW. Purge rate xmeas_10 falls. Fix: tap the positioner, or switch to manual and stroke the valve.",
    "",
    "Slide 3. What coil fouling looks like. Over weeks, the cooling water valve xmv_10 opens more and more for the same temperature. The outlet temperature xmeas_21 climbs. When the valve is near 90 percent, call maintenance for the coil cleaning.",
    "",
    "Slide 4. What a P-302 trip looks like. Underflow xmeas_17 goes to zero in one sample. Stripper level xmeas_15 climbs fast. Close the steam valve FV-3009 to 20 percent, restart the pump, then return the steam valve to auto.",
    "",
    "Slide 5. Analyzer holds are not faults. A flat composition trace for 20 minutes on Monday or Thursday morning is a calibration. A flat trace at any other time for more than 30 minutes is an analyzer fault, call the lab.",
    "",
    "Slide 6. Units. Pressures in kPa gauge, not bar. 100 kPa is one bar. Temperatures in degrees C. Levels in percent.",
    "",
  ].join("\n"),
);

write(
  "instrument-calibration-log-2025-2026.csv",
  [
    "date,tag,model_name,instrument,as_found_error,as_left_error,unit,technician,note",
    "2025-11-04,PI-1011,xmeas_7,Rosemount 3051,-3.1,0.4,kPa,T. Koskinen,annual",
    "2025-11-04,PI-2013,xmeas_13,Rosemount 3051,-1.8,0.2,kPa,T. Koskinen,annual",
    "2025-11-05,TI-1013,xmeas_9,type K thermocouple,-1.6,-1.6,degC,T. Koskinen,left as found; replacement ordered",
    "2025-11-05,TI-1021,xmeas_21,Pt100,0.3,0.1,degC,T. Koskinen,annual",
    "2025-11-06,LI-1012,xmeas_8,displacer,1.2,0.3,%,P. Salo,annual",
    "2025-11-06,LI-3012,xmeas_15,dp cell,-0.8,0.2,%,P. Salo,annual",
    "2026-01-14,TI-1013,xmeas_9,type K thermocouple,-2.1,0.1,degC,T. Koskinen,element replaced",
    "2026-01-30,FI-2001,xmeas_10,thermal mass,0.02,0.02,kscmh,T. Koskinen,zero offset at no flow left as found",
    "2026-03-09,AI-2029,xmeas_29,GC,n/a,n/a,mol%,S. Nieminen,column replaced",
  ].join("\n") + "\n",
);

console.log(`\n${out}`);
