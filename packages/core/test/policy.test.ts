import { describe, expect, it } from "vitest";
import { newEdge } from "../src/domain/model";
import { kindRank, mergeEdges } from "../src/domain/policy";

// The recorded Clojure calls only rank :dependency and :implements, and no
// recorded merge bundles a :composition, so pin the documented order here:
// implements/inheritance > composition > aggregation > association > dependency.
describe("edge strength", () => {
  it("ranks every kind", () => {
    const order = ["dependency", "association", "aggregation", "composition", "implements"];
    expect(order.map(kindRank)).toEqual([0, 1, 2, 3, 4]);
    expect(kindRank("inheritance")).toBe(kindRank("implements"));
    expect(kindRank("uses")).toBe(0);
  });

  it("keeps the strongest kind when merging a pair", () => {
    const merged = mergeEdges([
      newEdge("a", "b", "aggregation"),
      newEdge("a", "b", "composition"),
      newEdge("a", "b", "association"),
    ]);
    expect(merged.map((e) => e.kind)).toEqual(["composition"]);
  });

  it("keeps a violation only on a surviving dependency", () => {
    const dep = mergeEdges([newEdge("a", "b", "dependency", undefined, true), newEdge("a", "b", "dependency")]);
    expect(dep[0]?.violating).toBe(true);
    const assoc = mergeEdges([newEdge("a", "b", "dependency", undefined, true), newEdge("a", "b", "association")]);
    expect(assoc[0]).toMatchObject({ kind: "association", violating: false });
  });
});
