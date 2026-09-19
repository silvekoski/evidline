import { FaultClass, faultLabel, type Evidence, type ProseValidation } from "@tpm/schemas";
import { aliasToken, escapeRegExp, evidenceIdToken, numberToken, significantDigits } from "./tokens";

const anyLabel = new RegExp(
  FaultClass.options
    .map(faultLabel)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|"),
  "gi",
);

export function validateProse(
  sentences: { text: string; evidenceIds: string[] }[],
  ctx: { evidence: Evidence[]; aliases: string[]; faultClass: FaultClass },
): ProseValidation {
  const errors: string[] = [];
  const byId = new Map(ctx.evidence.map((e) => [e.id, e]));
  const aliases = new Set(ctx.aliases);
  sentences.forEach(({ text, evidenceIds }, i) => {
    const at = `sentence ${i + 1}`;
    const cited = evidenceIds.map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);
    if (evidenceIds.length === 0) errors.push(`${at} cites no evidence`);
    for (const id of evidenceIds) if (!byId.has(id)) errors.push(`${at} cites the unknown evidence id ${id}`);
    for (const a of text.match(aliasToken) ?? []) if (!aliases.has(a)) errors.push(`${at} names the unknown alias ${a}`);
    const values = cited.flatMap((e) => [...Object.values(e.stats), e.window.from, e.window.to, e.window.n]);
    for (const token of text.replace(evidenceIdToken, " ").replace(aliasToken, " ").match(numberToken) ?? []) {
      const digits = significantDigits(token);
      const target = Number(Number(token).toPrecision(digits));
      if (!values.some((v) => Number(v.toPrecision(digits)) === target)) {
        errors.push(`${at} has the number ${token} that is not in the cited evidence`);
      }
    }
  });
  const labels =
    sentences
      .map((s) => s.text)
      .join("\n")
      .match(anyLabel) ?? [];
  const expected = faultLabel(ctx.faultClass);
  const own = labels.filter((l) => l.toLowerCase() === expected.toLowerCase()).length;
  if (own !== 1) errors.push(`the fault label "${expected}" appears ${own} times, expected once`);
  for (const l of labels) if (l.toLowerCase() !== expected.toLowerCase()) errors.push(`the text names the wrong fault label "${l}"`);
  return { pass: errors.length === 0, errors, sentences };
}
