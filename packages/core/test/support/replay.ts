import { EDNMap, asMap, get, idName, integer, items, kw, num, text, truthy, type EDN } from "../../src/edn/value";
import * as Grades from "../../src/domain/grades";
import * as Hierarchy from "../../src/domain/hierarchy";
import * as IR from "../../src/domain/ir";
import {
  decodeClass,
  decodeCrapSummary,
  decodeDiagram,
  decodeEdge,
  decodeEdgePair,
  decodeHierarchyDocument,
  decodeNSEntry,
  pairKey,
  type Diagram,
  type DiagramClass,
  type Edge,
  type EdgeKind,
  type HierarchyDocument,
  type NodeID,
} from "../../src/domain/model";
import * as Policy from "../../src/domain/policy";
import { applyMetrics, applyMetricsToDiagram, metricsFromEDN, overlayClass } from "../../src/metrics/overlay";
import {
  classEDN,
  crapSummaryEDN,
  diagramEDN,
  documentEDN,
  edgeEDN,
  layerEDN,
  mutantsEDN,
  namedProposalEDN,
  normalizedEDN,
  ranksEDN,
} from "../../src/domain/encode";
import { readFixture } from "./fixtures";

/**
 * Replays calls recorded from the Clojure specs (umlviewer `Replay.swift`):
 * decode the arguments, call the port, encode the result as EDN.
 */

export interface Call {
  fn: string;
  args: EDN[];
  expected: EDN;
  throws: boolean;
}

export function recordedCalls(ns: string): Call[] {
  return (items(readFixture(`calls/${ns}.edn`)) ?? []).map((c) => ({
    fn: get(c, "fn") as string,
    args: items(get(c, "args")) ?? [],
    expected: get(c, "ret") ?? null,
    throws: truthy(get(c, "throws")),
  }));
}

export class Unsupported extends Error {}

class BadArgs extends Error {}

function must<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new BadArgs(what);
  return x;
}

/** Specs pass bare maps like `{:ops [...]}`; give them an id. */
function cls(x: EDN): DiagramClass {
  const m = new EDNMap(asMap(x) ?? []);
  if (!m.has(kw("id"))) m.set(kw("id"), kw(""));
  return must(decodeClass(m), "class");
}

const diagram = (x: EDN): Diagram => must(decodeDiagram(x), "diagram");
const doc = (x: EDN): HierarchyDocument => must(decodeHierarchyDocument(x), "doc");
const edge = (x: EDN): Edge => must(decodeEdge(x), "edge");
const edges = (x: EDN): Edge[] => (items(x) ?? []).map(edge);
const path = (x: EDN): NodeID[] => (items(x) ?? []).flatMap((e) => idName(e) ?? []);
const entries = (x: EDN) => (items(x) ?? []).flatMap((e) => decodeNSEntry(e) ?? []);
const nullable = (x: EDN | undefined): EDN => (x === undefined ? null : x);

function ranks(x: EDN): Policy.Ranks {
  const out: Policy.Ranks = new Map();
  for (const [k, v] of asMap(x) ?? []) {
    const id = idName(k);
    const r = integer(v);
    if (id !== undefined && r !== undefined) out.set(id, r);
  }
  return out;
}

const namedProposals = (x: EDN) => Policy.namedProposalsOf(get(x, "proposals") ?? null, get(x, "proposal") ?? null);

const levelGroups = (x: EDN) => Policy.levelGroupsOf(get(x, "levels") ?? null, () => Policy.proposalLayersOfRaw(x));

