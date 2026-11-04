import { describe, expect, it } from "vitest";
import { get } from "../src/edn/value";
import { diagramEDN } from "../src/domain/encode";
import { ednDiff } from "./support/edn-diff";
import { readFixture } from "./support/fixtures";
import { caseView, viewScenes } from "./support/views";

// The `:view` stage of every golden scene: hierarchy plus declutter on the
// painted document, as the Clojure viewer built it (umlviewer
// HierarchyGoldenTests). library.edn and the synthetic scenes are
// hand-drawn diagrams with no hierarchy view.
describe("hierarchy views", () => {
  it("cover the 38 namespace-tree scenes", () => {
    expect(viewScenes).toHaveLength(38);
  });

  it.each(viewScenes)("%s matches Clojure", (file) => {
    const golden = readFixture(file);
    const diffs = ednDiff(get(golden, "view"), diagramEDN(caseView(golden)));
    expect(diffs, diffs.slice(0, 15).join("\n")).toEqual([]);
  });
});
