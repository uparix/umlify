import {
  asMap,
  get,
  idName,
  integer,
  items,
  num,
  str,
  text,
  truthy,
  type EDN,
} from "../edn/value";

/**
 * The domain model (umlviewer `Model.swift`) and its lenient EDN decoding
 * (`ModelEDN.swift`): a missing key is undefined and anything truthy counts
 * as true, as in the Clojure code. Values are plain objects; functions that
 * change one return a copy.
 */

/** A class or namespace id: the keyword name without the colon. Dots are part of it. */
export type NodeID = string;

/** CRAP summary: μ, max, population σ, and function count. */
export interface CrapSummary {
  mu?: number;
  max?: number;
  sigma?: number;
  n?: number;
}

/** A member's CRAP: one function's score, or a summary. */
export type CrapMetric = number | CrapSummary;

/** `config/score-of`: the number, or a summary's μ. */
export function scoreOf(m: CrapMetric | undefined): number | undefined {
  return typeof m === "number" ? m : m?.mu;
}

/** Killed, survived and uncovered mutants, plus `mutGap` failed trials. */
export interface Mutants {
  killed?: number;
  survived?: number;
  uncovered?: number;
  mutGap?: number;
}

/** A field or operation on a class box. */
export interface Member {
  text?: string;
  name?: string;
  args: string[];
  type?: string;
  returns?: string;
  cc?: number;
  crap?: CrapMetric;
  coverage?: number;
  killed?: number;
  survived?: number;
  uncovered?: number;
  sites?: number;
  isPrivate: boolean;
}

/** An edge kind keyword name. Unknown kinds pass through unchanged. */
export type EdgeKind = string;

/** One `from -> to` pair bundled into a collapsed arrow. */
export interface LeafDep {
  from: NodeID;
  to: NodeID;
  violating: boolean;
}

export interface Edge {
  from: NodeID;
  to: NodeID;
  kind: EdgeKind;
  label?: string;
  violating: boolean;
  /** Leaf ends before `collapse-arrows` remapped them. */
  origFrom?: NodeID;
  origTo?: NodeID;
  /** Every id a collapsed arrow passes through (a set in Clojure). */
  viaIDs?: NodeID[];
  /** The leaf pairs a collapsed arrow bundles. */
  deps?: LeafDep[];
}

export interface EdgePair {
  from: NodeID;
  to: NodeID;
}

/** Map key for an edge pair. */
export const pairKey = (p: EdgePair): string => `${p.from}\u0000${p.to}`;

/** An item in a layer's `:nses`: a namespace id or a nested group. */
export type NSEntry = { kind: "ns"; id: NodeID } | { kind: "group"; id: NodeID; label: string; nses: NSEntry[] };

/** A child line inside a box. */
export interface ContentEntry {
  id: NodeID;
  name: string;
  drill: boolean;
}

/** An off-view dependency drawn as a port on a box. */
export interface PortDep {
  id: NodeID;
  name?: string;
}

/**
 * A class box: a document module, a view box, a foreign oval, or a layer
 * dummy. One type serves all of them, as one map shape does in Clojure.
 */
export interface DiagramClass extends Mutants {
  id: NodeID;
  name?: string;
  ns?: string;
  lang?: string;
  file?: string;
  level?: number;
  stereotype?: string;
  foreign: boolean;
  external: boolean;
  shape?: string;
  package?: NodeID;

  crap?: CrapSummary;
  coverage?: number;
  cc?: number;
  sites?: number;

  hideMembers: boolean;
  fields: Member[];
  ops: Member[];

  // View-only.
  drill: boolean;
  dummy: boolean;
  proposalGroup: boolean;
  contents: ContentEntry[];
  inDeps: PortDep[];
  outDeps: PortDep[];
  members: DiagramClass[];
  nses: NSEntry[];
}

export interface Package {
  id: NodeID;
  label?: string;
  crap?: CrapSummary;
  classes: DiagramClass[];
  /** Ids folded away by `hide-classes`. */
  nses: NodeID[];
}

/** One diagram ready for layout: a normalized IR diagram or a hierarchy view. */
export interface Diagram {
  title: string;
  direction: string;
  packages: Package[];
  foreign: DiagramClass[];
  edges: Edge[];
  hideEdges: boolean;
  proposal: boolean;
}

/** `:order`: a list for the root, or a map from a dotted path to a list. */
export type Order = { kind: "list"; ids: NodeID[] } | { kind: "byPath"; paths: Map<string, NodeID[]> };

/**
 * A hierarchical IR document: the namespace tree, its edges, and the policy
 * keys the viewer needs. Proposals stay EDN because their accepted shapes
 * are loose; the policy module normalizes them.
 */
