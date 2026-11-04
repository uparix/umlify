import { groupBy, mapOrder } from "../edn/clojure-hash";
import { readEDN } from "../edn/reader";
import { asMap, get, integer, items, num, text, type EDN } from "../edn/value";
import { diagramEDN } from "../domain/encode";
import { summarizeScores } from "../domain/grades";
import { normalize } from "../domain/ir";
import { newMember, type Diagram, type DiagramClass, type Member, type UMLDocument } from "../domain/model";

/**
 * Joins CRAP and mutation snapshots onto classes (umlviewer `Overlay.swift`,
 * Clojure `uml-viewer.application.overlay`). A snapshot belongs to the class
 * whose `ns` equals its namespace, else the class id, else a dotted ancestor
 * id, else the single Rust crate root when it names the policy prefix.
 *
 * This module is pure: the caller reads `.metrics/` and passes file texts.
 */

/** One function's row in `.metrics/crap.edn`. */
export interface CrapEntry {
  name?: string;
  namespace?: string;
  complexity?: number;
  /** Percent, 0–100. */
  coverage?: number;
  crap?: number;
}

/** One form in a mutation snapshot: `defn/<name>`, `defn-/<name>`, `method/<name>` or `method-/<name>`. */
export interface MutationForm {
  id?: string;
  killed?: number;
  survived?: number;
  uncovered?: number;
  sites?: number;
}

export interface MutationSnapshot {
  namespace?: string;
  source?: string;
  forms: MutationForm[];
}

/**
 * String-keyed map that iterates in the order the Clojure map it mirrors
 * would. Later values replace earlier ones and keep their position.
 */
export class ClojureMap<V> {
  private constructor(
    readonly keys: string[],
    private readonly values: Map<string, V>,
  ) {}

  /** Inserted one by one, as `assoc` or `into {}` would. */
  static inserting<V>(pairs: [string, V][]): ClojureMap<V> {
    const values = new Map<string, V>();
    const firstSeen: string[] = [];
    for (const [k, v] of pairs) {
      if (!values.has(k)) firstSeen.push(k);
      values.set(k, v);
    }
    return new ClojureMap(
      mapOrder(firstSeen).map((i) => firstSeen[i] as string),
      values,
    );
  }

  /** Taken in the order given, which is already Clojure's (a printed map). */
  static ordered<V>(pairs: [string, V][]): ClojureMap<V> {
    const values = new Map<string, V>();
    const keys: string[] = [];
    for (const [k, v] of pairs) {
      if (!values.has(k)) {
        keys.push(k);
        values.set(k, v);
      }
    }
    return new ClojureMap(keys, values);
  }

  static empty<V>(): ClojureMap<V> {
    return new ClojureMap<V>([], new Map());
  }

  get(key: string): V | undefined {
    return this.values.get(key);
  }

  get isEmpty(): boolean {
    return this.keys.length === 0;
  }

  get orderedValues(): V[] {
    return this.keys.map((k) => this.values.get(k) as V);
  }
}

/** CRAP rows by namespace and one mutation snapshot per namespace. */
export interface Metrics {
  crap: ClojureMap<CrapEntry[]>;
  mutate: ClojureMap<MutationSnapshot>;
}

export const emptyMetrics = (): Metrics => ({ crap: ClojureMap.empty(), mutate: ClojureMap.empty() });

const metricsEmpty = (m: Metrics) => m.crap.isEmpty && m.mutate.isEmpty;

// ---------- reading snapshots ----------

/** A metrics file as the server hands it over. `modified` is in ms since the epoch. */
export interface MetricsFile {
  path: string;
  modified: number;
  text: string;
}

function crapEntry(x: EDN): CrapEntry {
  return {
    name: text(get(x, "name")),
    namespace: text(get(x, "namespace")),
    complexity: num(get(x, "complexity")),
    coverage: num(get(x, "coverage")),
    crap: num(get(x, "crap")),
  };
}

function mutationSnapshot(x: EDN): MutationSnapshot {
  return {
    namespace: text(get(x, "namespace")),
    source: text(get(x, "source")),
    forms: (items(get(x, "forms")) ?? []).map((f) => ({
      id: text(get(f, "id")),
      killed: integer(get(f, "killed")),
      survived: integer(get(f, "survived")),
      uncovered: integer(get(f, "uncovered")),
      sites: integer(get(f, "sites")),
    })),
  };
}

/** `src/uml_viewer/domain/ir.clj` -> `uml-viewer.domain.ir`. */
export function namespaceFromSource(src: string): string {
  let s = src.replaceAll("\\", "/");
  if (s.startsWith("src/")) s = s.slice(4);
  return s.replace(/\.[^.]+$/, "").replaceAll("/", ".").replaceAll("_", "-");
}

/**
 * Parse `.metrics/crap.edn` and `.metrics/mutate/**.edn`. When two snapshots
 * name one namespace, the newer file wins (ties go by path). Throws
 * `EDNReadError` for a file that does not parse.
 */
