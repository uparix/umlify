import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectRoot, insideRoot, isWatched, listIRFiles, readMetricsFiles } from "../src/project.ts";

let dir: string;
const write = (rel: string, text = "{}") => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "umlify-project-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("project root", () => {
  it("is the nearest folder above the IR that holds .metrics", () => {
    write(".metrics/crap.edn", "{:entries []}");
    write("uml/deep/shop.edn");
    expect(findProjectRoot(join(dir, "uml/deep/shop.edn"))).toBe(dir);
  });

  it("falls back to the IR's folder", () => {
    write("uml/shop.edn");
    expect(findProjectRoot(join(dir, "uml/shop.edn"))).toBe(join(dir, "uml"));
  });
});

describe("paths", () => {
  it("resolves inside the root and refuses anything outside", () => {
    write("uml/shop.edn");
    expect(insideRoot(dir, "uml/shop.edn")).toBe(join(dir, "uml/shop.edn"));
    expect(insideRoot(dir, "../etc/passwd")).toBeUndefined();
    expect(insideRoot(dir, "/etc/passwd")).toBeUndefined();
  });

  it("refuses a symlink that points out of the root", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "umlify-outside-")));
    writeFileSync(join(outside, "secret.edn"), "{}");
    symlinkSync(join(outside, "secret.edn"), join(dir, "link.edn"));
    expect(insideRoot(dir, "link.edn")).toBeUndefined();
    rmSync(outside, { recursive: true, force: true });
  });

  it("lists IR files, skipping dot folders, build output and policy files", () => {
    for (const f of ["uml/shop.edn", "uml/shop.policy.edn", ".metrics/crap.edn", "node_modules/x/y.edn", "target/z.edn", "a.edn", "notes.txt"]) write(f);
    expect(listIRFiles(dir)).toEqual(["a.edn", "uml/shop.edn"]);
  });

  it("watches IR and metrics files only", () => {
    expect(isWatched("uml/shop.edn")).toBe(true);
    expect(isWatched(".metrics/mutate/shop.web.edn")).toBe(true);
    expect(isWatched("uml/shop.edn.tmp")).toBe(false);
    expect(isWatched(".git/x.edn")).toBe(false);
    expect(isWatched("node_modules/x.edn")).toBe(false);
  });
});

describe("metrics files", () => {
  it("reads crap.edn and every mutation snapshot with its mtime", () => {
    write(".metrics/crap.edn", "{:entries []}");
    write(".metrics/mutate/shop.web.edn", "{:namespace \"shop.web\" :forms []}");
    write(".metrics/mutate/deep/shop.db.edn", "{:namespace \"shop.db\" :forms []}");
    const m = readMetricsFiles(dir);
    expect(m.crap).toMatchObject({ path: ".metrics/crap.edn", text: "{:entries []}" });
    expect(m.mutate.map((f) => f.path)).toEqual([".metrics/mutate/deep/shop.db.edn", ".metrics/mutate/shop.web.edn"]);
    expect(m.mutate[0]?.modified).toBeGreaterThan(0);
  });

  it("is empty without .metrics", () => {
    expect(readMetricsFiles(dir)).toEqual({ crap: undefined, mutate: [] });
  });
});
