import { describe, expect, it } from "vitest";
import { get, idName, items, str, type EDN } from "../src/edn/value";
import * as Hierarchy from "../src/domain/hierarchy";
import { decodeHierarchyDocument, type Diagram, type HierarchyDocument } from "../src/domain/model";
import { namedProposals } from "../src/domain/policy";
import { ednDiff } from "./support/edn-diff";
import { diagramEDN } from "../src/domain/encode";
import { fixtureFiles, readFixture } from "./support/fixtures";

// The `:view` stage of every golden scene: hierarchy plus declutter on the
// painted document, as the Clojure viewer built it (umlviewer
// HierarchyGoldenTests). library.edn and the synthetic scenes are
// hand-drawn diagrams with no hierarchy view.
const viewScenes = fixtureFiles("scenes").filter((f) => !f.endsWith("/library.edn") && !f.includes("/synthetic-"));

function viewFor(opts: EDN, doc: HierarchyDocument): Diagram {
  const focus = (items(get(opts, "focus")) ?? []).flatMap((x) => idName(x) ?? []);
  const proposalID = idName(get(opts, "proposal-id"));
  const openLayer = idName(get(opts, "open-layer"));
  let mode = (idName(get(opts, "declutter")) ?? "full") as Hierarchy.Declutter;
  if (!Hierarchy.DECLUTTER_MODES.includes(mode)) mode = "full";
  if (openLayer !== undefined && mode === "classes") mode = "elements";

  let source: Diagram;
  if (proposalID !== undefined && openLayer !== undefined && focus.length === 0) {
    source = Hierarchy.layerView(doc, proposalID, openLayer);
  } else if (proposalID !== undefined && focus.length === 0 && namedProposals(doc).length > 0) {
    source = Hierarchy.proposalView(doc, proposalID);
  } else {
    source = Hierarchy.viewAt(doc, focus);
  }
  return Hierarchy.applyDeclutter(source, mode);
}

const painted = new Map<string, HierarchyDocument>();
function paintedDoc(input: string): HierarchyDocument {
  const stem = (input.split("/").at(-1) as string).replace(".edn", "");
  let doc = painted.get(stem);
  if (!doc) {
    doc = decodeHierarchyDocument(readFixture(`painted/${stem}.edn`));
    if (!doc) throw new Error(`painted/${stem}.edn is not a hierarchy document`);
    painted.set(stem, doc);
  }
  return doc;
}

describe("hierarchy views", () => {
  it("cover the 38 namespace-tree scenes", () => {
    expect(viewScenes).toHaveLength(38);
  });

  it.each(viewScenes)("%s matches Clojure", (file) => {
    const golden = readFixture(file);
    const opts = get(golden, "case") as EDN;
    const input = str(get(opts, "input")) as string;
    const view = viewFor(opts, paintedDoc(input));
    const diffs = ednDiff(get(golden, "view"), diagramEDN(view));
    expect(diffs, diffs.slice(0, 15).join("\n")).toEqual([]);
  });
});
