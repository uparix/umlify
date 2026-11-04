import { Keyword, Sym, asMap, get, idName, integer, items, name, num, printEDN, text, truthy, type EDN } from "../edn/value";
import {
  decodeHierarchyDocument,
  newClass,
  newDiagram,
  newEdge,
  newMember,
  newPackage,
  type CrapSummary,
  type Diagram,
  type DiagramClass,
  type Edge,
  type Member,
  type NodeID,
  type Package,
  type UMLDocument,
} from "./model";

/**
 * Reading IR files (umlviewer `IR.swift`, Clojure `uml-viewer.domain.ir`).
 * A hierarchical document is taken as written; hand-written diagrams are
 * validated and normalized.
 */

export class IRError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IRError";
  }
}

export function documentFrom(raw: EDN): UMLDocument {
  if (truthy(get(raw, "hierarchical"))) {
    const doc = decodeHierarchyDocument(raw);
    if (doc) return { kind: "hierarchy", doc };
  }
  const title = text(get(raw, "title")) ?? "UML";
  const diagrams = get(raw, "diagrams");
  if (truthy(diagrams)) return { kind: "diagrams", title, diagrams: (items(diagrams) ?? []).map(normalize) };
  return { kind: "diagrams", title, diagrams: [normalize(raw)] };
}

// ---------- normalize ----------

const fail = (message: string) => new IRError(message);
const present = (x: EDN | undefined): x is EDN => x !== undefined && x !== null;

export function asID(x: EDN): NodeID {
  if (x instanceof Keyword) return x.name;
  if (x instanceof Sym) return name(x) as string;
  if (typeof x === "string") return x.toLowerCase().replace(/\s+/g, "-");
  throw fail(`id must be a keyword or string: ${printEDN(x)}`);
}

export function asCrap(x: EDN | undefined): CrapSummary | undefined {
  if (!present(x)) return undefined;
  if (typeof x === "number") return { mu: x, max: x, sigma: 0 };
  if (!asMap(x)) throw fail(`crap must be a number or {:mu :max :sigma}: ${printEDN(x)}`);
  const mu = num(get(x, "mu"));
  const c: CrapSummary = {
    mu,
    max: num(get(x, "max")) ?? mu ?? 0,
    sigma: num(get(x, "sigma")) ?? num(get(x, "sd")) ?? 0,
  };
  const n = num(get(x, "n"));
  if (n !== undefined && n > 0) c.n = Math.trunc(n);
  return c;
}

export function asCoverage(x: EDN | undefined): number | undefined {
  if (!present(x)) return undefined;
  if (typeof x !== "number") throw fail(`coverage must be a number 0–1: ${printEDN(x)}`);
  if (Number.isNaN(x) || x < 0 || x > 1) throw fail(`coverage must be between 0 and 1: ${printEDN(x)}`);
  return x;
}

export function asCount(x: EDN | undefined): number | undefined {
  if (!present(x)) return undefined;
  if (typeof x !== "number" || !(x >= 0) || !Number.isInteger(x)) {
    throw fail(`killed/survived/uncovered must be a non-negative integer: ${printEDN(x)}`);
  }
  return x;
}

export function asCC(x: EDN | undefined): number | undefined {
  if (!present(x)) return undefined;
  if (typeof x !== "number" || !(x >= 0)) throw fail(`cc must be a non-negative number: ${printEDN(x)}`);
  return x;
}

const shown = (x: EDN) => text(x) ?? printEDN(x);

function memberText(x: EDN): string {
  const t = get(x, "text");
  if (truthy(t)) return shown(t as EDN);
  let s = text(get(x, "name")) ?? "";
  const args = items(get(x, "args"));
  if (args && args.length > 0) s += `(${args.map(shown).join(", ")})`;
  const type = get(x, "type");
  if (truthy(type)) s += ` : ${shown(type as EDN)}`;
  const returns = get(x, "returns");
  if (truthy(returns)) s += ` : ${shown(returns as EDN)}`;
  return s;
}

