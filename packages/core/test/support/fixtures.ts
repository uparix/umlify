import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEDN } from "../../src/edn/reader";
import type { EDN } from "../../src/edn/value";

/** Golden data recorded from the Clojure viewer, copied from umlviewer. */
export const fixturesRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function readFixture(relative: string): EDN {
  return readEDN(readFileSync(fixturesRoot + relative, "utf8"));
}

export function fixtureFiles(dir: string): string[] {
  return readdirSync(fixturesRoot + dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".edn"))
    .map((f) => `${dir}/${f}`)
    .sort();
}
