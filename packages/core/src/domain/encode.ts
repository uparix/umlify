import { EDNMap, EDNSet, kw, type EDN } from "../edn/value";
import type {
  CrapMetric,
  CrapSummary,
  Diagram,
  DiagramClass,
  Edge,
  HierarchyDocument,
  Member,
  Mutants,
  NSEntry,
  Order,
  Package,
  PortDep,
  UMLDocument,
} from "./model";
import type { Layer, NamedProposal, NormalizedProposal, Ranks } from "./policy";

// Model -> EDN, as umlviewer's encoders write it. The overlay re-reads
// painted hand-drawn diagrams through it, and tests compare it with the
// Clojure goldens. Keys carrying nothing (undefined, nil, false, empty) are
// skipped, which the Clojure code never tells apart from a missing key.

const blank = (v: EDN | undefined): boolean =>
  v === undefined ||
  v === null ||
  v === false ||
  (Array.isArray(v) && v.length === 0) ||
  ((v instanceof EDNMap || v instanceof EDNSet) && v.size === 0);

function build(pairs: [string, EDN | undefined][]): EDNMap {
  return new EDNMap(pairs.filter(([, v]) => !blank(v)).map(([k, v]) => [kw(k), v as EDN]));
}

const keyword = (s: string | undefined): EDN | undefined => (s ? kw(s) : undefined);

export const crapSummaryEDN = (c: CrapSummary | undefined): EDN | undefined =>
  c && build([["mu", c.mu], ["max", c.max], ["sigma", c.sigma], ["n", c.n]]);

const crapMetricEDN = (c: CrapMetric | undefined): EDN | undefined => (typeof c === "number" ? c : crapSummaryEDN(c));

export const mutantsEDN = (m: Mutants | undefined): EDN | undefined =>
  m && build([["killed", m.killed], ["survived", m.survived], ["uncovered", m.uncovered], ["mut-gap", m.mutGap]]);

export const memberEDN = (m: Member): EDN =>
  build([
    ["text", m.text],
    ["name", m.name],
    ["args", m.args],
    ["type", m.type],
    ["returns", m.returns],
    ["cc", m.cc],
    ["crap", crapMetricEDN(m.crap)],
    ["coverage", m.coverage],
    ["killed", m.killed],
    ["survived", m.survived],
    ["uncovered", m.uncovered],
    ["sites", m.sites],
    ["private", m.isPrivate],
  ]);

export const nsEntryEDN = (e: NSEntry): EDN =>
  e.kind === "ns"
    ? kw(e.id)
    : new EDNMap([[kw("id"), kw(e.id)], [kw("label"), e.label], [kw("nses"), e.nses.map(nsEntryEDN)]]);

const portEDN = (p: PortDep): EDN => build([["id", keyword(p.id)], ["name", p.name]]);

export const classEDN = (c: DiagramClass): EDN =>
  build([
    ["id", keyword(c.id)],
    ["name", c.name],
    ["ns", c.ns],
    ["lang", keyword(c.lang)],
    ["file", c.file],
    ["level", c.level],
    ["stereotype", keyword(c.stereotype)],
    ["foreign", c.foreign],
    ["external", c.external],
    ["shape", keyword(c.shape)],
    ["package", keyword(c.package)],
    ["crap", crapSummaryEDN(c.crap)],
    ["coverage", c.coverage],
    ["cc", c.cc],
    ["killed", c.killed],
    ["survived", c.survived],
    ["uncovered", c.uncovered],
    ["mut-gap", c.mutGap],
    ["sites", c.sites],
    ["hide-members", c.hideMembers],
    ["fields", c.fields.map(memberEDN)],
    ["ops", c.ops.map(memberEDN)],
    ["drill?", c.drill],
    ["dummy?", c.dummy],
    ["proposal-group?", c.proposalGroup],
    ["contents", c.contents.map((e) => new EDNMap([[kw("id"), kw(e.id)], [kw("name"), e.name], [kw("drill?"), e.drill]]))],
    ["in-deps", c.inDeps.map(portEDN)],
    ["out-deps", c.outDeps.map(portEDN)],
    ["members", c.members.map(classEDN)],
    ["nses", c.nses.map(nsEntryEDN)],
  ]);

