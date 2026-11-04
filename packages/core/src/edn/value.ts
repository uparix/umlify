/**
 * EDN values as JavaScript values.
 *
 * - nil, booleans and strings are the JS primitives; numbers are `number`.
 *   EDN integers and floats share that type, so an integral float (`1.0`)
 *   reads back as `1`. The viewer only groups by strings and keyword
 *   vectors, so Clojure's int/float distinction never reaches its output.
 * - Lists and vectors are arrays: Clojure compares them alike.
 * - Keywords and symbols are interned, so `===` compares them.
 * - Maps and sets keep file order for iteration and compare without regard
 *   to it, like the Swift port's `EDNMap` and `EDNSet`.
 */
export type EDN =
  | null
  | boolean
  | number
  | string
  | Keyword
  | Sym
  | Char
  | Tagged
  | EDN[]
  | EDNMap
  | EDNSet;

/** A keyword without the colon: `:engine.layout` has name `"engine.layout"`. */
export class Keyword {
  private static readonly table = new Map<string, Keyword>();
  private constructor(readonly name: string) {}

  static of(name: string): Keyword {
    let k = Keyword.table.get(name);
    if (!k) Keyword.table.set(name, (k = new Keyword(name)));
    return k;
  }
}

export class Sym {
  private static readonly table = new Map<string, Sym>();
  private constructor(readonly name: string) {}

  static of(name: string): Sym {
    let s = Sym.table.get(name);
    if (!s) Sym.table.set(name, (s = new Sym(name)));
    return s;
  }
}

export class Char {
  constructor(readonly ch: string) {}
}

export class Tagged {
  constructor(
    readonly tag: string,
    readonly value: EDN,
  ) {}
}

export const kw = (name: string): Keyword => Keyword.of(name);

// ---------- canonical form: structural equality and map keys ----------

/** A string equal for exactly the values Clojure calls equal (NaN aside). */
export function canon(x: EDN): string {
  if (x === null) return "nil";
  switch (typeof x) {
    case "boolean":
      return x ? "true" : "false";
    case "number":
      return `n:${x}`; // String(-0) is "0", as 0.0 equals -0.0
    case "string":
      return `s:${JSON.stringify(x)}`;
  }
  if (x instanceof Keyword) return `:${x.name}`;
  if (x instanceof Sym) return `y:${x.name}`;
  if (x instanceof Char) return `c:${x.ch}`;
  if (x instanceof Tagged) return `#${x.tag} ${canon(x.value)}`;
  if (Array.isArray(x)) return `[${x.map(canon).join(" ")}]`;
  if (x instanceof EDNMap) return `{${[...x].map(([k, v]) => `${canon(k)} ${canon(v)}`).sort().join(", ")}}`;
  return `#{${x.items.map(canon).sort().join(" ")}}`;
}

export function ednEquals(a: EDN, b: EDN): boolean {
  return canon(a) === canon(b);
}

// ---------- ordered map and set ----------

/** EDN map that keeps insertion order and compares without regard to it. */
export class EDNMap implements Iterable<[EDN, EDN]> {
  private readonly entries = new Map<string, [EDN, EDN]>();

  /** Later duplicates replace the value but keep the first key's position. */
  constructor(pairs: Iterable<readonly [EDN, EDN]> = []) {
    for (const [k, v] of pairs) this.set(k, v);
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: EDN): EDN | undefined {
    return this.entries.get(canon(key))?.[1];
  }

  has(key: EDN): boolean {
    return this.entries.has(canon(key));
  }

  set(key: EDN, value: EDN): void {
    const c = canon(key);
    const cur = this.entries.get(c);
    if (cur) cur[1] = value;
    else this.entries.set(c, [key, value]);
  }

  delete(key: EDN): void {
    this.entries.delete(canon(key));
  }

  keys(): EDN[] {
    return [...this.entries.values()].map(([k]) => k);
  }

  [Symbol.iterator](): Iterator<[EDN, EDN]> {
    return this.entries.values();
  }
}

