import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentFrom, readEDN, viewAt } from "../src";
import { newClass, newDiagram, newEdge, newMember, newPackage, type Diagram, type DiagramClass } from "../src/domain/model";
import { CARD, measureCard } from "../src/layout/card";
import { layoutDiagram, type Scene, type SceneNode } from "../src/layout/layout";
import { readFixture } from "./support/fixtures";
import { caseView, viewScenes } from "./support/views";

type Rect = { x: number; y: number; width: number; height: number };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

const onBorder = ([x, y]: [number, number], r: Rect, eps = 0.5) => {
  const inX = x >= r.x - eps && x <= r.x + r.width + eps;
  const inY = y >= r.y - eps && y <= r.y + r.height + eps;
  const onV = Math.abs(x - r.x) <= eps || Math.abs(x - (r.x + r.width)) <= eps;
  const onH = Math.abs(y - r.y) <= eps || Math.abs(y - (r.y + r.height)) <= eps;
  return (onV && inY) || (onH && inX);
};

/** What every scene must satisfy, whatever the input. */
function checkScene(s: Scene): string[] {
  const problems: string[] = [];
  const byID = new Map(s.nodes.map((n) => [n.id, n]));
  for (const [i, a] of s.nodes.entries()) {
    for (const b of s.nodes.slice(i + 1)) if (overlaps(a, b)) problems.push(`${a.id} overlaps ${b.id}`);
    if (a.x < 0 || a.y < 0 || a.x + a.width > s.width || a.y + a.height > s.height) problems.push(`${a.id} is outside the canvas`);
  }
  for (const f of s.frames) {
    for (const n of s.nodes) {
      const inside = n.package === f.id;
      if (inside && !contains(f, n)) problems.push(`${n.id} pokes out of frame ${f.id}`);
      if (!inside && overlaps(f, n)) problems.push(`${n.id} overlaps foreign frame ${f.id}`);
    }
  }
  for (const [i, a] of s.frames.entries()) for (const b of s.frames.slice(i + 1)) if (overlaps(a, b)) problems.push(`frames ${a.id} and ${b.id} overlap`);
  for (const e of s.edges) {
    const from = byID.get(e.from) as SceneNode;
    const to = byID.get(e.to) as SceneNode;
    if (e.points.length < 2) problems.push(`${e.id} has no route`);
    else {
      if (!onBorder(e.points[0] as [number, number], from)) problems.push(`${e.id} does not leave ${e.from}'s border`);
      if (!onBorder(e.points.at(-1) as [number, number], to)) problems.push(`${e.id} does not reach ${e.to}'s border`);
      e.points.slice(1).forEach((p, k) => {
        const q = e.points[k] as [number, number];
        if (p[0] !== q[0] && p[1] !== q[1]) problems.push(`${e.id} has a diagonal segment`);
      });
    }
    if (!e.d.startsWith("M")) problems.push(`${e.id} has no path data`);
  }
  return problems;
}

const box = (id: string, extra: Partial<DiagramClass> = {}): DiagramClass => ({ ...newClass(id, id), ...extra });

function diagram(classes: DiagramClass[], edges: [string, string][], direction = "tb"): Diagram {
  return {
    ...newDiagram("t"),
    direction,
    packages: [newPackage("view", "t", classes)],
    edges: edges.map(([f, t]) => newEdge(f, t, "dependency")),
  };
}

const node = (s: Scene, id: string) => s.nodes.find((n) => n.id === id) as SceneNode;

describe("layout of real views", () => {
  it.each(viewScenes)("%s satisfies the scene invariants", (file) => {
    const s = layoutDiagram(caseView(readFixture(file)));
    expect(s.nodes.length).toBeGreaterThan(0);
    expect(checkScene(s)).toEqual([]);
  });

  it("lays out the examples", () => {
    const read = (n: string) => documentFrom(readEDN(readFileSync(new URL(`../../../examples/${n}`, import.meta.url), "utf8")));
    const uv = read("uml-viewer.edn");
    const lib = read("library.edn");
    if (uv.kind !== "hierarchy" || lib.kind !== "diagrams") throw new Error("unexpected example kinds");
    for (const d of [viewAt(uv.doc, []), viewAt(uv.doc, ["engine"]), lib.diagrams[0] as Diagram]) {
      expect(checkScene(layoutDiagram(d))).toEqual([]);
    }
    expect(layoutDiagram(lib.diagrams[0] as Diagram).frames.map((f) => f.label)).toEqual(["Domain", "Application", "Adapters"]);
  });

  it("is the same for the same input", () => {
    const d = caseView(readFixture("scenes/uml-viewer-root-full.edn"));
    expect(JSON.stringify(layoutDiagram(d))).toBe(JSON.stringify(layoutDiagram(d)));
  });
});

