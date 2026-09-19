export const MAX_TEXT_CHARS = 8000;
export const MAX_NUMERIC_SHARE = 0.3;

const numeric = /^[-+(]?\d[\d.,:%/eE+-]*\)?$/;

export type TextGuardResult = { pass: boolean; detail: string };

export function numericShare(text: string): number {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  return tokens.filter((t) => numeric.test(t)).length / tokens.length;
}

export function textGuard(texts: string[]): TextGuardResult {
  for (const [i, text] of texts.entries()) {
    if (text.length > MAX_TEXT_CHARS) return { pass: false, detail: `text ${i} has ${text.length} characters, the limit is ${MAX_TEXT_CHARS}` };
    const share = numericShare(text);
    if (share > MAX_NUMERIC_SHARE) return { pass: false, detail: `text ${i} is ${Math.round(share * 100)}% numbers, the limit is ${MAX_NUMERIC_SHARE * 100}%` };
  }
  return { pass: true, detail: `${texts.length} texts, all under ${MAX_TEXT_CHARS} characters and ${MAX_NUMERIC_SHARE * 100}% numbers` };
}
