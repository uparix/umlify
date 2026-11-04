import { Char, EDNMap, EDNSet, Keyword, Sym, Tagged, printEDN, type EDN } from "./value";

/** Error with the 1-based line and column where reading stopped. */
export class EDNReadError extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`EDN ${line}:${column}: ${reason}`);
    this.name = "EDNReadError";
  }
}

/** Read exactly one form. Whitespace and comments around it are fine. */
export function readEDN(text: string): EDN {
  const r = new Reader(text);
  const value = r.next();
  if (value === undefined) throw r.error("no form");
  if (r.next() !== undefined) throw r.error("more than one form");
  return value;
}

/** Read every top-level form. */
export function readAllEDN(text: string): EDN[] {
  const r = new Reader(text);
  const forms: EDN[] = [];
  for (let f = r.next(); f !== undefined; f = r.next()) forms.push(f);
  return forms;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", ","]);
const DELIMITERS = new Set([...WHITESPACE, "(", ")", "[", "]", "{", "}", '"', ";", "\\"]);

const INT = /^[+-]?\d+$/;
const FLOAT = /^[+-]?\d+(\.\d*)?([eE][+-]?\d+)?$/;
const RATIO = /^([+-]?\d+)\/(\d+)$/;

const NAMED_CHARS: Record<string, string> = {
  newline: "\n",
  space: " ",
  tab: "\t",
  return: "\r",
  backspace: "\b",
  formfeed: "\f",
};

const STRING_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/**
 * Reads the EDN subset Clojure's `pr` writes, plus comments, `#_`, and tags,
 * as the Swift port does. Ratios, `M` decimals and integers beyond 64 bits
 * become floats; `N` integers become integers.
 */
class Reader {
  private pos = 0;
  constructor(private readonly s: string) {}

  /** The next top-level form, or undefined at the end of input. */
  next(): EDN | undefined {
    this.skipIgnorable();
    return this.pos < this.s.length ? this.form() : undefined;
  }

  error(reason: string): EDNReadError {
    let line = 1;
    let column = 1;
    for (let i = 0; i < Math.min(this.pos, this.s.length); i++) {
      const c = this.s.charCodeAt(i);
      if (c === 10) {
        line++;
        column = 1;
      } else if (c < 0xdc00 || c > 0xdfff) {
        column++; // code points: a low surrogate continues the previous one
      }
    }
    return new EDNReadError(reason, line, column);
  }

  // ---------- forms ----------

  private form(): EDN {
    this.skipIgnorable();
    const c = this.s[this.pos];
    switch (c) {
      case undefined:
        throw this.error("unexpected end of input");
      case "(":
        this.pos++;
        return this.sequence(")");
      case "[":
        this.pos++;
        return this.sequence("]");
      case "{":
        this.pos++;
        return this.mapBody();
      case ")":
      case "]":
      case "}":
        throw this.error(`unmatched '${c}'`);
      case '"':
        this.pos++;
        return this.stringBody();
      case "\\":
        this.pos++;
        return this.charBody();
      case "#":
        this.pos++;
        return this.dispatch();
      case ":": {
        this.pos++;
        const t = this.token();
        if (t === "" || t === ":") throw this.error("bad keyword");
        return Keyword.of(t);
      }
      default:
        return this.atom(this.token());
    }
  }

  private sequence(close: string): EDN[] {
    const out: EDN[] = [];
    for (;;) {
      this.skipIgnorable();
      const c = this.s[this.pos];
      if (c === undefined) throw this.error(`missing '${close}'`);
      if (c === close) {
        this.pos++;
        return out;
      }
      out.push(this.form());
    }
  }

  private mapBody(): EDN {
    const xs = this.sequence("}");
    if (xs.length % 2 !== 0) throw this.error("map needs an even number of forms");
    const m = new EDNMap();
    for (let i = 0; i < xs.length; i += 2) {
      const k = xs[i] as EDN;
      if (m.has(k)) throw this.error(`duplicate map key ${printEDN(k)}`);
      m.set(k, xs[i + 1] as EDN);
    }
    return m;
  }

  private dispatch(): EDN {
    const c = this.s[this.pos];
    if (c === undefined) throw this.error("'#' at end of input");
    if (c === "{") {
      this.pos++;
      const set = new EDNSet();
      for (const x of this.sequence("}")) {
        if (!set.add(x)) throw this.error(`duplicate set element ${printEDN(x)}`);
      }
      return set;
    }
    if (c === "#") {
      this.pos++;
      const t = this.token();
      if (t === "NaN") return NaN;
      if (t === "Inf") return Infinity;
      if (t === "-Inf") return -Infinity;
      throw this.error(`unknown symbolic value ##${t}`);
    }
    const tag = this.token();
    if (!/^\p{L}/u.test(tag)) throw this.error(`bad dispatch '#${tag}'`);
    return new Tagged(tag, this.form());
  }

  // ---------- atoms ----------

  private atom(t: string): EDN {
    if (t === "") throw this.error("unexpected character");
    if (t === "nil") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    const digitAt = t[0] === "+" || t[0] === "-" ? 1 : 0;
    if (/\d/.test(t[digitAt] ?? "")) return this.number(t);
    return Sym.of(t);
  }

  private number(t: string): number {
    const body = t.slice(0, -1);
    if (t.endsWith("N")) {
      if (INT.test(body)) return Number(body);
    } else if (t.endsWith("M")) {
      if (FLOAT.test(body)) return Number(body);
    } else if (t.includes("/")) {
      const ratio = RATIO.exec(t);
      if (ratio && Number(ratio[2]) !== 0) return Number(ratio[1]) / Number(ratio[2]);
    } else if (FLOAT.test(t)) {
      return Number(t);
    }
    throw this.error(`bad number '${t}'`);
  }

  private stringBody(): string {
    let out = "";
    while (this.pos < this.s.length) {
      const c = this.s[this.pos++] as string;
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.pos];
      if (e === undefined) break;
      this.pos++;
      if (e === "u") out += this.unicodeEscape();
      else if (e in STRING_ESCAPES) out += STRING_ESCAPES[e];
      else throw this.error(`bad string escape '\\${e}'`);
    }
    throw this.error(`missing closing '"'`);
  }

  private unicodeEscape(): string {
    const hex = this.s.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error("bad \\u escape");
    this.pos += 4;
    return String.fromCharCode(parseInt(hex, 16));
  }

  private charBody(): Char {
    // The first character is taken even when it is a delimiter: \( \space.
    const first = this.s.codePointAt(this.pos);
    if (first === undefined) throw this.error("'\\' at end of input");
    const start = this.pos;
    this.pos += first > 0xffff ? 2 : 1;
    const rest = this.token();
    const t = this.s.slice(start, this.pos);
    if (rest === "") return new Char(t);
    const named = NAMED_CHARS[t];
    if (named !== undefined) return new Char(named);
    if (/^u[0-9a-fA-F]{4}$/.test(t)) return new Char(String.fromCharCode(parseInt(t.slice(1), 16)));
    if (/^o[0-7]{1,3}$/.test(t) && parseInt(t.slice(1), 8) <= 0o377) {
      return new Char(String.fromCharCode(parseInt(t.slice(1), 8)));
    }
    throw this.error(`bad character '\\${t}'`);
  }

  // ---------- scanning ----------

  /** Characters up to the next delimiter. */
  private token(): string {
    const start = this.pos;
    while (this.pos < this.s.length && !DELIMITERS.has(this.s[this.pos] as string)) this.pos++;
    return this.s.slice(start, this.pos);
  }

  /** Whitespace, commas, `;` comments, and `#_` discarded forms. */
  private skipIgnorable(): void {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos] as string;
      if (WHITESPACE.has(c)) this.pos++;
      else if (c === ";") {
        while (this.pos < this.s.length && this.s[this.pos] !== "\n") this.pos++;
      } else if (c === "#" && this.s[this.pos + 1] === "_") {
        this.pos += 2;
        this.form();
      } else return;
    }
  }
}
