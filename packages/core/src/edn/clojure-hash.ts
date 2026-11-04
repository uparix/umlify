import { Char, EDNMap, EDNSet, Keyword, Sym, Tagged, type EDN } from "./value";

/*
 * Clojure's `hasheq`, and the iteration order it gives `group-by`.
 *
 * `group-by` builds a transient array map, which keeps insertion order up
 * to eight keys. The ninth key turns it into a hash trie, which iterates by
 * the hash's 5-bit chunks from the low bits up, with keys of equal hash in
 * insertion order. Edge merging keeps the first group's edge order from
 * that, so the port has to reproduce it. All arithmetic is uint32.
 */

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

const u32 = (x: number) => x >>> 0;
const rotl = (x: number, r: number) => u32((x << r) | (x >>> (32 - r)));
const mixK1 = (k: number) => u32(Math.imul(rotl(Math.imul(k, C1), 15), C2));
const mixH1 = (h: number, k: number) => u32(Math.imul(rotl(u32(h ^ k), 13), 5) + 0xe6546b64);

function fmix(h: number, length: number): number {
  h = u32(h ^ length);
  h = u32(h ^ (h >>> 16));
  h = u32(Math.imul(h, 0x85ebca6b));
  h = u32(h ^ (h >>> 13));
  h = u32(Math.imul(h, 0xc2b2ae35));
  return u32(h ^ (h >>> 16));
}

function hashInt(input: number): number {
  return input === 0 ? 0 : fmix(mixH1(0, mixK1(input)), 4);
}

function hashLong(input: number): number {
  if (input === 0) return 0;
  const bits = BigInt.asUintN(64, BigInt(input));
  const h = mixH1(mixH1(0, mixK1(Number(bits & 0xffffffffn))), mixK1(Number(bits >> 32n)));
  return fmix(h, 8);
}

function hashDouble(d: number): number {
  if (d === 0) return 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  return u32(view.getUint32(0) ^ view.getUint32(4)); // (bits ^ (bits >>> 32)) truncated
}

function hashUnencodedChars(s: string): number {
  let h = 0;
  for (let i = 1; i < s.length; i += 2) h = mixH1(h, mixK1(s.charCodeAt(i - 1) | (s.charCodeAt(i) << 16)));
  if (s.length & 1) h = u32(h ^ mixK1(s.charCodeAt(s.length - 1)));
  return fmix(h, 2 * s.length);
}

const mixCollHash = (hash: number, count: number) => fmix(mixH1(0, mixK1(hash)), count);

/** Java `String.hashCode`. */
function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = u32(Math.imul(h, 31) + s.charCodeAt(i));
  return h;
}

/** `Util.hashCombine`, with Java's signed `>>`. */
function hashCombine(seed: number, hash: number): number {
  return u32(seed ^ u32(hash + 0x9e3779b9 + (seed << 6) + (seed >> 2)));
}

function symbolHash(full: string): number {
  // `:a/b` is ns "a", name "b"; a lone "/" is a name.
  const slash = full.indexOf("/");
  if (full !== "/" && slash >= 0) {
    return hashCombine(hashUnencodedChars(full.slice(slash + 1)), javaHash(full.slice(0, slash)));
  }
  return hashCombine(hashUnencodedChars(full), 0);
}

/** `(bit-and (hash x) 0xffffffff)`. Integral numbers hash as longs. */
export function hasheq(x: EDN): number {
  if (x === null) return 0;
  switch (typeof x) {
    case "boolean":
      return x ? 1231 : 1237;
    case "number":
      return Number.isInteger(x) && Math.abs(x) < 9.2e18 ? hashLong(x) : hashDouble(x);
    case "string":
      return hashInt(javaHash(x));
  }
  if (x instanceof Keyword) return u32(symbolHash(x.name) + 0x9e3779b9);
  if (x instanceof Sym) return symbolHash(x.name);
  if (x instanceof Char) return x.ch.charCodeAt(0) || 0;
  if (x instanceof Tagged) return hasheq(x.value);
  if (Array.isArray(x)) {
    let h = 1;
    for (const e of x) h = u32(Math.imul(h, 31) + hasheq(e));
    return mixCollHash(h, x.length);
  }
  if (x instanceof EDNMap) {
    let sum = 0;
    for (const [k, v] of x) sum = u32(sum + hasheq([k, v]));
    return mixCollHash(sum, x.size);
  }
  let sum = 0;
  for (const e of x as EDNSet) sum = u32(sum + hasheq(e));
  return mixCollHash(sum, (x as EDNSet).size);
}

/**
 * Indices of `keys` (distinct, in insertion order) in the order a Clojure
 * map built by `group-by` iterates them.
 */
export function mapOrder(keys: EDN[]): number[] {
  const idx = keys.map((_, i) => i);
  if (keys.length <= 8) return idx;
  const hashes = keys.map(hasheq);
  return idx.sort((a, b) => {
    const ha = hashes[a] as number;
    const hb = hashes[b] as number;
    if (ha === hb) return a - b;
    for (let shift = 0; shift < 32; shift += 5) {
      const ca = (ha >>> shift) & 0x1f;
      const cb = (hb >>> shift) & 0x1f;
      if (ca !== cb) return ca - cb;
    }
    return a - b;
  });
}

/** `(vals (group-by key xs))`: groups in Clojure's iteration order. */
export function groupBy<T>(xs: readonly T[], key: (x: T) => EDN): T[][] {
  const index = new EDNMap();
  const keys: EDN[] = [];
  const groups: T[][] = [];
  for (const x of xs) {
    const k = key(x);
    const i = index.get(k);
    if (typeof i === "number") (groups[i] as T[]).push(x);
    else {
      index.set(k, groups.length);
      keys.push(k);
      groups.push([x]);
    }
  }
  return mapOrder(keys).map((i) => groups[i] as T[]);
}
