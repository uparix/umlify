import { CARD, type CardRow, type Scene, type SceneEdge, type SceneFrame, type SceneNode } from "@umlify/core";
import { gradeColor, gradesOf, NEUTRAL } from "./grade";

/**
 * A scene as SVG markup in archify's class-diagram idiom (renderers/class):
 * opaque cards stroked in one hue, a tinted header with a cap line and a
 * lettered badge, ruled compartments with zebra rows, and UML markers per
 * relationship kind. Pure: strings in, string out.
 */

export interface RenderOptions {
  /** Colour boxes by grade; off when the document has no metrics at all. */
  graded: boolean;
}

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (x: number) => Math.round(x * 100) / 100;

// ---------- relationship notation (archify NOTATION/GLYPH) ----------

interface Notation {
  dashed: boolean;
  start?: Glyph;
  end?: Glyph;
}

type Glyph = "open" | "triangle" | "diamond-filled" | "diamond-hollow";

/** umlviewer edge kinds onto archify's notation; `implements` is UML realization. */
const NOTATION: Record<string, Notation> = {
  dependency: { dashed: true, end: "open" },
  association: { dashed: false, end: "open" },
  inheritance: { dashed: false, end: "triangle" },
  implements: { dashed: true, end: "triangle" },
  composition: { dashed: false, start: "diamond-filled" },
  aggregation: { dashed: false, start: "diamond-hollow" },
};

export const notationOf = (kind: string): Notation => NOTATION[kind] ?? (NOTATION.association as Notation);

const GLYPH: Record<Glyph, { w: number; h: number; refX: number; refY: number; body: string }> = {
  open: { w: 12, h: 12, refX: 11, refY: 6, body: '<path d="M 1 1 L 11 6 L 1 11" fill="none"/>' },
  triangle: { w: 16, h: 16, refX: 15, refY: 8, body: '<path d="M 1 1.5 L 15 8 L 1 14.5 Z" class="u-marker-hollow"/>' },
  "diamond-filled": { w: 20, h: 12, refX: 1, refY: 6, body: '<path d="M 1 6 L 10 1 L 19 6 L 10 11 Z" class="u-marker-filled"/>' },
  "diamond-hollow": { w: 20, h: 12, refX: 1, refY: 6, body: '<path d="M 1 6 L 10 1 L 19 6 L 10 11 Z" class="u-marker-hollow"/>' },
};

/** Marker id for a glyph; violations get a red copy, as SVG markers do not inherit the stroke. */
const markerID = (g: Glyph, violating: boolean) => `u-${g}${violating ? "-v" : ""}`;

function markerDefs(): string {
  return (Object.keys(GLYPH) as Glyph[])
    .flatMap((g) =>
      [false, true].map((v) => {
        const m = GLYPH[g];
        return `<marker id="${markerID(g, v)}" markerWidth="${m.w}" markerHeight="${m.h}" refX="${m.refX}" refY="${m.refY}" orient="auto" markerUnits="userSpaceOnUse" class="u-marker${v ? " u-violating" : ""}" stroke-width="1.5" stroke-linejoin="round">${m.body}</marker>`;
      }),
    )
    .join("");
}

// ---------- edges ----------

function renderEdge(e: SceneEdge): string {
  const nt = notationOf(e.kind);
  const markers = [
    nt.start ? `marker-start="url(#${markerID(nt.start, e.violating)})"` : "",
    nt.end ? `marker-end="url(#${markerID(nt.end, e.violating)})"` : "",
  ].join(" ");
  const cls = ["u-edge", nt.dashed ? "u-dashed" : "", e.violating ? "u-violating" : ""].filter(Boolean).join(" ");
  return `<g data-edge-id="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${esc(e.kind)}"${e.violating ? ' data-violating=""' : ""}>
<path class="u-edge-hit" d="${e.d}"/>
<path class="${cls}" d="${e.d}" ${markers}/>
</g>`;
}

// ---------- boxes ----------

const BADGE = 16;

