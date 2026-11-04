import { EDNSet, keywordName, kw } from "../edn/value";
import { poolCrap, poolMutants } from "./grades";
import {
  newClass,
  newDiagram,
  newPackage,
  type ContentEntry,
  type Diagram,
  type DiagramClass,
  type Edge,
  type HierarchyDocument,
  type LeafDep,
  type Mutants,
  type NodeID,
  type NSEntry,
  type Package,
  type PortDep,
} from "./model";
import {
  PROPOSAL_NOTICE,
  applyDocEdgeKinds,
  groupByPair,
  kindRank,
  markViolations,
  maxKeyLast,
  mergeEdges,
  namedProposals,
  normalizeProposal,
  nseIDs,
  omittedID,
  proposalByID,
  ranksFromLayers,
  restampRanks,
  type NamedProposal,
  type NormalizedProposal,
} from "./policy";

/**
 * Namespace-tree views (umlviewer `Hierarchy.swift`, Clojure
 * `uml-viewer.domain.hierarchy`): one level of children as boxes, edges
 * collapsed to that level, proposal views, and declutter.
 */

/** Declutter modes, in the order the Declutter button cycles them. */
export const DECLUTTER_MODES = ["full", "arrows", "triangles", "elements", "classes"] as const;
export type Declutter = (typeof DECLUTTER_MODES)[number];

export function nextDeclutter(mode: Declutter): Declutter {
  return DECLUTTER_MODES[(DECLUTTER_MODES.indexOf(mode) + 1) % DECLUTTER_MODES.length] ?? "full";
}

// ---------- ids ----------

/** `str/split` on dots, which drops trailing empty parts. */
export function segs(id: NodeID): string[] {
  const parts = id.split(".");
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

const lastSeg = (id: NodeID): string => segs(id).at(-1) as string;

const arrayStartsWith = (xs: readonly string[], prefix: readonly string[]) => prefix.every((p, i) => xs[i] === p);

/** The node at `path` or one of its descendants. */
function isUnder(id: NodeID, path: readonly NodeID[]): boolean {
  const s = segs(id);
  return s.length >= path.length && arrayStartsWith(s, path);
}

function childID(id: NodeID, path: readonly NodeID[]): NodeID | undefined {
  if (!isUnder(id, path)) return undefined;
  const s = segs(id);
  return s.length === path.length ? id : s.slice(0, path.length + 1).join(".");
}

function labelPart(part: string): string {
  const [first = "", ...rest] = Array.from(part);
  const tail = rest.join("");
  return first.toUpperCase() + (/[A-Z]/.test(part) ? tail : tail.toLowerCase());
}

/** `source-clojure` -> `SourceClojure`; `tauriFs` -> `TauriFs`. */
export function nodeLabel(id: NodeID): string {
  return lastSeg(id)
    .split("-")
    .filter((p) => p !== "" && !/^\s+$/.test(p))
    .map(labelPart)
    .join("");
}

function moduleName(c: DiagramClass): string {
  return c.proposalGroup ? (c.name ?? nodeLabel(c.id)) : nodeLabel(c.id);
}

/** Last path segment of `file`, or undefined (`graph/file-base`). */
export function fileBase(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const parts = file.replaceAll("\\", "/").split("/");
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  const n = parts.at(-1) as string;
  return /^\s*$/.test(n) ? undefined : n;
}

const isRustFile = (file: string | undefined) => fileBase(file)?.toLowerCase().endsWith(".rs") ?? false;

/** Directories use the namespace segment; every Rust source file is named by its filename. */
function boxName(leaf: DiagramClass | undefined, id: NodeID, directory: boolean): string {
  if (!directory && isRustFile(leaf?.file)) return fileBase(leaf?.file) as string;
  return nodeLabel(id);
}

const hasDescendants = (id: NodeID, classes: DiagramClass[]) => classes.some((c) => c.id.startsWith(id + "."));

function index(classes: DiagramClass[]): Map<NodeID, DiagramClass> {
  return new Map(classes.map((c) => [c.id, c]));
}

/** Order listed in `order` (last listing wins), then by id. */
function sortIDs(ids: NodeID[], order: NodeID[]): NodeID[] {
  const rank = new Map<NodeID, number>();
  order.forEach((id, i) => rank.set(id, i));
  const n = rank.size;
  return ids
    .map((id, offset) => ({ id, offset }))
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? n;
      const rb = rank.get(b.id) ?? n;
      if (ra !== rb) return ra - rb;
      // JS string order is UTF-16 code units, like Java's compareTo.
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return a.offset - b.offset;
    })
    .map((x) => x.id);
}

