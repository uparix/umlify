import type { DiagramClass, Member } from "../domain/model";
import { textWidth, wrapText } from "./measure";

/**
 * What a box shows and how big it is, with archify's class-card metrics
 * (renderers/class): a header with the name (and a «stereotype» line), then
 * compartments of 20px rows set in 11px mono, 180–300px wide.
 */

export const CARD = {
  padX: 12,
  headerH: 44,
  headerPlainH: 34,
  nameFont: 13.5,
  stereotypeFont: 9.5,
  rowFont: 11,
  rowH: 20,
  compartmentPad: 5,
  badgePorch: 24,
  minW: 180,
  maxW: 300,
  ovalH: 36,
  ovalPadX: 18,
  ovalMinW: 96,
  ovalFont: 12,
} as const;

/** Room archify keeps for the visibility chip next to a member. */
const ROW_EXTRA = 8;

export type RowKind = "child" | "field" | "op" | "in-port" | "out-port";

export interface CardRow {
  kind: RowKind;
  /** The full text; `lines` is it wrapped to the card. */
  text: string;
  lines: string[];
  /** A child box or the outside node a port leads to. */
  target?: string;
  /** A child that is itself a folder. */
  drill?: boolean;
  /** The member, for ops and fields. */
  member?: Member;
}

export interface Compartment {
  kind: "contents" | "members" | "ports";
  rows: CardRow[];
}

export interface Card {
  title: string;
  /** `«interface»` and the like; absent for a plain class. */
  stereotype?: string;
  /** Anything but a plain class is titled in italics (umlviewer). */
  italic: boolean;
  headerH: number;
  compartments: Compartment[];
  width: number;
  height: number;
}

export function memberText(m: Member): string {
  return m.text ?? m.name ?? "";
}

function rowsOf(c: DiagramClass): Compartment[] {
  const out: Compartment[] = [];
  if (c.contents.length > 0) {
    out.push({
      kind: "contents",
      rows: c.contents.map((e) => ({ kind: "child", text: e.drill ? `${e.name}/` : e.name, lines: [], target: e.id, drill: e.drill })),
    });
  }
  if (!c.hideMembers) {
    // Private ops are only on the class card in the side panel (umlviewer).
    const members: CardRow[] = [
      ...c.fields.map((m): CardRow => ({ kind: "field", text: memberText(m), lines: [], member: m })),
      ...c.ops.filter((m) => !m.isPrivate).map((m): CardRow => ({ kind: "op", text: memberText(m), lines: [], member: m })),
    ];
    if (members.length > 0) out.push({ kind: "members", rows: members });
  }
  const ports: CardRow[] = [
    ...c.inDeps.map((p): CardRow => ({ kind: "in-port", text: `← ${p.name ?? p.id}`, lines: [], target: p.id })),
    ...c.outDeps.map((p): CardRow => ({ kind: "out-port", text: `→ ${p.name ?? p.id}`, lines: [], target: p.id })),
  ];
  if (ports.length > 0) out.push({ kind: "ports", rows: ports });
  return out;
}

const isOval = (c: DiagramClass) => c.foreign || c.shape === "oval";

export function measureCard(c: DiagramClass, title: string): Card {
  if (isOval(c)) {
    const width = Math.ceil(Math.max(CARD.ovalMinW, textWidth(title, CARD.ovalFont) + CARD.ovalPadX * 2));
    return { title, italic: false, headerH: CARD.ovalH, compartments: [], width, height: CARD.ovalH };
  }
  const stereotype = c.stereotype && c.stereotype !== "class" ? `«${c.stereotype}»` : undefined;
  const headerH = stereotype ? CARD.headerH : CARD.headerPlainH;
  const headerW =
    CARD.padX * 2 +
    CARD.badgePorch * 2 +
    Math.max(textWidth(title, CARD.nameFont) * 1.08, stereotype ? textWidth(stereotype, CARD.stereotypeFont) : 0);
  const compartments = rowsOf(c);
  const widest = Math.max(0, ...compartments.flatMap((k) => k.rows.map((r) => textWidth(r.text, CARD.rowFont))));
  const wanted = widest + CARD.padX * 2 + ROW_EXTRA;
  const width = Math.ceil(Math.max(headerW, Math.min(CARD.maxW, Math.max(CARD.minW, wanted))));
  const unitsPerLine = (width - CARD.padX * 2 - ROW_EXTRA) / (CARD.rowFont * 0.6);
  for (const k of compartments) for (const r of k.rows) r.lines = wrapText(r.text, unitsPerLine);
  const height =
    headerH + compartments.reduce((h, k) => h + k.rows.reduce((n, r) => n + r.lines.length, 0) * CARD.rowH + CARD.compartmentPad * 2, 0);
  return { title, stereotype, italic: stereotype !== undefined, headerH, compartments, width, height };
}