export interface HierarchyDocument {
  title?: string;
  prefix?: string;
  order: Order;
  /** `:levels` as written (vectors of segments or `{:nses …}` maps). */
  levels: EDN;
  /** Keyed by `pairKey`. */
  edgeKinds: Map<string, EdgeKind>;
  omitEdges: EdgePair[];
  omit: NodeID[];
  classes: DiagramClass[];
  edges: Edge[];
  proposals: EDN;
  proposal: EDN;
  policyFile?: string;
}

/** What a file holds: a namespace tree, or stacked hand-written diagrams. */
export type UMLDocument =
  | { kind: "hierarchy"; doc: HierarchyDocument }
  | { kind: "diagrams"; title: string; diagrams: Diagram[] };

// ---------- constructors ----------

export function newMember(text?: string, name?: string): Member {
  return { text, name, args: [], isPrivate: false };
}

export function newClass(id: NodeID, name?: string): DiagramClass {
  return {
    id,
    name,
    foreign: false,
    external: false,
    hideMembers: false,
    fields: [],
    ops: [],
    drill: false,
    dummy: false,
    proposalGroup: false,
    contents: [],
    inDeps: [],
    outDeps: [],
    members: [],
    nses: [],
  };
}

export function newEdge(from: NodeID, to: NodeID, kind: EdgeKind = "association", label?: string, violating = false): Edge {
  return { from, to, kind, label, violating };
}

export function newPackage(id: NodeID, label: string | undefined, classes: DiagramClass[]): Package {
  return { id, label, classes, nses: [] };
}

export function newDiagram(title: string): Diagram {
  return { title, direction: "tb", packages: [], foreign: [], edges: [], hideEdges: false, proposal: false };
}

export function newHierarchyDocument(): HierarchyDocument {
  return {
    order: { kind: "list", ids: [] },
    levels: null,
    edgeKinds: new Map(),
    omitEdges: [],
    omit: [],
    classes: [],
    edges: [],
    proposals: null,
    proposal: null,
  };
}

// ---------- decoding ----------

const compact = <T>(xs: EDN[] | undefined, f: (x: EDN) => T | undefined): T[] =>
  (xs ?? []).flatMap((x) => {
    const y = f(x);
    return y === undefined ? [] : [y];
  });

export function decodeCrapSummary(x: EDN | undefined): CrapSummary | undefined {
  if (typeof x === "number") return { mu: x, max: x, sigma: 0 };
  if (!asMap(x)) return undefined;
  return { mu: num(get(x, "mu")), max: num(get(x, "max")), sigma: num(get(x, "sigma")), n: integer(get(x, "n")) };
}

export function decodeCrapMetric(x: EDN | undefined): CrapMetric | undefined {
  if (typeof x === "number") return x;
  return asMap(x) ? decodeCrapSummary(x) : undefined;
}

export function decodeMember(x: EDN): Member | undefined {
  if (typeof x === "string") return newMember(x);
  if (!asMap(x)) return undefined;
  return {
    text: str(get(x, "text")),
    name: text(get(x, "name")),
    args: compact(items(get(x, "args")), text),
    type: text(get(x, "type")),
    returns: text(get(x, "returns")),
    cc: num(get(x, "cc")),
    crap: decodeCrapMetric(get(x, "crap")),
    coverage: num(get(x, "coverage")),
    killed: integer(get(x, "killed")),
    survived: integer(get(x, "survived")),
    uncovered: integer(get(x, "uncovered")),
    sites: integer(get(x, "sites")),
    isPrivate: truthy(get(x, "private")),
  };
}

export function decodeNSEntry(x: EDN): NSEntry | undefined {
  if (asMap(x)) {
    const id = idName(get(x, "id") ?? get(x, "label"));
    if (id === undefined) return undefined;
    return { kind: "group", id, label: text(get(x, "label")) ?? id, nses: compact(items(get(x, "nses")), decodeNSEntry) };
  }
  const id = idName(x);
  return id === undefined ? undefined : { kind: "ns", id };
}

function decodePorts(x: EDN | undefined): PortDep[] {
  return compact(items(x), (e) => {
    const id = idName(get(e, "id"));
    return id === undefined ? undefined : { id, name: text(get(e, "name")) };
  });
}