/** Immediate child ids of `path`, including a self-module when it exists. */
export function nodesAt(classes: DiagramClass[], path: readonly NodeID[]): NodeID[] {
  const seen = new Set<NodeID>();
  const out: NodeID[] = [];
  for (const c of classes) {
    if (c.foreign) continue;
    const id = childID(c.id, path);
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------- view boxes ----------

function contents(classes: DiagramClass[], path: readonly NodeID[], node: NodeID): ContentEntry[] {
  const kids = nodesAt(classes, [...path, lastSeg(node)]);
  if (!kids.some((k) => k !== node)) return [];
  const byID = index(classes);
  return kids.map((cid) => {
    const directory = cid !== node && hasDescendants(cid, classes);
    return { id: cid, name: boxName(byID.get(cid), cid, directory), drill: directory };
  });
}

const isUnderID = (c: DiagramClass, id: NodeID) => c.id === id || c.id.startsWith(id + ".");

function maxOf(xs: (number | undefined)[]): number | undefined {
  const ns = xs.filter((x): x is number => x !== undefined);
  return ns.length === 0 ? undefined : Math.max(...ns);
}

function ownMutants(leaf: DiagramClass | undefined): Mutants | undefined {
  if (!leaf || (leaf.killed === undefined && leaf.survived === undefined)) return undefined;
  return { killed: leaf.killed, survived: leaf.survived, uncovered: leaf.uncovered };
}

/** `merge` of a mutants map: keys it has replace the box's. */
function mergeMutants(c: DiagramClass, m: Mutants): DiagramClass {
  const out = { ...c };
  if (m.killed !== undefined) out.killed = m.killed;
  if (m.survived !== undefined) out.survived = m.survived;
  if (m.uncovered !== undefined) out.uncovered = m.uncovered;
  if (m.mutGap !== undefined) out.mutGap = m.mutGap;
  return out;
}

function viewClass(
  idx: Map<NodeID, DiagramClass>,
  classes: DiagramClass[],
  path: readonly NodeID[],
  id: NodeID,
): DiagramClass {
  const leaf = idx.get(id);
  const kids = contents(classes, path, id);
  const drill = kids.length > 0;
  const under = classes.filter((c) => isUnderID(c, id));
  // Scores: a directory pools its subtree; a file keeps its own.
  const crap = drill ? poolCrap(under) : leaf?.crap?.mu !== undefined ? leaf.crap : undefined;
  const mutants = drill ? poolMutants(under) : ownMutants(leaf);
  const box: DiagramClass = {
    ...newClass(id, boxName(leaf, id, drill)),
    drill,
    ns: leaf?.ns,
    lang: leaf?.lang,
    file: leaf?.file,
    level: maxOf(under.map((c) => c.level)),
    stereotype: leaf?.stereotype,
    crap,
    coverage: leaf?.coverage,
    ops: leaf?.ops ?? [],
    fields: leaf?.fields ?? [],
    hideMembers: drill,
    contents: kids,
  };
  return mutants ? mergeMutants(box, mutants) : box;
}

// ---------- edges at a level ----------

interface Parts {
  inView: Edge[];
  inPorts: Map<NodeID, PortDep[]>;
  outPorts: Map<NodeID, PortDep[]>;
  foreign: DiagramClass[];
  foreignEdges: Edge[];
}

function collapseEnd(id: NodeID, path: readonly NodeID[], idx: Map<NodeID, DiagramClass>): NodeID | undefined {
  return idx.get(id)?.foreign ? id : childID(id, path);
}

function externalEnd(id: NodeID, path: readonly NodeID[], idx: Map<NodeID, DiagramClass>): DiagramClass | undefined {
  const c = idx.get(id);
  if (c?.foreign) return { ...newClass(id, c.name ?? id), foreign: true };
  if (isUnder(id, path)) return undefined;
  const ext = segs(id).slice(0, Math.max(1, path.length)).join(".");
  return { ...newClass(ext, nodeLabel(ext)), external: true };
}

function addPort(m: Map<NodeID, PortDep[]>, box: NodeID, dep: DiagramClass): void {
  const cur = m.get(box) ?? [];
  if (cur.some((p) => p.id === dep.id)) return;
  m.set(box, [...cur, { id: dep.id, name: dep.name }]);
}

function addForeign(acc: Parts, box: NodeID, dep: DiagramClass, e: Edge): void {
  acc.foreignEdges.push({ ...e, from: box, to: dep.id });
  if (!acc.foreign.some((f) => f.id === dep.id)) {
    acc.foreign.push({ ...newClass(dep.id, dep.name), foreign: true, shape: "oval" });
  }
}

/**
 * In-view edges stay arrows, foreign libraries become ovals, and other
 * off-view dependencies become ports.
 */
function partition(edges: Edge[], ids: Set<NodeID>, path: readonly NodeID[], idx: Map<NodeID, DiagramClass>): Parts {
  const acc: Parts = { inView: [], inPorts: new Map(), outPorts: new Map(), foreign: [], foreignEdges: [] };
  for (const e of edges) {
    const from = collapseEnd(e.from, path, idx);
    const toIn = collapseEnd(e.to, path, idx);
    const fromHere = from !== undefined && ids.has(from);
    const toHere = toIn !== undefined && ids.has(toIn);
    const toExt = toHere ? undefined : externalEnd(e.to, path, idx);
    const fromExt = fromHere ? undefined : externalEnd(e.from, path, idx);
    if (fromHere && toHere && from !== toIn) acc.inView.push({ ...e, from: from as NodeID, to: toIn as NodeID });
    else if (fromHere && toExt?.foreign) addForeign(acc, from as NodeID, toExt, e);
    else if (fromHere && toExt) addPort(acc.outPorts, from as NodeID, toExt);
    // Drawn from the box to the oval, as the Clojure code does.
    else if (toHere && fromExt?.foreign) addForeign(acc, toIn as NodeID, fromExt, e);
    else if (toHere && fromExt) addPort(acc.inPorts, toIn as NodeID, fromExt);
  }
  return acc;
}

function orderAt(doc: HierarchyDocument, path: readonly NodeID[]): NodeID[] {
  if (doc.order.kind === "list") return path.length === 0 ? doc.order.ids : [];
  return doc.order.paths.get(path.join(".")) ?? [];
}

// ---------- namespace tree ----------

/** One diagram: the children of `path` as boxes, edges collapsed to that level. */
export function viewAt(doc: HierarchyDocument, path: readonly NodeID[]): Diagram {
  const classes = doc.classes.filter((c) => !omittedID(c.id, doc.omit));
  const idx = index(classes);
  const nodeIDs = sortIDs(nodesAt(classes, path), orderAt(doc, path));
  const boxes = nodeIDs.map((id) => viewClass(idx, classes, path, id));
  const ids = new Set(boxes.map((b) => b.id));
  const parts = partition(doc.edges, ids, path, idx);
  const visible = new Set([...ids, ...parts.foreign.map((f) => f.id)]);
  const edges = applyDocEdgeKinds(mergeEdges([...parts.inView, ...parts.foreignEdges]), doc).filter(
    (e) => visible.has(e.from) && visible.has(e.to),
  );
  const label = path.length === 0 ? (doc.title ?? "UML") : path.join(".");
  return {
    ...newDiagram(label),
    packages: [
      newPackage(
        "view",
        label,
        boxes.map((b) => ({ ...b, inDeps: parts.inPorts.get(b.id) ?? [], outDeps: parts.outPorts.get(b.id) ?? [] })),
      ),
    ],
    edges,
    foreign: parts.foreign,
  };
}

// ---------- declutter ----------

function ownerPackage(view: Diagram, id: NodeID): NodeID | undefined {
  return view.packages.find((p) => p.classes.some((c) => c.id === id))?.id;
}

function mergeDirectionEdges(edges: Edge[]): Edge[] {
  return groupByPair(edges).map((es) => {
    const violating = es.some((e) => e.violating);
    const best = violating ? (es.find((e) => e.violating) ?? (es[0] as Edge)) : maxKeyLast(es, (e) => kindRank(e.kind));
    const via = new EDNSet();
    for (const e of es) {
      for (const id of [e.from, e.to, e.origFrom, e.origTo]) if (id !== undefined) via.add(kw(id));
    }
    const deps: LeafDep[] = es.map((e) => ({ from: e.origFrom ?? e.from, to: e.origTo ?? e.to, violating: e.violating }));
    return {
      ...best,
      kind: violating ? "dependency" : best.kind,
      violating,
      origFrom: undefined,
      origTo: undefined,
      viaIDs: via.items.map((k) => keywordName(k) as string),
      deps,
    };
  });
}

function packageDummy(p: Package): DiagramClass {
  return { ...newClass(p.id, p.label ?? p.id), dummy: true, drill: true, hideMembers: true };
}

/** Pooled CRAP, mutants, and outermost level of `classes` onto `box`. */
function withMetrics(box: DiagramClass, classes: DiagramClass[]): DiagramClass {
  let d: DiagramClass = {
    ...box,
    crap: poolCrap(classes),
    killed: undefined,
    survived: undefined,
    uncovered: undefined,
    mutGap: undefined,
  };
  const m = poolMutants(classes);
  if (m) d = mergeMutants(d, m);
  const lv = maxOf(classes.map((c) => c.level));
  if (lv !== undefined) d.level = lv;
  return d;
}

function ensurePackageDummies(view: Diagram): Diagram {
  return {
    ...view,
    packages: view.packages.map((p) =>
      p.classes.some((c) => c.id === p.id) ? p : { ...p, classes: [withMetrics(packageDummy(p), p.classes), ...p.classes] },
    ),
  };
}

/**
 * One edge per direction between layers. Several packages collapse to
 * package ids; a single wrapping package collapses by box id.
 */
export function collapseArrows(view: Diagram): Diagram {
  const multi = view.packages.length > 1;
  const v = multi ? ensurePackageDummies(view) : view;
  const known = new Set([...v.packages.flatMap((p) => p.classes.map((c) => c.id)), ...v.foreign.map((c) => c.id)]);
  const remap = (id: NodeID) => (multi ? (ownerPackage(v, id) ?? id) : id);
  const edges = v.edges
    .map((e) => ({ ...e, origFrom: e.from, origTo: e.to, from: remap(e.from), to: remap(e.to) }))
    .filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  return { ...v, edges: mergeDirectionEdges(edges) };
}

const mapClasses = (view: Diagram, f: (c: DiagramClass) => DiagramClass): Diagram => ({
  ...view,
  packages: view.packages.map((p) => ({ ...p, classes: p.classes.map(f) })),
});

/** Drop nested names, members, and ports from class boxes. */
export function hideElements(view: Diagram): Diagram {
  return mapClasses(view, (c) => ({ ...c, contents: [], inDeps: [], outDeps: [], hideMembers: true }));
}

/**
 * Keep layer boxes and drop the classes inside them. A single wrapping
 * package keeps its boxes and empties their contents.
 */
export function hideClasses(view: Diagram): Diagram {
  if (view.packages.length > 1) {
    return {
      ...view,
      packages: view.packages.map((p) => {
        const real = p.classes.filter((c) => !c.dummy);
        const dummy = withMetrics(p.classes.find((c) => c.dummy) ?? packageDummy(p), real);
        return { ...p, classes: [dummy], nses: real.map((c) => c.id) };
      }),
    };
  }
  return {
    ...view,
    packages: view.packages.map((p) => ({
      ...p,
      classes: p.classes.filter((c) => !c.dummy).map((c) => ({ ...c, contents: [], hideMembers: true })),
    })),
  };
}

export function applyDeclutter(view: Diagram, mode: Declutter): Diagram {
  let v = view;
  if (mode !== "full") v = collapseArrows(v);
  if (mode === "triangles") v = { ...v, hideEdges: true };
  if (mode === "elements" || mode === "classes") v = hideElements(v);
  if (mode === "classes") v = hideClasses(v);
  return v;
}

// ---------- proposals ----------

const idUnder = (id: NodeID, nse: NodeID) => id === nse || id.startsWith(nse + ".");

function claimedCovers(id: NodeID, claimed: Set<NodeID>): boolean {
  for (const c of claimed) if (idUnder(id, c) || idUnder(c, id)) return true;
  return false;
}

/** `id` onto a visible box: itself, its nested group, then a dotted ancestor. */
function coveringVisible(id: NodeID, visible: Set<NodeID>, owners: Map<NodeID, NodeID>): NodeID | undefined {
  if (visible.has(id)) return id;
  const g = owners.get(id);
  if (g !== undefined && visible.has(g)) return g;
  const parts = segs(id);
  for (let n = parts.length - 1; n > 0; n--) {
    const k = parts.slice(0, n).join(".");
    if (visible.has(k)) return k;
  }
  return undefined;
}

function remapProposalEdges(edges: Edge[], visible: Set<NodeID>, owners: Map<NodeID, NodeID>): Edge[] {
  return edges.flatMap((e) => {
    const from = coveringVisible(e.from, visible, owners);
    const to = coveringVisible(e.to, visible, owners);
    return from === undefined || to === undefined || from === to ? [] : [{ ...e, from, to }];
  });
}

/** Leaf id -> nested group id; an inner group wins over an outer one. */
function groupOwners(nses: NSEntry[], owners: Map<NodeID, NodeID>): void {
  for (const e of nses) {
    if (e.kind !== "group") continue;
    for (const leaf of nseIDs(e.nses)) owners.set(leaf, e.id);
    groupOwners(e.nses, owners);
  }
}

function nestedGroupBox(id: NodeID, label: string, nses: NSEntry[], kids: DiagramClass[]): DiagramClass {
  const box: DiagramClass = {
    ...newClass(id, label),
    drill: true,
    proposalGroup: true,
    nses,
    members: kids,
    hideMembers: true,
    contents: kids.map((k) => ({ id: k.id, name: moduleName(k), drill: k.drill })),
    crap: poolCrap(kids),
    level: maxOf(kids.map((k) => k.level)),
  };
  const m = poolMutants(kids);
  return m ? mergeMutants(box, m) : box;
}

function resolve(doc: HierarchyDocument, which: NodeID | undefined): NamedProposal | undefined {
  return proposalByID(doc, which) ?? namedProposals(doc)[0];
}

function chosen(doc: HierarchyDocument, named: NamedProposal | undefined): NormalizedProposal | undefined {
  if (named && named.layers.length > 0) return { notice: named.notice, layers: named.layers, omit: named.omit };
  return normalizeProposal(doc.proposal);
}

const asModule = (c: DiagramClass): DiagramClass => ({ ...c, name: moduleName(c) });

function pick(byID: Map<NodeID, DiagramClass>, stamped: DiagramClass[], entry: NSEntry): DiagramClass[] {
  if (entry.kind === "group") {
    const kids = entry.nses.flatMap((e) => pick(byID, stamped, e));
    return kids.length === 0 ? [] : [nestedGroupBox(entry.id, entry.label, entry.nses, kids)];
  }
  const c = byID.get(entry.id);
  if (c) return [asModule(c)];
  return stamped.filter((s) => idUnder(s.id, entry.id)).map(asModule);
}

/**
 * Root view with named proposal packages around real namespaces. Package
 * ids are `proposal.<layer>`; a nested group map becomes a child component
 * inside its layer. `which` undefined (or unknown) is the first proposal.
 */
export function proposalView(doc: HierarchyDocument, which?: NodeID): Diagram {
  const root = viewAt(doc, []);
  const named = resolve(doc, which);
  const proposal = chosen(doc, named);
  const layers = proposal?.layers ?? [];
  const ranks = ranksFromLayers(layers);
  const omit = [...doc.omit, ...(proposal?.omit ?? [])];
  const omitSet = new Set(omit);
  const leaves = doc.classes.filter((c) => !c.foreign && !omittedID(c.id, omit));
  const stamped = restampRanks(leaves, [], ranks).classes;
  const byID = index(stamped);
  const claimed = new Set(layers.flatMap((l) => nseIDs(l.nses)));
  const extras = stamped.filter((c) => !(claimedCovers(c.id, claimed) || omitSet.has(c.id) || omittedID(c.id, omit)));
  const pkgs = layers.flatMap((layer) => {
    const cs = layer.nses.flatMap((e) => pick(byID, stamped, e));
    return cs.length === 0 ? [] : [newPackage(`proposal.${layer.id}`, layer.label, cs)];
  });
  if (extras.length > 0) pkgs.push(newPackage("proposal.unassigned", "Unassigned", extras.map(asModule)));
  pkgs.reverse();
  if (pkgs.length === 0) return root;

  const visible = new Set([...pkgs.flatMap((p) => p.classes.map((c) => c.id)), ...root.foreign.map((f) => f.id)]);
  const owners = new Map<NodeID, NodeID>();
  for (const layer of layers) groupOwners(layer.nses, owners);
  const remapped = applyDocEdgeKinds(mergeEdges(remapProposalEdges(doc.edges, visible, owners)), doc);
  return {
    ...root,
    title: named?.notice ?? proposal?.notice ?? PROPOSAL_NOTICE,
    proposal: true,
    packages: pkgs,
    edges: markViolations(remapped, ranks),
  };
}

function groupsIn(nses: NSEntry[]): Extract<NSEntry, { kind: "group" }>[] {
  return nses.flatMap((e) => (e.kind === "group" ? [e, ...groupsIn(e.nses)] : []));
}

/** The nested group `id` in proposal `which`, or undefined. */
export function findNestedGroup(doc: HierarchyDocument, which: NodeID | undefined, id: NodeID | undefined): NSEntry | undefined {
  if (id === undefined) return undefined;
  const layers = chosen(doc, resolve(doc, which))?.layers ?? [];
  return layers.flatMap((l) => groupsIn(l.nses)).find((g) => g.id === id);
}

/** One proposal package as the diagram. A nested group id expands to its member classes. */
export function layerView(doc: HierarchyDocument, which: NodeID | undefined, packageID: NodeID): Diagram {
  const root = proposalView(doc, which);
  const pkg = root.packages.find((p) => p.id === packageID);
  if (pkg) return { ...root, title: pkg.label ?? packageID, packages: [pkg] };
  const box = root.packages.flatMap((p) => p.classes).find((c) => c.id === packageID);
  if (!box?.proposalGroup || box.members.length === 0) return root;
  const cs = box.members;
  const layers = chosen(doc, resolve(doc, which))?.layers ?? [];
  const visible = new Set([...cs.map((c) => c.id), ...root.foreign.map((f) => f.id)]);
  const remapped = applyDocEdgeKinds(mergeEdges(remapProposalEdges(doc.edges, visible, new Map())), doc);
  return {
    ...root,
    title: box.name ?? packageID,
    packages: [newPackage(packageID, box.name ?? packageID, cs)],
    edges: markViolations(remapped, ranksFromLayers(layers)),
  };
}

export const isProposalPackageID = (id: NodeID | undefined): boolean => id?.startsWith("proposal.") ?? false;
