import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentFrom, readEDN, viewAt } from "../src";

const example = (name: string) =>
  documentFrom(readEDN(readFileSync(new URL(`../../../examples/${name}`, import.meta.url), "utf8")));

// The files umlify opens in practice, end to end through the public API.
describe("examples", () => {
  it("reads the uml-viewer namespace tree and views its top level", () => {
    const doc = example("uml-viewer.edn");
    if (doc.kind !== "hierarchy") throw new Error("expected a hierarchy document");
    const view = viewAt(doc.doc, []);
    expect(view.title).toBe("UML viewer");
    expect(view.packages[0]?.classes.map((c) => c.id)).toContain("engine");
    expect(view.edges.length).toBeGreaterThan(0);
  });

  it("reads the hand-drawn library diagram", () => {
    const doc = example("library.edn");
    if (doc.kind !== "diagrams") throw new Error("expected hand-drawn diagrams");
    expect(doc.title).toBe("Lending library");
    expect(doc.diagrams[0]?.packages.map((p) => p.label)).toEqual(["Domain", "Application", "Adapters"]);
  });
});
