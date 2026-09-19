export const countTokens = (text: string): number => Math.ceil(text.length / 4);

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$|[^.!?\n]+\n+/g) ?? [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

export const normalizeText = (text: string): string => text.toLowerCase().normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