export function loadMetrics(crapFile: MetricsFile | undefined, mutateFiles: MetricsFile[]): Metrics {
  let crap = ClojureMap.empty<CrapEntry[]>();
  if (crapFile) {
    const rows = (items(get(readEDN(crapFile.text), "entries")) ?? []).map(crapEntry);
    // group-by :namespace; a nil namespace counts toward the map's size.
    const groups = groupBy(rows, (r) => r.namespace ?? null);
    crap = ClojureMap.ordered(groups.flatMap((g) => (g[0]?.namespace === undefined ? [] : [[g[0].namespace, g]])));
  }
  const oldestFirst = [...mutateFiles].sort((a, b) => a.modified - b.modified || (a.path < b.path ? -1 : 1));
  const snapshots: [string, MutationSnapshot][] = [];
  for (const f of oldestFirst) {
    const snap = mutationSnapshot(readEDN(f.text));
    const ns = snap.namespace ?? (snap.source === undefined ? undefined : namespaceFromSource(snap.source));
    if (ns !== undefined) snapshots.push([ns, snap]);
  }
  return { crap, mutate: ClojureMap.inserting(snapshots) };
}

/** `{:crap {ns [rows]} :mutate {ns snapshot}}` as printed by Clojure: its map order is already Clojure's. */
export function metricsFromEDN(x: EDN): Metrics {
  const pairs = <V>(m: EDN | undefined, f: (v: EDN) => V): [string, V][] =>
    [...(asMap(m) ?? [])].flatMap(([k, v]) => {
      const key = text(k);
      return key === undefined ? [] : [[key, f(v)] as [string, V]];
    });
  return {
    crap: ClojureMap.ordered(pairs(get(x, "crap"), (v) => (items(v) ?? []).map(crapEntry))),
    mutate: ClojureMap.ordered(pairs(get(x, "mutate"), mutationSnapshot)),
  };
}

// ---------- owners ----------

/** Crapper separates Rust paths with `::` and everything else with `.`. */
const normalizeNS = (s: string) => s.replaceAll("::", ".");

function soleRustRoot(classes: DiagramClass[]): DiagramClass | undefined {
  const roots = classes.filter((c) => c.lang === "rust" && !c.foreign && !c.id.includes("."));
  return roots.length === 1 ? roots[0] : undefined;
}

type Rank = [number, number];

/** Sort key when `c` should show snapshot `snap`, or undefined. */
function claimRank(c: DiagramClass, prefix: string | undefined, rustRoot: DiagramClass | undefined, snap: string): Rank | undefined {
  if (c.ns === snap) return [0, 0];
  if (c.id === snap) return [1, 0];
  if (snap.startsWith(c.id + ".")) return [2, -c.id.length];
  if (rustRoot === c && prefix !== undefined && snap === prefix) return [3, 0];
  return undefined;
}

const before = (a: Rank, b: Rank) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

function owner(classes: DiagramClass[], prefix: string | undefined, ns: string): DiagramClass | undefined {
  const snap = normalizeNS(ns);
  const rustRoot = soleRustRoot(classes);
  let best: [Rank, DiagramClass] | undefined;
  for (const c of classes) {
    if (c.foreign) continue;
    const rank = claimRank(c, prefix, rustRoot, snap);
    if (rank && (!best || before(rank, best[0]))) best = [rank, c];
  }
  return best?.[1];
}

/** Class `ns` -> the snapshot namespaces that class shows. */
function owners(classes: DiagramClass[], prefix: string | undefined, metrics: Metrics): Map<string, string[]> {
  const names = [...new Set([...metrics.crap.keys, ...metrics.mutate.keys])];
  const out = new Map<string, string[]>();
  for (const snap of names) {
    const k = owner(classes, prefix, snap)?.ns;
    if (k !== undefined) out.set(k, [...(out.get(k) ?? []), snap]);
  }
  return out;
}

// ---------- painting ----------

interface FunctionMutants {
  isPrivate: boolean;
  killed?: number;
  survived?: number;
  uncovered?: number;
  sites?: number;
}

const counted = (m: { killed?: number; survived?: number; uncovered?: number; sites?: number }) =>
  m.sites ?? (m.killed ?? 0) + (m.survived ?? 0) + (m.uncovered ?? 0);

const FORM_PREFIXES: [string, boolean][] = [
  ["defn-/", true],
  ["defn/", false],
  ["method-/", true],
  ["method/", false],
];

function formName(id: string | undefined): { name: string; isPrivate: boolean } | undefined {
  if (id === undefined) return undefined;
  for (const [prefix, isPrivate] of FORM_PREFIXES) {
    if (id.startsWith(prefix)) return { name: id.slice(prefix.length), isPrivate };
  }
  return undefined;
}