export function asMember(x: EDN): Member {
  if (typeof x === "string") return newMember(x);
  const m = asMap(x);
  if (!m) throw fail(`member must be a string or map: ${printEDN(x)}`);
  const out = newMember(memberText(x));
  const has = (k: string) => m.has(Keyword.of(k));
  if (has("coverage")) out.coverage = asCoverage(get(x, "coverage"));
  if (has("killed")) out.killed = asCount(get(x, "killed"));
  if (has("survived")) out.survived = asCount(get(x, "survived"));
  if (has("uncovered")) out.uncovered = asCount(get(x, "uncovered"));
  if (has("sites")) out.sites = asCount(get(x, "sites"));
  if (has("cc")) out.cc = asCC(get(x, "cc"));
  if (has("crap")) out.crap = asCrap(get(x, "crap"));
  if (get(x, "private") === true) out.isPrivate = true;
  if (has("name")) out.name = text(get(x, "name"));
  return out;
}

export function asClass(c: EDN): DiagramClass {
  const label = text(get(c, "name")) ?? name(get(c, "id"));
  if (label === undefined) throw fail(`class needs :name or :id: ${printEDN(c)}`);
  const out = newClass(asID(get(c, "id") ?? label), label);
  if (truthy(get(c, "foreign")) || idName(get(c, "shape")) === "oval") out.shape = "oval";
  out.stereotype = idName(get(c, "stereotype"));
  out.crap = asCrap(get(c, "crap"));
  out.coverage = asCoverage(get(c, "coverage"));
  out.cc = asCC(get(c, "cc"));
  out.killed = asCount(get(c, "killed"));
  out.survived = asCount(get(c, "survived"));
  out.uncovered = asCount(get(c, "uncovered"));
  out.sites = asCount(get(c, "sites"));
  out.hideMembers = truthy(get(c, "hide-members"));
  out.fields = (items(get(c, "fields")) ?? []).map(asMember);
  out.ops = (items(get(c, "ops")) ?? []).map(asMember);
  if (truthy(get(c, "ns"))) out.ns = text(get(c, "ns"));
  if (truthy(get(c, "lang"))) out.lang = idName(get(c, "lang"));
  if (truthy(get(c, "file"))) out.file = text(get(c, "file"));
  const level = get(c, "level");
  if (present(level)) out.level = integer(level);
  return out;
}

export function asPackage(p: EDN): Package {
  const label = text(get(p, "label")) ?? name(get(p, "id"));
  if (label === undefined) throw fail(`package needs :label or :id: ${printEDN(p)}`);
  const out = newPackage(asID(get(p, "id") ?? label), label, (items(get(p, "classes")) ?? []).map(asClass));
  out.crap = asCrap(get(p, "crap"));
  return out;
}

export function asEdge(e: EDN): Edge {
  const from = get(e, "from");
  const to = get(e, "to");
  if (!truthy(from) || !truthy(to)) throw fail(`edge needs :from and :to: ${printEDN(e)}`);
  return newEdge(
    asID(from as EDN),
    asID(to as EDN),
    idName(get(e, "kind")) ?? "association",
    text(get(e, "label")),
    get(e, "violating") === true,
  );
}

/** Validate and normalize one hand-written diagram. */
export function normalize(raw: EDN): Diagram {
  const d = newDiagram(text(get(raw, "title")) ?? "UML");
  d.direction = idName(get(raw, "direction")) ?? "tb";
  d.packages = (items(get(raw, "packages")) ?? []).map(asPackage);
  d.foreign = (items(get(raw, "foreign")) ?? []).map(asClass);
  d.edges = (items(get(raw, "edges")) ?? []).map(asEdge);

  const seen = new Set<NodeID>();
  for (const id of [...d.packages.flatMap((p) => p.classes.map((c) => c.id)), ...d.foreign.map((c) => c.id)]) {
    if (seen.has(id)) throw fail(`duplicate class id: :${id}`);
    seen.add(id);
  }
  for (const e of d.edges) {
    if (!seen.has(e.from)) throw fail(`edge :from unknown class :${e.from}`);
    if (!seen.has(e.to)) throw fail(`edge :to unknown class :${e.to}`);
  }
  return d;
}

/** Every class by id, with `package` set on packaged ones. */
export function classIndex(d: Diagram): Map<NodeID, DiagramClass> {
  const idx = new Map<NodeID, DiagramClass>();
  for (const p of d.packages) for (const c of p.classes) idx.set(c.id, { ...c, package: p.id });
  for (const c of d.foreign) idx.set(c.id, c);
  return idx;
}
