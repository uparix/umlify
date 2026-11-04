import { layoutDiagram, newClass, newDiagram, newEdge, newHierarchyDocument, newPackage, type Diagram } from "@umlify/core";
import { describe, expect, it } from "vitest";
import { renderScene } from "../src/render/svg";
import { candidatesOf, search } from "../src/ui/finder";
import { formatHash, parseHash, sameView } from "../src/view/state";
import { traceFrom } from "../src/view/viewer";

const chain: Diagram = {
  ...newDiagram("t"),
  packages: [newPackage("view", "t", ["a", "b", "c", "d"].map((id) => newClass(id, id.toUpperCase())))],
  edges: [newEdge("a", "b", "dependency"), newEdge("b", "c", "dependency"), newEdge("d", "b", "dependency")],
};

describe("tracing", () => {
  const scene = layoutDiagram(chain);

  it("follows dependencies down, transitively", () => {
    const t = traceFrom(scene, "a", "down");
    expect([...t.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...t.edges].sort()).toEqual(["a->b", "b->c"]);
  });

  it("follows dependents up, transitively", () => {
    expect([...traceFrom(scene, "c", "up").nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...traceFrom(scene, "d", "up").nodes]).toEqual(["d"]);
  });
});

describe("finder", () => {
  const doc = {
    kind: "hierarchy" as const,
    doc: {
      ...newHierarchyDocument(),
      classes: [
        { ...newClass("engine.layout"), ns: "app.engine.layout" },
        { ...newClass("application.overlay"), ns: "app.application.overlay" },
        { ...newClass("engine"), ns: "app.engine" },
        { ...newClass("quil", "quil"), foreign: true },
      ],
    },
  };

  it("offers every module, named like its box, and no libraries", () => {
    expect(candidatesOf(doc).map((c) => [c.id, c.name, c.detail])).toEqual([
      ["engine.layout", "Layout", "app.engine.layout"],
      ["application.overlay", "Overlay", "app.application.overlay"],
      ["engine", "Engine", "app.engine"],
    ]);
  });

  it("ranks a name that starts with the query first, then contains it, then ids", () => {
    const all = candidatesOf(doc);
    expect(search(all, "lay").map((c) => c.id)).toEqual(["engine.layout", "application.overlay"]);
    expect(search(all, "ENGINE").map((c) => c.id)).toEqual(["engine", "engine.layout"]);
    expect(search(all, "zzz")).toEqual([]);
    expect(search(all, "  ")).toHaveLength(3);
  });
});

describe("view state", () => {
  it("round-trips proposal, layer, mode and trace", () => {
    const s = { path: [], proposal: "p-1", layer: "proposal.core", mode: "classes" as const, selected: "domain", trace: "up" as const };
    expect(parseHash(formatHash(s))).toEqual(s);
  });

  it("drops a trace without a selection, and the default mode", () => {
    expect(formatHash({ path: [], trace: "down", mode: "full" })).toBe("");
    expect(parseHash("#mode=bogus&trace=sideways")).toMatchObject({ mode: undefined, trace: undefined });
  });

  it("knows when the same scene can be kept", () => {
    expect(sameView({ path: ["a"], selected: "x" }, { path: ["a"], mode: "full" })).toBe(true);
    expect(sameView({ path: ["a"] }, { path: ["a"], mode: "arrows" })).toBe(false);
    expect(sameView({ path: [], proposal: "p" }, { path: [] })).toBe(false);
  });
});

describe("counts mode", () => {
  it("draws incoming and outgoing counts, red when one violates", () => {
    const d: Diagram = { ...chain, hideEdges: true, edges: [...chain.edges.slice(0, 2), { ...newEdge("d", "b", "dependency"), violating: true }] };
    const svg = renderScene(layoutDiagram(d), { graded: true });
    expect(svg.match(/data-count="in"/g)).toHaveLength(2); // b and c
    expect(svg).toContain("▲ 2");
    expect(svg).toMatch(/class="u-count u-violating" data-count="in"><title>Used by: a, d</);
    expect(renderScene(layoutDiagram(chain), { graded: true })).not.toContain("u-count");
  });
});