/** `mutate-by-fn`: `(into {} ...)` from function name to its counts. */
function mutantsByFunction(forms: MutationForm[]): ClojureMap<FunctionMutants> {
  return ClojureMap.inserting(
    forms.flatMap((f) => {
      const n = formName(f.id);
      return n
        ? [[n.name, { isPrivate: n.isPrivate, killed: f.killed, survived: f.survived, uncovered: f.uncovered, sites: f.sites }]]
        : [];
    }),
  );
}

function overlayOp(op: Member, crap: CrapEntry | undefined, mutants: FunctionMutants | undefined): Member {
  const m: Member = { ...op, text: op.text ?? op.name };
  if (crap) {
    m.cc = crap.complexity;
    m.crap = crap.crap;
    m.coverage = crap.coverage === undefined ? undefined : crap.coverage / 100;
  }
  if (mutants) {
    m.killed = mutants.killed ?? 0;
    m.survived = mutants.survived ?? 0;
    m.uncovered = mutants.uncovered ?? 0;
    m.sites = counted(mutants);
  }
  if (op.isPrivate || mutants?.isPrivate) m.isPrivate = true;
  return m;
}

function paintedOps(c: DiagramClass, crapFns: CrapEntry[], mutFns: ClojureMap<FunctionMutants>): Member[] {
  const byName = new Map<string | undefined, CrapEntry>();
  for (const f of crapFns) byName.set(f.name, f);
  const names = [...new Set<string | undefined>([...c.ops.map((o) => o.name), ...crapFns.map((f) => f.name), ...mutFns.keys])];
  return names.map((name) => {
    const base = c.ops.find((o) => o.name === name) ?? newMember(name, name);
    return overlayOp(base, byName.get(name), name === undefined ? undefined : mutFns.get(name));
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Paint one class from the snapshots it owns (its own `ns` when `owned` is undefined). */
export function overlayClass(c: DiagramClass, metrics: Metrics, owned?: string[]): DiagramClass {
  const nss = owned ?? (c.ns === undefined ? [] : [c.ns]);
  const crapFns = nss.flatMap((ns) => metrics.crap.get(ns) ?? []);
  const snaps = nss.flatMap((ns) => metrics.mutate.get(ns) ?? []);
  const mutFns = mutantsByFunction(snaps.flatMap((s) => s.forms));
  const scores = crapFns.flatMap((f) => f.crap ?? []);
  const coverages = crapFns.flatMap((f) => f.coverage ?? []);
  const ops = paintedOps(c, crapFns, mutFns);
  const counts = mutFns.orderedValues;

  const out = { ...c };
  if (scores.length > 0) {
    out.crap = summarizeScores(scores);
    out.cc = sum(crapFns.map((f) => f.complexity ?? 0));
  }
  if (coverages.length > 0) out.coverage = sum(coverages) / coverages.length / 100;
  if (counts.length > 0) {
    out.killed = sum(counts.map((m) => m.killed ?? 0));
    out.survived = sum(counts.map((m) => m.survived ?? 0));
    out.uncovered = sum(counts.map((m) => m.uncovered ?? 0));
    out.sites = sum(counts.map(counted));
  }
  if (ops.length > 0) out.ops = ops;
  return out;
}

function paintClass(c: DiagramClass, metrics: Metrics, own: Map<string, string[]>): DiagramClass {
  return overlayClass(c, metrics, (c.ns === undefined ? undefined : own.get(c.ns)) ?? []);
}

/**
 * A hand-written diagram is normalized again after painting, as in Clojure:
 * op scores become `{:mu :max :sigma}` maps.
 */
function paintDiagram(d: Diagram, metrics: Metrics, own: Map<string, string[]>): Diagram {
  const painted = { ...d, packages: d.packages.map((p) => ({ ...p, classes: p.classes.map((c) => paintClass(c, metrics, own)) })) };
  try {
    return normalize(diagramEDN(painted));
  } catch {
    return painted;
  }
}

export function applyMetrics(doc: UMLDocument, metrics: Metrics): UMLDocument {
  if (metricsEmpty(metrics)) return doc;
  if (doc.kind === "hierarchy") {
    const own = owners(doc.doc.classes, doc.doc.prefix || undefined, metrics);
    return { ...doc, doc: { ...doc.doc, classes: doc.doc.classes.map((c) => paintClass(c, metrics, own)) } };
  }
  const own = owners(doc.diagrams.flatMap((d) => d.packages.flatMap((p) => p.classes)), undefined, metrics);
  return { ...doc, diagrams: doc.diagrams.map((d) => paintDiagram(d, metrics, own)) };
}

/** `apply-metrics` on a single normalized diagram (the `:packages` form). */
export function applyMetricsToDiagram(d: Diagram, metrics: Metrics): Diagram {
  if (metricsEmpty(metrics)) return d;
  return paintDiagram(d, metrics, owners(d.packages.flatMap((p) => p.classes), undefined, metrics));
}