export const edgeEDN = (e: Edge): EDN =>
  build([
    ["from", keyword(e.from)],
    ["to", keyword(e.to)],
    ["kind", keyword(e.kind)],
    ["label", e.label],
    ["violating", e.violating],
    ["orig-from", keyword(e.origFrom)],
    ["orig-to", keyword(e.origTo)],
    ["via-ids", e.viaIDs && new EDNSet(e.viaIDs.map(kw))],
    [
      "deps",
      e.deps?.map(
        (d) => new EDNMap([[kw("from"), kw(d.from)], [kw("to"), kw(d.to)], [kw("violating"), d.violating]]),
      ),
    ],
  ]);

export const packageEDN = (p: Package): EDN =>
  build([
    ["id", keyword(p.id)],
    ["label", p.label],
    ["crap", crapSummaryEDN(p.crap)],
    ["classes", p.classes.map(classEDN)],
    ["nses", p.nses.map(kw)],
  ]);

export const diagramEDN = (d: Diagram): EDN =>
  build([
    ["title", d.title],
    ["direction", keyword(d.direction)],
    ["packages", d.packages.map(packageEDN)],
    ["foreign", d.foreign.map(classEDN)],
    ["edges", d.edges.map(edgeEDN)],
    ["hide-edges", d.hideEdges],
    ["proposal", d.proposal],
  ]);

export const layerEDN = (l: Layer): EDN =>
  new EDNMap([[kw("id"), kw(l.id)], [kw("label"), l.label], [kw("nses"), l.nses.map(nsEntryEDN)]]);

export const normalizedEDN = (n: NormalizedProposal): EDN =>
  new EDNMap([[kw("notice"), n.notice], [kw("layers"), n.layers.map(layerEDN)], [kw("omit"), n.omit.map(kw)]]);

export const namedProposalEDN = (p: NamedProposal): EDN =>
  new EDNMap([
    [kw("id"), kw(p.id)],
    [kw("name"), p.name],
    [kw("layers"), p.layers.map(layerEDN)],
    [kw("omit"), p.omit.map(kw)],
    [kw("notice"), p.notice],
  ]);

export const ranksEDN = (r: Ranks): EDN =>
  new EDNMap([...r].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [kw(k), v]));

const byKey = <T>(xs: [string, T][]): [string, T][] => xs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const orderEDN = (o: Order): EDN =>
  o.kind === "list"
    ? o.ids.map(kw)
    : new EDNMap(byKey([...o.paths]).map(([path, ids]) => [path, ids.map(kw)]));

export const hierarchyDocumentEDN = (h: HierarchyDocument): EDN =>
  build([
    ["hierarchical", true],
    ["title", h.title],
    ["prefix", h.prefix],
    ["order", orderEDN(h.order)],
    ["levels", h.levels],
    [
      "edge-kinds",
      // pairKey joins from and to with NUL; sorting the key sorts by (from, to).
      new EDNMap(byKey([...h.edgeKinds]).map(([k, kind]) => [k.split("\u0000").map(kw), kw(kind)])),
    ],
    ["omit-edges", h.omitEdges.map((p) => [kw(p.from), kw(p.to)])],
    ["omit", h.omit.map(kw)],
    ["classes", h.classes.map(classEDN)],
    ["edges", h.edges.map(edgeEDN)],
    ["proposals", h.proposals],
    ["proposal", h.proposal],
    ["policy-file", h.policyFile],
  ]);

export const documentEDN = (d: UMLDocument): EDN =>
  d.kind === "hierarchy"
    ? hierarchyDocumentEDN(d.doc)
    : new EDNMap([[kw("title"), d.title], [kw("diagrams"), d.diagrams.map(diagramEDN)]]);
