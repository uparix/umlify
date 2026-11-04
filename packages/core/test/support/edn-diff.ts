import { EDNMap, EDNSet, ednEquals, items, printEDN, type EDN } from "../../src/edn/value";

/**
 * Compares a Clojure result with a port's the way the viewer uses it
 * (umlviewer `EDNDiff.swift`):
 * - numbers compare by value within a relative tolerance;
 * - nil, false, an empty collection and a missing map key are alike.
 */
export function ednDiff(expected: EDN | undefined, actual: EDN | undefined, tolerance = 1e-9): string[] {
  const out: string[] = [];
  compare(expected ?? null, actual ?? null, "", out, tolerance);
  return out;
}

export function isBlank(x: EDN): boolean {
  if (x === null || x === false) return true;
  if (Array.isArray(x)) return x.length === 0;
  if (x instanceof EDNMap || x instanceof EDNSet) return x.size === 0;
  return false;
}

const short = (x: EDN) => printEDN(x).slice(0, 200);

function close(a: number, b: number, tolerance: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function compare(e: EDN, a: EDN, path: string, out: string[], tolerance: number): void {
  if (out.length > 40) return;
  if (isBlank(e) && isBlank(a)) return;
  if (typeof e === "number" && typeof a === "number") {
    if (!close(e, a, tolerance)) out.push(`${path}: expected ${short(e)}, got ${short(a)}`);
    return;
  }
  if (e instanceof EDNMap && a instanceof EDNMap) {
    const keys = [...e.keys(), ...a.keys().filter((k) => !e.has(k))];
    for (const k of keys) compare(e.get(k) ?? null, a.get(k) ?? null, `${path}/${printEDN(k)}`, out, tolerance);
    return;
  }
  if (Array.isArray(e)) {
    const ys = Array.isArray(a) ? items(a) : undefined;
    if (!ys) {
      out.push(`${path}: expected ${short(e)}, got ${short(a)}`);
      return;
    }
    if (e.length !== ys.length) {
      out.push(`${path}: expected ${e.length} items, got ${ys.length}`);
      return;
    }
    e.forEach((x, i) => compare(x, ys[i] as EDN, `${path}[${i}]`, out, tolerance));
    return;
  }
  if (!ednEquals(e, a)) out.push(`${path}: expected ${short(e)}, got ${short(a)}`);
}
