import { describe, expect, it } from "vitest";
import { groupBy, hasheq } from "../src/edn/clojure-hash";
import { readEDN } from "../src/edn/reader";
import { items, keywordName, kw } from "../src/edn/value";

// Port of umlviewer's ClojureHashTests. Values from Clojure 1.12:
// `(bit-and (hash x) 0xffffffff)`.
describe("hasheq", () => {
  it.each([
    [":engine.layout", 4_175_753_688],
    [":a/b", 1_482_224_565],
    ["sym", 195_671_222],
    ['"hello"', 1_715_862_179],
    ['""', 0],
    ["0", 0],
    ["1", 1_392_991_556],
    ["-1", 1_651_860_712],
    ["42", 1_871_679_806],
    ["9999999999", 894_673_221],
    ["1.5", 1_073_217_536],
    ["-0.0", 0],
    ["nil", 0],
    ["true", 1231],
    ["false", 1237],
    ["[:application :engine]", 728_262_816],
    ["[]", 2_277_397_642],
    ["[1 2 3]", 736_442_005],
    ["(1 2)", 156_247_261],
    ["#{:y :x}", 2_775_060_984],
    ["{:a 1}", 1_772_842_048],
    ["\\a", 97],
  ])("hashes %s like Clojure", (text, expected) => {
    expect(hasheq(readEDN(text))).toBe(expected);
  });
});

describe("groupBy", () => {
  it("keeps insertion order up to eight keys", () => {
    const ids = ["main", "adapters", "application", "engine", "source", "graph", "clojure-language", "typescript-language"];
    expect(groupBy(ids, kw).map((g) => g[0])).toEqual(ids);
  });

  it("follows the hash trie past eight keys", () => {
    // (keys (group-by identity ks)) in Clojure, first segment shown.
    const ids = ["main", "adapters", "application", "engine", "source", "graph", "clojure-language",
      "typescript-language", "rust-language", "python-language", "domain"];
    const others = ["domain", "engine", "source"];
    const keys = ids.map((id, i) => [kw(id), kw(others[i % 3] as string)]);
    expect(groupBy(keys, (k) => k).map((g) => keywordName(items(g[0])?.[0]))).toEqual([
      "domain", "application", "typescript-language", "source", "adapters", "graph",
      "clojure-language", "python-language", "main", "rust-language", "engine",
    ]);
  });
});