/** The badge letter: the stereotype's (I for interface, α for abstract), else the level. */
function badgeText(node: SceneNode): string | undefined {
  const st = node.cls.stereotype;
  if (st === "interface") return "I";
  if (st === "abstract") return "α";
  if (st && st !== "class") return st[0]?.toUpperCase();
  return node.cls.level === undefined ? undefined : String(node.cls.level);
}

function rowClass(r: CardRow): string {
  return `u-row u-row-${r.kind}${r.drill ? " u-drill" : ""}`;
}

/** `name(args) : Type` with muted punctuation and type, as archify sets members. */
function memberSpans(text: string): string {
  const colon = text.indexOf(" : ");
  const head = colon >= 0 ? text.slice(0, colon) : text;
  const tail = colon >= 0 ? `<tspan class="u-muted"> : ${esc(text.slice(colon + 3))}</tspan>` : "";
  return esc(head).replace(/[(),]/g, (m) => `<tspan class="u-punct">${m}</tspan>`) + tail;
}

function renderRows(node: SceneNode): string {
  let top = node.y + node.card.headerH;
  let stripe = 0;
  return node.card.compartments
    .map((k) => {
      const parts = [`<line class="u-rule" x1="${n(node.x)}" y1="${n(top)}" x2="${n(node.x + node.width)}" y2="${n(top)}"/>`];
      let line = 0;
      for (const r of k.rows) {
        const rowTop = top + CARD.compartmentPad + line * CARD.rowH;
        if (stripe++ % 2) {
          parts.push(`<rect class="u-zebra" x="${n(node.x + 4)}" y="${n(rowTop + 1)}" width="${n(node.width - 8)}" height="${r.lines.length * CARD.rowH - 2}" rx="4"/>`);
        }
        const target = r.target ? ` data-target="${esc(r.target)}"` : "";
        const texts = r.lines.map((l, i) => {
          const baseline = top + CARD.compartmentPad + (line + i + 1) * CARD.rowH - 5;
          const body = r.kind === "op" || r.kind === "field" ? memberSpans(l) : esc(l);
          return `<text x="${n(node.x + CARD.padX)}" y="${n(baseline)}">${body}</text>`;
        });
        parts.push(`<g class="${rowClass(r)}"${target}>${texts.join("")}</g>`);
        line += r.lines.length;
      }
      top += line * CARD.rowH + CARD.compartmentPad * 2;
      return `<g class="u-compartment" data-compartment="${k.kind}">${parts.join("")}</g>`;
    })
    .join("");
}

/** Arrows into and out of one box, for the triangles declutter mode. */
interface Counts {
  in: SceneEdge[];
  out: SceneEdge[];
}

function countsOf(scene: Scene): Map<string, Counts> {
  const m = new Map<string, Counts>(scene.nodes.map((nd) => [nd.id, { in: [], out: [] }]));
  for (const e of scene.edges) {
    m.get(e.to)?.in.push(e);
    m.get(e.from)?.out.push(e);
  }
  return m;
}

/**
 * With arrows hidden, a chip on the top edge counts incoming dependencies
 * and one on the bottom edge outgoing ones; red when any of them violates.
 */
function renderCounts(node: SceneNode, c: Counts | undefined): string {
  if (!c) return "";
  const chip = (edges: SceneEdge[], incoming: boolean): string => {
    if (edges.length === 0) return "";
    const text = `${incoming ? "▲" : "▼"} ${edges.length}`;
    const w = 14 + text.length * 6.6;
    const cx = node.x + node.width / 2 + (incoming ? -w / 2 - 3 : w / 2 + 3);
    const cy = incoming ? node.y : node.y + node.height;
    const names = edges.map((e) => (incoming ? e.from : e.to)).join(", ");
    const bad = edges.some((e) => e.violating) ? " u-violating" : "";
    return `<g class="u-count${bad}" data-count="${incoming ? "in" : "out"}"><title>${incoming ? "Used by" : "Depends on"}: ${esc(names)}</title><rect x="${n(cx - w / 2)}" y="${n(cy - 8)}" width="${n(w)}" height="16" rx="8"/><text x="${n(cx)}" y="${n(cy + 3.5)}">${text}</text></g>`;
  };
  return chip(c.in, true) + chip(c.out, false);
}