export function run(call: Call): EDN {
  const a = call.args;
  const arg = (i: number): EDN => {
    if (i >= a.length) throw new BadArgs(call.fn);
    return a[i] as EDN;
  };

  switch (call.fn) {
    // ---------- config ----------
    case "config/crap-band":
      return kw(Grades.crapBand(num(arg(0))));
    case "config/mutation-band":
      return kw(Grades.mutationBand(num(arg(0))));
    case "config/crap-grade":
      return Grades.crapGrade(num(arg(0)));
    case "config/mutation-grade":
      return Grades.mutationGrade(num(arg(0)));
    case "config/crap-risk":
      return nullable(Grades.crapRisk(decodeCrapSummary(arg(0))));
    case "config/mutation-ratio": {
      const m = arg(0);
      if (!asMap(m)) return null;
      return nullable(
        Grades.mutationRatio({
          killed: integer(get(m, "killed")),
          survived: integer(get(m, "survived")),
          uncovered: integer(get(m, "uncovered")),
          mutGap: integer(get(m, "mut-gap")),
        }),
      );
    }
    case "config/combined-grade":
      return nullable(Grades.combinedGrade(num(arg(0)), num(arg(1))));
    case "config/function-weight":
      return Grades.functionWeight(cls(arg(0)));
    case "config/pool-crap":
      return nullable(crapSummaryEDN(Grades.poolCrap((items(arg(0)) ?? []).map(cls), a.length > 1 && truthy(a[1]))));
    case "config/summarize-scores": {
      // `score-of` each item: a number, or a map's :mu.
      const scores = (items(arg(0)) ?? []).flatMap((x) => num(x) ?? num(get(x, "mu")) ?? []);
      return nullable(crapSummaryEDN(Grades.summarizeScores(scores)));
    }
    case "config/pool-mutants":
      return nullable(mutantsEDN(Grades.poolMutants((items(arg(0)) ?? []).map(cls))));

    // ---------- ir ----------
    case "ir/normalize":
      return diagramEDN(IR.normalize(arg(0)));
    case "ir/class-index":
      return new EDNMap([...IR.classIndex(diagram(arg(0)))].map(([id, c]) => [kw(id), classEDN(c)]));

    // ---------- policy ----------
    case "policy/omitted-id?":
      return Policy.omittedID(must(idName(arg(0)), "id"), path(arg(1)));
    case "policy/kind-rank":
      return Policy.kindRank(idName(arg(0)) ?? "");
    case "policy/nse-ids":
      return Policy.nseIDs(entries(arg(0))).map(kw);
    case "policy/normalize-proposal": {
      const n = Policy.normalizeProposal(arg(0));
      return n ? normalizedEDN(n) : null;
    }
    case "policy/named-proposals":
      return namedProposals(arg(0)).map(namedProposalEDN);
    case "policy/proposal-by-id": {
      const id = idName(arg(1));
      const p = id === undefined ? undefined : namedProposals(arg(0)).find((x) => x.id === id);
      return p ? namedProposalEDN(p) : null;
    }
    case "policy/proposal-layers":
      return Policy.proposalLayersOfRaw(arg(0)).map(layerEDN);
    case "policy/level-groups":
      return levelGroups(arg(0)).map((g) => g.map(kw));
    case "policy/level-ranks":
      return ranksEDN(Policy.ranksOf(levelGroups(arg(0))));
    case "policy/ranks-from-layers": {
      const groups = (items(arg(0)) ?? []).map((layer) =>
        asMap(layer) ? Policy.nseIDs(entries(get(layer, "nses") ?? null)) : path(layer),
      );
      return ranksEDN(Policy.ranksOf(groups));
    }
    case "policy/rank-of":
      return nullable(Policy.rankOf(must(idName(arg(0)), "id"), ranks(arg(1))));
    case "policy/violating-dependency?":
      return Policy.violatingDependency(edge(arg(0)), ranks(arg(1)));
    case "policy/mark-violations":
      return Policy.markViolations(edges(arg(0)), ranks(arg(1))).map(edgeEDN);
    case "policy/restamp-ranks": {
      const r = Policy.restampRanks((items(arg(0)) ?? []).map(cls), edges(arg(1)), ranks(arg(2)));
      return new EDNMap([
        [kw("classes"), r.classes.map(classEDN)],
        [kw("edges"), r.edges.map(edgeEDN)],
      ]);
    }
    case "policy/merge-edges":
      return Policy.mergeEdges(edges(arg(0))).map(edgeEDN);
    case "policy/apply-edge-kinds": {
      const kinds = new Map<string, EdgeKind>();
      for (const [k, v] of asMap(arg(1)) ?? []) {
        const p = decodeEdgePair(k);
        const kind = idName(v);
        if (p && kind !== undefined) kinds.set(pairKey(p), kind);
      }
      const omit = (items(arg(2)) ?? []).flatMap((x) => decodeEdgePair(x) ?? []);
      return Policy.applyEdgeKinds(edges(arg(0)), kinds, omit).map(edgeEDN);
    }

    // ---------- hierarchy ----------
    case "hierarchy/nodes-at":
      return Hierarchy.nodesAt((items(arg(0)) ?? []).map(cls), path(arg(1))).map(kw);
    case "hierarchy/view-at":
      return diagramEDN(Hierarchy.viewAt(doc(arg(0)), path(arg(1))));
    case "hierarchy/proposal-view":
      return diagramEDN(Hierarchy.proposalView(doc(arg(0)), a.length > 1 ? idName(a[1]) : undefined));
    case "hierarchy/layer-view":
      return diagramEDN(Hierarchy.layerView(doc(arg(0)), idName(arg(1)), must(idName(arg(2)), "package id")));
    case "hierarchy/collapse-arrows":
      return diagramEDN(Hierarchy.collapseArrows(diagram(arg(0))));
    case "hierarchy/apply-declutter": {
      const mode = idName(arg(1)) ?? "full";
      const declutter = (Hierarchy.DECLUTTER_MODES as readonly string[]).includes(mode === "methods" ? "elements" : mode)
        ? ((mode === "methods" ? "elements" : mode) as Hierarchy.Declutter)
        : "full";
      return diagramEDN(Hierarchy.applyDeclutter(diagram(arg(0)), declutter));
    }

    // ---------- overlay ----------
    case "overlay/class-namespace":
      return nullable(cls(arg(0)).ns);
    case "overlay/overlay-class": {
      const metrics = metricsFromEDN(new EDNMap([[kw("crap"), arg(1)], [kw("mutate"), arg(2)]]));
      const owned = a.length > 3 ? items(a[3])?.flatMap((x) => text(x) ?? []) : undefined;
      return classEDN(overlayClass(cls(arg(0)), metrics, owned));
    }
    case "overlay/apply-metrics": {
      const d = arg(0);
      const metrics = metricsFromEDN(arg(1));
      if (truthy(get(d, "hierarchical")) || get(d, "diagrams") !== undefined) {
        return documentEDN(applyMetrics(IR.documentFrom(d), metrics));
      }
      return diagramEDN(applyMetricsToDiagram(diagram(d), metrics));
    }

    default:
      throw new Unsupported(call.fn);
  }
}
