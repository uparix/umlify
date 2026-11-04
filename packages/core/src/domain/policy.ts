import { groupBy } from "../edn/clojure-hash";
import { EDNMap, asMap, get, idName, items, kw, text, truthy, type EDN } from "../edn/value";
import {
  decodeNSEntry,
  pairKey,
  type DiagramClass,
  type Edge,
  type EdgeKind,
  type EdgePair,
  type HierarchyDocument,
  type NodeID,
  type NSEntry,
} from "./model";

/**
 * The view-time half of `uml-viewer.domain.policy` (umlviewer
 * `Policy.swift`): proposals, ranks, violations, and edge kinds.
 */

/** A named layer of a proposal: real namespaces grouped under a label. */
export interface Layer {
  id: NodeID;
  label: string;
  nses: NSEntry[];
}

/** A proposal after normalization: the named layers that are not in code. */
export interface NamedProposal {
  id: NodeID;
  name: string;
  layers: Layer[];
  omit: NodeID[];
  notice: string;
}

/** A normalized proposal: notice, layers, and (for the map form) omit. */
export interface NormalizedProposal {
  notice: string;
  layers: Layer[];
  omit: NodeID[];
}

export type Ranks = Map<NodeID, number>;

export const PROPOSAL_NOTICE = "PROPOSAL — not instantiated in code";

const matchesPrefix = (id: NodeID, prefix: NodeID) => id === prefix || id.startsWith(prefix + ".");

/** True when `id` is listed in `omit` or sits under a listed component. */
export function omittedID(id: NodeID, omit: readonly NodeID[]): boolean {
  return omit.some((p) => matchesPrefix(id, p));
}

export function kindRank(k: EdgeKind): number {
  switch (k) {
    case "implements":
    case "inheritance":
      return 4;
    case "composition":
      return 3;
    case "aggregation":
      return 2;
    case "association":
      return 1;
    default:
      return 0;
  }
}

/** Leaf namespace ids of a layer's entries, nested groups flattened. */
export function nseIDs(nses: readonly NSEntry[]): NodeID[] {
  return nses.flatMap((e) => (e.kind === "ns" ? [e.id] : nseIDs(e.nses)));
}

const ids = (x: EDN | undefined): NodeID[] => (items(x) ?? []).flatMap((e) => idName(e) ?? []);

// ---------- proposals ----------

function layer(i: number, x: EDN): Layer | undefined {
  if (!asMap(x)) return undefined;
  const nses = (items(get(x, "nses")) ?? []).flatMap((e) => decodeNSEntry(e) ?? []);
  const id = idName(get(x, "id") ?? get(x, "label")) ?? `layer-${i}`;
  return { id, label: text(get(x, "label")) ?? id, nses };
}

const layers = (xs: EDN[]): Layer[] => xs.flatMap((x, i) => layer(i, x) ?? []);

/** Named layers that are not namespace segments; undefined when there are none. */
export function normalizeProposal(p: EDN): NormalizedProposal | undefined {
  if (Array.isArray(p)) {
    const ls = layers(p);
    return ls.length === 0 ? undefined : { notice: PROPOSAL_NOTICE, layers: ls, omit: [] };
  }
  if (p instanceof EDNMap) {
    const ls = layers(items(get(p, "layers")) ?? []);
    if (ls.length === 0) return undefined;
    return { notice: text(get(p, "notice")) ?? PROPOSAL_NOTICE, layers: ls, omit: ids(get(p, "omit")) };
  }
  return undefined;
}

function namedProposal(i: number, p: EDN): NamedProposal | undefined {
  if (!asMap(p)) return undefined;
  const id = idName(get(p, "id")) ?? `proposal-${i}`;
  return {
    id,
    name: text(get(p, "name") ?? get(p, "label")) ?? id,
    layers: normalizeProposal(p)?.layers ?? [],
    omit: ids(get(p, "omit")),
    notice: text(get(p, "notice")) ?? PROPOSAL_NOTICE,
  };
}

/**
 * Named proposals from a document's `:proposals`, or its legacy `:proposal`
 * (a named map, or a bare vector of layers).
 */
export function namedProposalsOf(proposals: EDN, one: EDN): NamedProposal[] {
  if (Array.isArray(proposals)) return proposals.flatMap((p, i) => namedProposal(i, p) ?? []);
  if (asMap(one) && (truthy(get(one, "name")) || (items(get(one, "layers")) ?? []).length > 0)) {
    // A map with a name but no layers loses the name, as in Clojure.
    const p = truthy(get(one, "layers")) ? one : new EDNMap([[kw("layers"), null]]);
    const named = namedProposal(0, p);
    return named ? [named] : [];
  }
  const n = Array.isArray(one) ? normalizeProposal(one) : undefined;
  return n ? [{ id: "proposal", name: "Proposal", layers: n.layers, omit: [], notice: n.notice }] : [];
}

export function namedProposals(doc: HierarchyDocument): NamedProposal[] {
  return namedProposalsOf(doc.proposals, doc.proposal);
}

export function proposalByID(doc: HierarchyDocument, id: NodeID | undefined): NamedProposal | undefined {
  return id === undefined ? undefined : namedProposals(doc).find((p) => p.id === id);
}