/** EDN set that keeps insertion order and compares without regard to it. */
export class EDNSet implements Iterable<EDN> {
  private readonly members = new Map<string, EDN>();

  constructor(items: Iterable<EDN> = []) {
    for (const x of items) this.add(x);
  }

  get size(): number {
    return this.members.size;
  }

  get items(): EDN[] {
    return [...this.members.values()];
  }

  has(x: EDN): boolean {
    return this.members.has(canon(x));
  }

  /** False when `x` was already a member. */
  add(x: EDN): boolean {
    const c = canon(x);
    if (this.members.has(c)) return false;
    this.members.set(c, x);
    return true;
  }

  [Symbol.iterator](): Iterator<EDN> {
    return this.members.values();
  }
}

// ---------- accessors (lenient, like the Clojure code) ----------

/** `(get x :key)` on a map; undefined when absent or `x` is not a map. */
export function get(x: EDN | undefined, key: string): EDN | undefined {
  return x instanceof EDNMap ? x.get(kw(key)) : undefined;
}

export function asMap(x: EDN | undefined): EDNMap | undefined {
  return x instanceof EDNMap ? x : undefined;
}

/** Items of a list, vector, or set (in file order). */
export function items(x: EDN | undefined): EDN[] | undefined {
  if (Array.isArray(x)) return x;
  if (x instanceof EDNSet) return x.items;
  return undefined;
}

/** Clojure truthiness: everything except nil and false (and absence). */
export function truthy(x: EDN | undefined): boolean {
  return x !== undefined && x !== null && x !== false;
}

export function num(x: EDN | undefined): number | undefined {
  return typeof x === "number" ? x : undefined;
}

/** An integer, also from an integral float (`(long x)`). */
export function integer(x: EDN | undefined): number | undefined {
  return typeof x === "number" && Number.isInteger(x) && Math.abs(x) < 9.2e18 ? x : undefined;
}

export function str(x: EDN | undefined): string | undefined {
  return typeof x === "string" ? x : undefined;
}

export function keywordName(x: EDN | undefined): string | undefined {
  return x instanceof Keyword ? x.name : undefined;
}

/** Clojure's `name` on a keyword, symbol or string: `:a/b` gives `"b"`. */
export function name(x: EDN | undefined): string | undefined {
  if (typeof x === "string") return x;
  if (x instanceof Keyword || x instanceof Sym) {
    const s = x.name;
    const slash = s.indexOf("/");
    return s === "/" || slash < 0 ? s : s.slice(slash + 1);
  }
  return undefined;
}

/** `(keyword (name x))` for a keyword, symbol, or string: policy ids. */
export const idName = name;

/** `(str x)` for the string-ish values the IR uses. */
export function text(x: EDN | undefined): string | undefined {
  if (typeof x === "string") return x;
  if (x instanceof Keyword || x instanceof Sym) return x.name;
  if (typeof x === "number") return printEDN(x);
  return undefined;
}

// ---------- printing (messages and diffs) ----------

export function printEDN(x: EDN): string {
  if (x === null) return "nil";
  switch (typeof x) {
    case "boolean":
      return String(x);
    case "number":
      if (Number.isNaN(x)) return "##NaN";
      if (!Number.isFinite(x)) return x > 0 ? "##Inf" : "##-Inf";
      return String(x);
    case "string":
      return JSON.stringify(x);
  }
  if (x instanceof Keyword) return `:${x.name}`;
  if (x instanceof Sym) return x.name;
  if (x instanceof Char) return `\\${x.ch}`;
  if (x instanceof Tagged) return `#${x.tag} ${printEDN(x.value)}`;
  if (Array.isArray(x)) return `[${x.map(printEDN).join(" ")}]`;
  if (x instanceof EDNMap) return `{${[...x].map(([k, v]) => `${printEDN(k)} ${printEDN(v)}`).join(", ")}}`;
  return `#{${x.items.map(printEDN).join(" ")}}`;
}