function renderBox(node: SceneNode, opts: RenderOptions, counts?: Counts): string {
  const { x, y, width: w, height: h } = node;
  const g = gradesOf(node.cls);
  const hue = opts.graded ? gradeColor(g.combined) : NEUTRAL;
  const r = 8;
  const head = node.card.headerH;
  const cx = x + w / 2;
  const badge = badgeText(node);
  const nameY = node.card.stereotype ? y + 34 : y + 22;
  const dots = opts.graded
    ? `<g class="u-dots" aria-hidden="true"><circle cx="${n(x + w - CARD.padX - 15)}" cy="${n(y + 17)}" r="4" style="fill:${gradeColor(g.crap)}"/><circle cx="${n(x + w - CARD.padX - 4)}" cy="${n(y + 17)}" r="4" style="fill:${gradeColor(g.mutation)}"/></g>`
    : "";
  return `<g data-node-id="${esc(node.id)}" class="u-node u-box${node.cls.drill ? " u-drillable" : ""}" style="--u-hue:${hue}" tabindex="-1">
<title>${esc(node.card.title)}</title>
<rect class="u-mask" x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" rx="${r}"/>
<rect class="u-card" x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" rx="${r}"/>
<path class="u-header" d="M ${n(x + r)} ${n(y)} H ${n(x + w - r)} A ${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)} V ${n(y + head)} H ${n(x)} V ${n(y + r)} A ${r} ${r} 0 0 1 ${n(x + r)} ${n(y)} Z"/>
<path class="u-cap" d="M ${n(x + 12)} ${n(y + 1.4)} H ${n(x + w - 12)}"/>
${badge ? `<g class="u-badge" aria-hidden="true"><rect x="${n(x + CARD.padX)}" y="${n(y + (node.card.stereotype ? 14 : 9))}" width="${BADGE}" height="${BADGE}" rx="4.8"/><text x="${n(x + CARD.padX + BADGE / 2)}" y="${n(y + (node.card.stereotype ? 14 : 9) + BADGE / 2 + 3.5)}">${esc(badge)}</text></g>` : ""}
${dots}
${node.card.stereotype ? `<text class="u-stereotype" x="${n(cx)}" y="${n(y + 16)}">${esc(node.card.stereotype)}</text>` : ""}
<text class="u-name${node.card.italic ? " u-italic" : ""}" x="${n(cx)}" y="${n(nameY)}">${esc(node.card.title)}</text>
${renderRows(node)}
${renderCounts(node, counts)}
</g>`;
}

function renderOval(node: SceneNode): string {
  const { x, y, width: w, height: h } = node;
  return `<g data-node-id="${esc(node.id)}" class="u-node u-oval" tabindex="-1">
<title>${esc(node.card.title)} (library)</title>
<rect class="u-mask" x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" rx="${h / 2}"/>
<rect class="u-oval-shape" x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" rx="${h / 2}"/>
<text class="u-oval-name" x="${n(x + w / 2)}" y="${n(y + h / 2 + 4)}">${esc(node.card.title)}</text>
</g>`;
}

function renderFrame(f: SceneFrame): string {
  return `<g class="u-frame" data-frame-id="${esc(f.id)}">
<rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.width)}" height="${n(f.height)}" rx="12"/>
<text x="${n(f.x + 14)}" y="${n(f.y + 18)}">${esc(f.label)}</text>
</g>`;
}

/** The whole scene: frames, then edges under the boxes (archify z-order), then boxes. */
export function renderScene(scene: Scene, opts: RenderOptions): string {
  const counts = scene.hideEdges ? countsOf(scene) : undefined;
  return `<defs>${markerDefs()}</defs>
<g class="u-frames">${scene.frames.map(renderFrame).join("")}</g>
<g class="u-edges"${scene.hideEdges ? " hidden" : ""}>${scene.edges.map(renderEdge).join("")}</g>
<g class="u-nodes">${scene.nodes.map((nd) => (nd.kind === "oval" ? renderOval(nd) : renderBox(nd, opts, counts?.get(nd.id)))).join("")}</g>`;
}
