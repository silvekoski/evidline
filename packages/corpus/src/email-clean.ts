const quoteStarts = [
  /^-{2,}\s*(Original Message|Alkuperäinen viesti|Forwarded message|Välitetty viesti)\s*-{2,}/i,
  /^(On|Le|Am)\s.+\s(wrote|a écrit|schrieb):\s*$/i,
  /^.+\s+kirjoitti( klo .+)?:\s*$/i,
  /^(From|Lähettäjä|Von|De):\s.+$/i,
  /^_{5,}\s*$/,
];
const signatureStarts = [
  /^--\s*$/,
  /^(Best regards|Kind regards|Regards|Br|BR|Thanks|Cheers|Ystävällisin terveisin|Terveisin|Yst\. terv\.|Mit freundlichen Grüßen),?\s*$/i,
  /^Sent from my (iPhone|iPad|Android|Galaxy)/i,
  /^Lähetetty (iPhonesta|iPadista|Outlook)/i,
];

export function stripQuotedReplies(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith(">")) break;
    if (quoteStarts.some((re) => re.test(line.trim()))) break;
    kept.push(line);
  }
  const cut = kept.findIndex((line) => signatureStarts.some((re) => re.test(line.trim())));
  return (cut >= 0 ? kept.slice(0, cut) : kept).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