export function decodeClass(x: EDN): DiagramClass | undefined {
  const id = asMap(x) ? idName(get(x, "id")) : undefined;
  if (id === undefined) return undefined;
  return {
    ...newClass(id, text(get(x, "name"))),
    ns: text(get(x, "ns")),
    lang: idName(get(x, "lang")),
    file: text(get(x, "file")),
    level: integer(get(x, "level")),
    stereotype: idName(get(x, "stereotype")),
    foreign: truthy(get(x, "foreign")),
    external: truthy(get(x, "external")),
    shape: idName(get(x, "shape")),
    package: idName(get(x, "package")),
    crap: decodeCrapSummary(get(x, "crap")),
    coverage: num(get(x, "coverage")),
    cc: num(get(x, "cc")),
    killed: integer(get(x, "killed")),
    survived: integer(get(x, "survived")),
    uncovered: integer(get(x, "uncovered")),
    mutGap: integer(get(x, "mut-gap")),
    sites: integer(get(x, "sites")),
    hideMembers: truthy(get(x, "hide-members")),
    fields: compact(items(get(x, "fields")), decodeMember),
    ops: compact(items(get(x, "ops")), decodeMember),
    drill: truthy(get(x, "drill?")),
    dummy: truthy(get(x, "dummy?")),
    proposalGroup: truthy(get(x, "proposal-group?")),
    contents: compact(items(get(x, "contents")), (e) => {
      const cid = idName(get(e, "id"));
      return cid === undefined ? undefined : { id: cid, name: text(get(e, "name")) ?? cid, drill: truthy(get(e, "drill?")) };
    }),
    inDeps: decodePorts(get(x, "in-deps")),
    outDeps: decodePorts(get(x, "out-deps")),
    members: compact(items(get(x, "members")), decodeClass),
    nses: compact(items(get(x, "nses")), decodeNSEntry),
  };
}

export function decodeEdge(x: EDN): Edge | undefined {
  const from = idName(get(x, "from"));
  const to = idName(get(x, "to"));
  if (from === undefined || to === undefined) return undefined;
  const via = items(get(x, "via-ids"));
  const deps = items(get(x, "deps"));
  return {
    ...newEdge(from, to, idName(get(x, "kind")) ?? "", text(get(x, "label")), truthy(get(x, "violating"))),
    origFrom: idName(get(x, "orig-from")),
    origTo: idName(get(x, "orig-to")),
    viaIDs: via && compact(via, idName),
    deps:
      deps &&
      compact(deps, (d) => {
        const f = idName(get(d, "from"));
        const t = idName(get(d, "to"));
        return f === undefined || t === undefined ? undefined : { from: f, to: t, violating: truthy(get(d, "violating")) };
      }),
  };
}

export function decodeEdgePair(x: EDN): EdgePair | undefined {
  const xs = items(x);
  if (xs?.length !== 2) return undefined;
  const from = idName(xs[0]);
  const to = idName(xs[1]);
  return from === undefined || to === undefined ? undefined : { from, to };
}

export function decodePackage(x: EDN): Package | undefined {
  const id = idName(get(x, "id"));
  if (id === undefined) return undefined;
  return {
    ...newPackage(id, text(get(x, "label")), compact(items(get(x, "classes")), decodeClass)),
    crap: decodeCrapSummary(get(x, "crap")),
    nses: compact(items(get(x, "nses")), idName),
  };
}

export function decodeDiagram(x: EDN): Diagram | undefined {
  if (!asMap(x)) return undefined;
  return {
    title: text(get(x, "title")) ?? "UML",
    direction: idName(get(x, "direction")) ?? "tb",
    packages: compact(items(get(x, "packages")), decodePackage),
    foreign: compact(items(get(x, "foreign")), decodeClass),
    edges: compact(items(get(x, "edges")), decodeEdge),
    hideEdges: truthy(get(x, "hide-edges")),
    proposal: truthy(get(x, "proposal")),
  };
}

function decodeOrder(x: EDN | undefined): Order {
  const m = asMap(x);
  if (!m) return { kind: "list", ids: compact(items(x), idName) };
  const paths = new Map<string, NodeID[]>();
  for (const [k, v] of m) if (typeof k === "string") paths.set(k, compact(items(v), idName));
  return { kind: "byPath", paths };
}

export function decodeHierarchyDocument(x: EDN): HierarchyDocument | undefined {
  if (!asMap(x)) return undefined;
  const edgeKinds = new Map<string, EdgeKind>();
  for (const [k, v] of asMap(get(x, "edge-kinds")) ?? []) {
    const pair = decodeEdgePair(k);
    const kind = idName(v);
    if (pair && kind !== undefined) edgeKinds.set(pairKey(pair), kind);
  }
  return {
    title: text(get(x, "title")),
    prefix: text(get(x, "prefix")),
    order: decodeOrder(get(x, "order")),
    levels: get(x, "levels") ?? null,
    edgeKinds,
    omitEdges: compact(items(get(x, "omit-edges")), decodeEdgePair),
    omit: compact(items(get(x, "omit")), idName),
    classes: compact(items(get(x, "classes")), decodeClass),
    edges: compact(items(get(x, "edges")), decodeEdge),
    proposals: get(x, "proposals") ?? null,
    proposal: get(x, "proposal") ?? null,
    policyFile: text(get(x, "policy-file")),
  };
}
