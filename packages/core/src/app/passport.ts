import { fileBase } from "../domain/hierarchy";
import type { ContentEntry, CrapSummary, EdgeKind, Member, NodeID } from "../domain/model";
import type { Scene } from "../layout/layout";
import type { SourceIdent } from "./source";

/**
 * The class card for the side panel (umlviewer `Detail.swift`, Clojure
 * `uml-viewer.application.detail`): who a class is, its metrics table, its
 * fields and its relationships, with umlviewer's wording and number
 * formats. umlviewer laid the card out on a canvas; umlify renders this
 * model as HTML.
 */

/** Java's `String.format("%.nf")`: half away from zero on the shortest decimal form, like the Swift port. */
export function javaFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return String(x);
  const s = String(Math.abs(x));
  if (s.includes("e")) return x.toFixed(digits);
  const [int = "0", frac = ""] = s.split(".");
  let n = BigInt(int + frac.padEnd(digits, "0").slice(0, digits));
  if ((frac[digits] ?? "0") >= "5") n += 1n;
  const t = n.toString().padStart(digits + 1, "0");
  const text = digits > 0 ? `${t.slice(0, -digits)}.${t.slice(-digits)}` : t;
  return x < 0 && n !== 0n ? `-${text}` : text;
}

export function formatCrap(crap: CrapSummary | undefined): string | undefined {
  if (crap?.mu === undefined) return undefined;
  return `Crap μ ${javaFixed(crap.mu, 1)}   max ${javaFixed(crap.max ?? crap.mu, 1)}   σ ${javaFixed(crap.sigma ?? 0, 1)}`;
}

export function formatCoverage(p: number | undefined): string | undefined {
  return p === undefined ? undefined : `${javaFixed(100 * p, 0)}%`;
}

const PHRASES: Record<string, [string, string]> = {
  inheritance: ["extends", "extended by"],
  implements: ["implements", "implemented by"],
  association: ["associates with", "associated from"],
  dependency: ["depends on", "used by"],
  aggregation: ["aggregates", "aggregated by"],
  composition: ["composes", "composed in"],
};

export function phrase(kind: EdgeKind, outgoing: boolean): string {
  const [out, back] = PHRASES[kind] ?? ["to", "from"];
  return outgoing ? out : back;
}

/** One line of the metrics table: the class (pooled) or one of its functions. */
export interface StatsRow {
  label: string;
  /** The op's name, for opening its source. */
  name?: string;
  isPrivate: boolean;
  crap?: string;
  crapValue?: number;
  cc?: string;
  coverage?: string;
  coverageValue?: number;
  killed?: number;
  survived?: number;
  uncovered?: number;
  /** No mutation operators apply: umlviewer shows `---no mutation sites---`. */
  noSites: boolean;
}

export interface PassportRel {
  id: NodeID;
  name: string;
  kind: EdgeKind;
  label?: string;
  outgoing: boolean;
  phrase: string;
  violating: boolean;
}

export interface Passport {
  id: NodeID;
  name: string;
  oval: boolean;
  level?: number;
  stereotype?: string;
  /** The namespace, or a Rust file's name. */
  module?: string;
  packageLabel?: string;
  viewTitle: string;
  crapLine?: string;
  stats?: { cls: StatsRow; ops: StatsRow[] };
  fields: string[];
  rels: PassportRel[];
  /** Children of a folder box. */
  children: ContentEntry[];
  drill: boolean;
  source: SourceIdent;
}

interface RowMetrics {
  classRow: boolean;
  crapMu?: number;
  cc?: number;
  coverage?: number;
  killed?: number;
  survived?: number;
  uncovered?: number;
  sites?: number;
}

function statsRow(label: string, m: RowMetrics, op?: Member): StatsRow {
  const counted = (m.killed ?? 0) + (m.survived ?? 0) + (m.uncovered ?? 0);
  const noSites = counted > 0 ? false : m.sites === undefined || m.sites === 0;
  return {
    label,
    name: op?.name,
    isPrivate: op?.isPrivate ?? false,
    crap: m.crapMu === undefined ? undefined : javaFixed(m.crapMu, 1) + (m.classRow ? "μ" : ""),
    crapValue: m.crapMu,
    // `(str (long cc))` truncates toward zero.
    cc: m.classRow || m.cc === undefined ? undefined : String(Math.trunc(m.cc)),
    coverage: formatCoverage(m.coverage),
    coverageValue: m.coverage,
    killed: noSites ? undefined : m.killed,
    survived: noSites ? undefined : m.survived,
    uncovered: noSites ? undefined : m.uncovered,
    noSites,
  };
}

/** Summed over ops, or undefined when no op has the count. */
function sum(ops: Member[], key: (m: Member) => number | undefined): number | undefined {
  return ops.some((o) => key(o) !== undefined) ? ops.reduce((a, o) => a + (key(o) ?? 0), 0) : undefined;
}

const scoreOf = (m: Member) => (typeof m.crap === "number" ? m.crap : m.crap?.mu);

/** The card for `id` in `scene`, or undefined when the scene has no such box. */
export function passportOf(scene: Scene, id: NodeID): Passport | undefined {
  const node = scene.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  const c = node.cls;
  const titleOf = (other: NodeID) => scene.nodes.find((n) => n.id === other)?.card.title ?? other;
  const rels = scene.edges
    .filter((e) => e.from === id || e.to === id)
    .map((e): PassportRel => {
      const outgoing = e.from === id;
      const other = outgoing ? e.to : e.from;
      return { id: other, name: titleOf(other), kind: e.kind, label: e.label, outgoing, phrase: phrase(e.kind, outgoing), violating: e.violating };
    });
  const rustFile = fileBase(c.file);
  const module = rustFile && !c.drill && rustFile.toLowerCase().endsWith(".rs") ? rustFile : c.ns;
  const hasStats = c.ops.length > 0 || c.crap?.mu !== undefined || c.coverage !== undefined || c.cc !== undefined || c.killed !== undefined || c.survived !== undefined;
  return {
    id,
    name: node.card.title,
    oval: node.kind === "oval",
    level: c.level,
    stereotype: c.stereotype,
    module,
    packageLabel: scene.packages.find((p) => p.id === node.package)?.label ?? node.package,
    viewTitle: scene.title,
    crapLine: formatCrap(c.crap),
    stats: hasStats
      ? {
          cls: statsRow(node.card.title, {
            classRow: true,
            crapMu: c.crap?.mu,
            coverage: c.coverage,
            killed: c.killed ?? sum(c.ops, (o) => o.killed),
            survived: c.survived ?? sum(c.ops, (o) => o.survived),
            uncovered: c.uncovered ?? sum(c.ops, (o) => o.uncovered),
            sites: c.sites ?? sum(c.ops, (o) => o.sites),
          }),
          ops: c.ops.map((op) =>
            statsRow(
              `${op.isPrivate ? "- " : "+ "}${op.text ?? ""}`,
              { classRow: false, crapMu: scoreOf(op), cc: op.cc, coverage: op.coverage, killed: op.killed, survived: op.survived, uncovered: op.uncovered, sites: op.sites },
              op,
            ),
          ),
        }
      : undefined,
    fields: c.fields.map((f) => f.text ?? f.name ?? ""),
    rels,
    children: c.contents,
    drill: c.drill,
    source: { ns: c.ns, lang: c.lang, file: c.file },
  };
}