/** Layers of the first named proposal, else of the legacy `:proposal`. */
export function proposalLayers(doc: HierarchyDocument): Layer[] {
  return namedProposals(doc)[0]?.layers ?? normalizeProposal(doc.proposal)?.layers ?? [];
}

/**
 * `proposal-layers` on any policy or IR map: the first named proposal's
 * layers, else `:proposal` normalized, else the map itself normalized when
 * it has no `:proposal` key.
 */
export function proposalLayersOfRaw(x: EDN): Layer[] {
  const one = get(x, "proposal") ?? null;
  const first = namedProposalsOf(get(x, "proposals") ?? null, one)[0];
  if (first) return first.layers;
  const hasProposal = asMap(x)?.has(kw("proposal")) ?? false;
  return normalizeProposal(hasProposal ? one : x)?.layers ?? [];
}

// ---------- ranks ----------

/** `:levels` groups as segment ids; proposal layers when `:levels` is empty. */
export function levelGroupsOf(levels: EDN, fallbackLayers: () => Layer[]): NodeID[][] {
  const groups = items(levels);
  if (groups && groups.length > 0) {
    return groups.map((g) => (asMap(g) ? ids(get(g, "nses")) : ids(g)));
  }
  return fallbackLayers().map((l) => nseIDs(l.nses));
}

export function levelGroups(doc: HierarchyDocument): NodeID[][] {
  return levelGroupsOf(doc.levels, () => proposalLayers(doc));
}

/** Segment -> rank; smaller is inner. A segment listed twice takes its last rank. */
export function ranksOf(groups: NodeID[][]): Ranks {
  const out: Ranks = new Map();
  groups.forEach((group, rank) => group.forEach((seg) => out.set(seg, rank)));
  return out;
}

export function levelRanks(doc: HierarchyDocument): Ranks {
  return ranksOf(levelGroups(doc));
}

export function ranksFromLayers(ls: Layer[]): Ranks {
  return ranksOf(ls.map((l) => nseIDs(l.nses)));
}

/** Rank for `id`: an exact key, else its longest dotted prefix. */
export function rankOf(id: NodeID, ranks: Ranks): number | undefined {
  const parts = id.split(".");
  for (let n = parts.length; n > 0; n--) {
    const r = ranks.get(parts.slice(0, n).join("."));
    if (r !== undefined) return r;
  }
  return undefined;
}

/** A dependency from an inner (smaller rank) segment to an outer one. */
export function violatingDependency(e: Edge, ranks: Ranks): boolean {
  if (e.kind !== "dependency") return false;
  const rf = rankOf(e.from, ranks);
  const rt = rankOf(e.to, ranks);
  return rf !== undefined && rt !== undefined && rf < rt;
}

export function markViolations(edges: Edge[], ranks: Ranks): Edge[] {
  return edges.map((e) => ({ ...e, violating: violatingDependency(e, ranks) }));
}

/** Recompute `level` on classes and `violating` on edges from `ranks`. */
export function restampRanks(
  classes: DiagramClass[],
  edges: Edge[],
  ranks: Ranks,
): { classes: DiagramClass[]; edges: Edge[] } {
  return {
    classes: classes.map((c) => ({ ...c, level: c.foreign ? undefined : rankOf(c.id, ranks) })),
    edges: markViolations(edges, ranks),
  };
}

// ---------- edges ----------

/** `(vals (group-by (juxt :from :to) edges))`. */
export function groupByPair(edges: Edge[]): Edge[][] {
  return groupBy(edges, (e) => [kw(e.from), kw(e.to)]);
}

/** Clojure `max-key`: the last of the maxima. */
export function maxKeyLast<T>(xs: readonly T[], key: (x: T) => number): T {
  let best = xs[0] as T;
  let bestKey = key(best);
  for (const x of xs.slice(1)) {
    const k = key(x);
    if (k >= bestKey) {
      best = x;
      bestKey = k;
    }
  }
  return best;
}

/**
 * The strongest edge per `from -> to`, in Clojure's `group-by` order. A
 * surviving dependency is violating if any bundled edge was.
 */
export function mergeEdges(edges: Edge[]): Edge[] {
  return groupByPair(edges).map((group) => {
    const best = maxKeyLast(group, (e) => kindRank(e.kind));
    return { ...best, violating: best.kind === "dependency" && group.some((e) => e.violating) };
  });
}

/**
 * Drop omitted pairs, apply kind overrides, and clear `violating` on
 * anything that is no longer a dependency.
 */
export function applyEdgeKinds(edges: Edge[], kinds: Map<string, EdgeKind>, omit: EdgePair[]): Edge[] {
  const omitted = new Set(omit.map(pairKey));
  return edges
    .filter((e) => !omitted.has(pairKey(e)))
    .map((e) => {
      const kind = kinds.get(pairKey(e)) ?? e.kind;
      return { ...e, kind, violating: kind === "dependency" ? e.violating : false };
    });
}

export function applyDocEdgeKinds(edges: Edge[], doc: HierarchyDocument): Edge[] {
  return applyEdgeKinds(edges, doc.edgeKinds, doc.omitEdges);
}
