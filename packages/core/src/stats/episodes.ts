import type { Window } from "@tpm/schemas";

export type Span = { from: number; to: number };

export function spans(n: number, episodes?: Window[]): Span[] {
  return episodes && episodes.length > 0 ? episodes : [{ from: 0, to: n }];
}

export function scaleSpans(sp: Span[], bucket: number): Span[] {
  return sp.map(({ from, to }) => ({ from: Math.round(from / bucket), to: Math.round(to / bucket) }));
}
