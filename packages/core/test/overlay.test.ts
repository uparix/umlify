import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEDN } from "../src/edn/reader";
import { documentEDN } from "../src/domain/encode";
import { documentFrom } from "../src/domain/ir";
import { newClass, newHierarchyDocument, newMember, type UMLDocument } from "../src/domain/model";
import { applyMetrics, loadMetrics, namespaceFromSource, overlayClass, type MetricsFile } from "../src/metrics/overlay";
import { ednDiff } from "./support/edn-diff";
import { fixturesRoot, readFixture } from "./support/fixtures";
import { loadMetricsDir } from "./support/metrics-files";

// Ports of umlviewer's OverlayGoldenTests and OverlayFileTests.
describe("painted documents", () => {
  it.each([
    ["uml-viewer/uml-viewer.edn", "uml-viewer"],
    ["uml-viewer/uml-viewer-proposal.edn", "uml-viewer-proposal"],
    ["uml-viewer/uml-viewer-inverted.edn", "uml-viewer-inverted"],
    ["library/library.edn", "library"],
    ["order/order.edn", "order"],
  ])("%s matches Clojure, op order included", (input, stem) => {
    const path = `${fixturesRoot}inputs/${input}`;
    const doc = documentFrom(readEDN(readFileSync(path, "utf8")));
    const painted = applyMetrics(doc, loadMetricsDir(path.slice(0, path.lastIndexOf("/"))));
    const diffs = ednDiff(readFixture(`painted/${stem}.edn`), documentEDN(painted));
    expect(diffs, diffs.slice(0, 15).join("\n")).toEqual([]);
  });

  it("loads every snapshot namespace", () => {
    const metrics = loadMetricsDir(`${fixturesRoot}inputs/uml-viewer`);
    expect(metrics.mutate.keys).toHaveLength(31);
    expect(metrics.mutate.get("uml-viewer.domain.hierarchy")).toBeDefined();
    expect(metrics.crap.get("uml-viewer.engine.route")?.length).toBeGreaterThan(0);
  });
});

const mf = (path: string, text: string, modified = 0): MetricsFile => ({ path, text, modified });

describe("snapshot files", () => {
  it("keeps the newer snapshot when two files name one namespace", () => {
    const metrics = loadMetrics(undefined, [
      mf("mutate/demo/app.edn", '{:source "src/demo/app.clj" :forms [{:id "defn/go" :killed 5 :survived 0}]}', 2000),
      mf("mutate/demo.app.edn", '{:namespace "demo.app" :forms [{:id "defn/go" :killed 1 :survived 1}]}', 1000),
    ]);
    expect(metrics.mutate.keys).toEqual(["demo.app"]);
    expect(metrics.mutate.get("demo.app")?.forms[0]?.killed).toBe(5);
  });

  it("leaves a document alone without snapshots", () => {
    const doc: UMLDocument = {
      kind: "hierarchy",
      doc: { ...newHierarchyDocument(), classes: [{ ...newClass("app", "App"), ns: "demo.app" }] },
    };
    expect(applyMetrics(doc, loadMetrics(undefined, []))).toBe(doc);
  });

  it("reads method ids as Java writes them", () => {
    const metrics = loadMetrics(undefined, [
      mf(
        "mutate/shop.Order.edn",
        '{:namespace "shop.Order" :forms [{:id "method/save(Book)" :killed 3 :survived 1 :uncovered 0 :sites 4} {:id "method-/check(int)" :killed 1 :survived 0 :uncovered 1}]}',
      ),
    ]);
    const c = { ...newClass("Order", "Order"), ns: "shop.Order", ops: [newMember("save(Book book) : Book", "save(Book)")] };
    const painted = overlayClass(c, metrics);
    expect(painted.ops.map((o) => o.name)).toEqual(["save(Book)", "check(int)"]);
    expect(painted.ops[0]).toMatchObject({ text: "save(Book book) : Book", killed: 3, sites: 4, isPrivate: false });
    expect(painted.ops[1]).toMatchObject({ isPrivate: true, sites: 2 });
    expect(painted).toMatchObject({ killed: 4, survived: 1, uncovered: 1 });
  });

  // No fixture has two classes competing for one snapshot, so pin the
  // precedence from DATA-FORMAT.md: :ns, then :id, then the longest dotted
  // ancestor id, then the sole Rust crate root when the snapshot is the prefix.
  it("gives each snapshot to the best-matching class", () => {
    const snap = (ns: string) => mf(`mutate/${ns}.edn`, `{:namespace "${ns}" :forms [{:id "defn/f" :killed 1 :survived 0}]}`);
    const metrics = loadMetrics(undefined, [snap("shop.web"), snap("domain.cart.items"), snap("mycrate"), snap("mycrate::api")]);
    const cls = (id: string, ns: string, lang?: string) => ({ ...newClass(id), ns, lang });
    const doc: UMLDocument = {
      kind: "hierarchy",
      doc: {
        ...newHierarchyDocument(),
        prefix: "mycrate",
        classes: [
          cls("shop.web", "by-id"),
          cls("y", "shop.web"),
          cls("domain", "short-ancestor"),
          cls("domain.cart", "long-ancestor"),
          cls("lib", "crate-root", "rust"),
          cls("lib.api", "mycrate.api", "rust"),
        ],
      },
    };
    const painted = applyMetrics(doc, metrics);
    if (painted.kind !== "hierarchy") throw new Error("expected hierarchy");
    const killedByNS = Object.fromEntries(painted.doc.classes.map((c) => [c.ns, c.killed]));
    expect(killedByNS).toEqual({
      "by-id": undefined,
      "shop.web": 1,
      "short-ancestor": undefined,
      "long-ancestor": 1,
      "crate-root": 1,
      "mycrate.api": 1,
    });
  });

  it("derives the namespace from a source path", () => {
    expect(namespaceFromSource("src/uml_viewer/domain/ir.clj")).toBe("uml-viewer.domain.ir");
    expect(namespaceFromSource("src\\demo\\app.cljc")).toBe("demo.app");
  });

  it("reports a snapshot that does not parse", () => {
    expect(() => loadMetrics(mf("crap.edn", "{:entries ["), [])).toThrow(/missing '\]'/);
  });
});
