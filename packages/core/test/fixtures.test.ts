import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The parity tests of phases 1 and 2 read these goldens, copied from
// umlviewer/Tests/UMLCoreTests/Fixtures. Guard the inventory so a partial
// copy fails here rather than as a confusing parity miss.
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const edn = (dir: string) => readdirSync(fixtures + dir).filter((f) => f.endsWith(".edn"));

describe("golden fixtures", () => {
  it("has the scene goldens", () => {
    expect(edn("scenes")).toHaveLength(51);
  });

  it("has a painted document per input", () => {
    expect(edn("painted").sort()).toEqual(
      ["library", "order", "uml-viewer", "uml-viewer-inverted", "uml-viewer-proposal"].map((n) => `${n}.edn`).sort(),
    );
  });

  it("has the replayed calls for the ported modules only", () => {
    expect(edn("calls").sort()).toEqual(
      ["config", "detail", "hierarchy", "ir", "overlay", "policy", "source", "source-clojure", "source-rust"].map(
        (n) => `${n}.edn`,
      ).sort(),
    );
  });
});