describe("grid placement", () => {
  it("stacks levels with the highest on top", () => {
    const s = layoutDiagram(diagram([box("core", { level: 0 }), box("app", { level: 2 }), box("svc", { level: 1 })], []));
    expect(node(s, "app").y).toBeLessThan(node(s, "svc").y);
    expect(node(s, "svc").y).toBeLessThan(node(s, "core").y);
  });

  it("puts a module above what it depends on when there are no levels", () => {
    const s = layoutDiagram(diagram([box("c"), box("b"), box("a")], [["a", "b"], ["b", "c"], ["a", "c"]]));
    expect(node(s, "a").y).toBeLessThan(node(s, "b").y);
    expect(node(s, "b").y).toBeLessThan(node(s, "c").y);
  });

  it("orders by dependency when every class has the same level", () => {
    const s = layoutDiagram(diagram([box("b", { level: 1 }), box("a", { level: 1 })], [["a", "b"]]));
    expect(node(s, "a").y).toBeLessThan(node(s, "b").y);
  });

  it("orders columns to uncross arrows", () => {
    // Input order a, b over c, d with a -> d and b -> c crosses; the sweeps swap one row.
    const s = layoutDiagram(diagram([box("a", { level: 1 }), box("b", { level: 1 }), box("c", { level: 0 }), box("d", { level: 0 })], [["a", "d"], ["b", "c"]]));
    const leftOf = (p: string, q: string) => node(s, p).x < node(s, q).x;
    expect(leftOf("a", "b")).toBe(leftOf("d", "c"));
  });

  it("survives a dependency cycle", () => {
    const s = layoutDiagram(diagram([box("a"), box("b"), box("c")], [["a", "b"], ["b", "c"], ["c", "a"]]));
    expect(new Set(s.nodes.map((n) => n.row)).size).toBeGreaterThan(1);
    expect(checkScene(s)).toEqual([]);
  });

  it("wraps a row longer than six boxes", () => {
    const s = layoutDiagram(diagram(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => box(id)), []));
    expect(new Set(s.nodes.map((n) => n.row))).toEqual(new Set([0, 1]));
  });

  it("places foreign libraries below every box", () => {
    const d: Diagram = {
      ...diagram([box("app", { level: 1 }), box("core", { level: 0 })], [["app", "core"]]),
      foreign: [{ ...newClass("ring", "ring"), foreign: true, shape: "oval" }],
    };
    d.edges.push(newEdge("app", "ring", "dependency"));
    const s = layoutDiagram(d);
    expect(node(s, "ring").kind).toBe("oval");
    expect(node(s, "ring").y).toBeGreaterThan(node(s, "core").y + node(s, "core").height);
  });

  it("runs left to right for :direction :lr", () => {
    const s = layoutDiagram(diagram([box("b"), box("a")], [["a", "b"]], "lr"));
    expect(node(s, "a").x).toBeLessThan(node(s, "b").x);
    expect(node(s, "a").y).toBe(node(s, "b").y);
  });

  it("frames each package when there are several", () => {
    const d: Diagram = {
      ...newDiagram("t"),
      packages: [newPackage("outer", "Outer", [box("a")]), newPackage("inner", "Inner", [box("b")])],
      edges: [newEdge("a", "b", "dependency")],
    };
    const s = layoutDiagram(d);
    expect(s.frames.map((f) => f.label)).toEqual(["Outer", "Inner"]);
    expect(checkScene(s)).toEqual([]);
  });

  it("routes a generalization vertically between facing sides", () => {
    // Like any dependent, the implementation sits above its interface.
    const d: Diagram = { ...diagram([box("impl"), box("api")], []), edges: [newEdge("impl", "api", "implements")] };
    const e = layoutDiagram(d).edges[0];
    expect([e?.fromSide, e?.toSide]).toEqual(["bottom", "top"]);
  });
});

describe("cards", () => {
  it("shows a folder's children and hides its members", () => {
    const c = box("engine", {
      hideMembers: true,
      ops: [newMember("layout")],
      contents: [
        { id: "engine.route", name: "Route", drill: false },
        { id: "engine.sub", name: "Sub", drill: true },
      ],
    });
    const card = measureCard(c, "Engine");
    expect(card.compartments.map((k) => k.kind)).toEqual(["contents"]);
    expect(card.compartments[0]?.rows.map((r) => r.text)).toEqual(["Route", "Sub/"]);
  });

  it("shows fields and public ops, not private ones", () => {
    const c = box("cart", {
      fields: [newMember("items : Item[]")],
      ops: [newMember("add-item"), { ...newMember("total"), isPrivate: true }],
    });
    expect(measureCard(c, "Cart").compartments[0]?.rows.map((r) => r.text)).toEqual(["items : Item[]", "add-item"]);
  });

  it("lists ports to off-level dependencies", () => {
    const c = box("cart", { inDeps: [{ id: "web", name: "Web" }], outDeps: [{ id: "db" }] });
    expect(measureCard(c, "Cart").compartments[0]?.rows.map((r) => r.text)).toEqual(["← Web", "→ db"]);
  });

  it("keeps archify's width range and wraps long members", () => {
    expect(measureCard(box("a"), "A").width).toBe(CARD.minW);
    const long = measureCard(box("a", { ops: [newMember("x".repeat(30) + "(alpha, beta, gamma, delta) : Result")] }), "A");
    expect(long.width).toBe(CARD.maxW);
    expect(long.compartments[0]?.rows[0]?.lines.length).toBeGreaterThan(1);
  });

  it("gives a stereotype a taller, italic header", () => {
    const card = measureCard(box("repo", { stereotype: "interface" }), "Repo");
    expect(card).toMatchObject({ stereotype: "«interface»", italic: true, headerH: CARD.headerH });
    expect(measureCard(box("a"), "A").headerH).toBe(CARD.headerPlainH);
  });
});
