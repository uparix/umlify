import { layoutDiagram, newClass, newDiagram, newEdge, newPackage, type Diagram, type DiagramClass } from "@umlify/core";
import { describe, expect, it } from "vitest";
import { gradeColor, gradesOf, hasMetrics, NEUTRAL } from "../src/render/grade";
import { esc, notationOf, renderScene } from "../src/render/svg";
import { centerOn, fit, MAX_ZOOM, pan, visibleWorld, zoomAt } from "../src/view/camera";
import { formatHash, parseHash } from "../src/view/state";

describe("camera", () => {
  it("fits a large scene inside the viewport, centred", () => {
    const cam = fit({ width: 2000, height: 1000 }, { width: 1000, height: 800 });
    expect(cam.k).toBeCloseTo(968 / 2000);
    expect(cam.x + (2000 * cam.k) / 2).toBeCloseTo(500);
    expect(cam.y + (1000 * cam.k) / 2).toBeCloseTo(400);
  });

  it("never enlarges a small scene past reading size", () => {
    expect(fit({ width: 300, height: 200 }, { width: 1000, height: 800 }).k).toBe(1);
  });

  it("zooms about the pointer", () => {
    const cam = zoomAt({ x: 10, y: 20, k: 1 }, 2, 110, 120);
    // The world point (100, 100) was under (110, 120) and stays there.
    expect([100 * cam.k + cam.x, 100 * cam.k + cam.y]).toEqual([110, 120]);
    expect(zoomAt(cam, 1000, 0, 0).k).toBe(MAX_ZOOM);
  });

  it("pans, centres, and reports what is visible", () => {
    expect(pan({ x: 1, y: 2, k: 3 }, 10, 20)).toEqual({ x: 11, y: 22, k: 3 });
    const cam = centerOn({ x: 0, y: 0, k: 2 }, 50, 50, { width: 400, height: 200 });
    expect(visibleWorld(cam, { width: 400, height: 200 })).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  });
});

describe("view state in the hash", () => {
  it("round-trips level and selection", () => {
    const hash = formatHash({ path: ["engine", "sub"], selected: "engine.sub.route" });
    expect(hash).toBe("#path=engine%2Fsub&sel=engine.sub.route");
    expect(parseHash(hash)).toEqual({ path: ["engine", "sub"], selected: "engine.sub.route" });
  });

  it("is empty at the top level with nothing selected", () => {
    expect(formatHash({ path: [] })).toBe("");
    expect(parseHash("")).toEqual({ path: [], selected: undefined });
  });
});

describe("grade colours", () => {
  it("runs red, amber, green over the 1–10 grades", () => {
    expect(gradeColor(1)).toBe("var(--security-stroke)");
    expect(gradeColor(5.5)).toBe("var(--cloud-stroke)");
    expect(gradeColor(10)).toBe("var(--backend-stroke)");
    expect(gradeColor(3.25)).toBe("color-mix(in oklab, var(--cloud-stroke) 50%, var(--security-stroke))");
  });

  it("grades missing data red, as umlviewer does", () => {
    expect(gradesOf(newClass("a"))).toEqual({ crap: 1, mutation: 1, combined: 1 });
    const good: DiagramClass = { ...newClass("a"), crap: { mu: 2, sigma: 0 }, killed: 10, survived: 0 };
    expect(gradesOf(good).combined).toBe(10);
  });

  it("knows whether a document carries metrics at all", () => {
    const doc = (c: DiagramClass) => ({ kind: "diagrams" as const, title: "t", diagrams: [{ ...newDiagram("t"), packages: [newPackage("p", "P", [c])] }] });
    expect(hasMetrics(doc(newClass("a")))).toBe(false);
    expect(hasMetrics(doc({ ...newClass("a"), killed: 1 }))).toBe(true);
  });
});

describe("svg", () => {
  const scene = (d: Diagram) => layoutDiagram(d);
  const two = (kind: string, violating = false): Diagram => ({
    ...newDiagram("t"),
    packages: [newPackage("view", "t", [newClass("a", "A"), newClass("b", "B")])],
    edges: [newEdge("a", "b", kind, undefined, violating)],
  });

  it("escapes text", () => {
    expect(esc(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    const svg = renderScene(scene({ ...newDiagram("t"), packages: [newPackage("view", "t", [newClass("x", "<script>")])] }), { graded: true });
    expect(svg).not.toContain("<script>");
  });

  it("draws each relationship kind with its UML notation", () => {
    expect(notationOf("dependency")).toEqual({ dashed: true, end: "open" });
    expect(notationOf("implements")).toEqual({ dashed: true, end: "triangle" });
    expect(notationOf("composition")).toEqual({ dashed: false, start: "diamond-filled" });
    expect(notationOf("unheard-of")).toEqual(notationOf("association"));
    expect(renderScene(scene(two("aggregation")), { graded: true })).toContain('marker-start="url(#u-diamond-hollow)"');
  });

  it("draws a violating dependency red, with a red head", () => {
    const svg = renderScene(scene(two("dependency", true)), { graded: true });
    expect(svg).toContain("data-violating");
    expect(svg).toContain('class="u-edge u-dashed u-violating"');
    expect(svg).toContain('marker-end="url(#u-open-v)"');
  });

  it("colours boxes neutrally when the document has no metrics", () => {
    const d = two("dependency");
    expect(renderScene(scene(d), { graded: false })).toContain(`--u-hue:${NEUTRAL}`);
    expect(renderScene(scene(d), { graded: false })).not.toContain("u-dots");
    expect(renderScene(scene(d), { graded: true })).toContain("u-dots");
  });

  it("marks folders as drillable and libraries as ovals", () => {
    const d: Diagram = {
      ...newDiagram("t"),
      packages: [newPackage("view", "t", [{ ...newClass("engine", "Engine"), drill: true }])],
      foreign: [{ ...newClass("ring", "ring"), foreign: true, shape: "oval" }],
      edges: [newEdge("engine", "ring", "dependency")],
    };
    const svg = renderScene(scene(d), { graded: true });
    expect(svg).toMatch(/data-node-id="engine" class="u-node u-box u-drillable"/);
    expect(svg).toMatch(/data-node-id="ring" class="u-node u-oval"/);
  });

  it("hides arrows in the triangles declutter mode", () => {
    expect(renderScene({ ...scene(two("dependency")), hideEdges: true }, { graded: true })).toContain('<g class="u-edges" hidden>');
  });
});
