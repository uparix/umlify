/**
 * Text measurement without a DOM, as archify does it: every character is one
 * unit of 0.6em (JetBrains Mono's advance) and a wide glyph is two. The
 * result is the same in Node and every browser, so layout is deterministic.
 */

const WIDTH_FACTOR = 0.6;
const FULLWIDTH = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/** Text units: one per character, two for a wide glyph (archify `textUnits`). */
export function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xfe00 && cp <= 0xfe0f) continue; // variation selectors
    units += FULLWIDTH.test(ch) ? 2 : 1;
  }
  return units;
}

export function textWidth(text: string, fontSize: number): number {
  return textUnits(text) * fontSize * WIDTH_FACTOR;
}

/**
 * Greedy wrap to `maxUnits` per line, breaking after a space, comma or
 * opening parenthesis when one is near, else mid-word. Continuation lines
 * are indented by two spaces, as archify sets wrapped members.
 */
export function wrapText(text: string, maxUnits: number): string[] {
  const limit = Math.max(8, Math.floor(maxUnits));
  const lines: string[] = [];
  let rest = text;
  let indent = "";
  while (textUnits(indent + rest) > limit) {
    const room = limit - indent.length;
    let cut = -1;
    for (let i = Math.min(rest.length - 1, room - 1); i >= Math.floor(room / 2); i--) {
      if (" ,(".includes(rest[i] as string)) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = room;
    lines.push(indent + rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    indent = "  ";
  }
  lines.push(indent + rest);
  return lines;
}
