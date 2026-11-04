/**
 * Finding a member in its source file (umlviewer `Source.swift`, Clojure
 * `uml-viewer.source` and its `source_*` locators). Pure text functions:
 * which files to try, then where in a file's text a member starts. The
 * caller reads the files (the browser asks the server).
 */

/** What a locator needs: namespace, member name, language, and file. */
export interface SourceIdent {
  ns?: string;
  name?: string;
  lang?: string;
  file?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * A Java/ICU pattern as a JS RegExp. The patterns here use ICU syntax JS
 * shares, except a leading `(?m)`, which becomes the `m` flag.
 */
function compile(pattern: string): RegExp {
  return pattern.startsWith("(?m)") ? new RegExp(pattern.slice(4), "gm") : new RegExp(pattern, "g");
}

/** Undefined for a pattern that does not compile: it matches nothing, as in the Swift port. */
function tryCompile(pattern: string): RegExp | undefined {
  try {
    return compile(pattern);
  } catch {
    return undefined;
  }
}

function firstMatch(text: string, pattern: string, from = 0): number | undefined {
  const re = tryCompile(pattern);
  if (!re) return undefined;
  re.lastIndex = from;
  return re.exec(text)?.index;
}

function allMatches(text: string, pattern: string, from: number): number[] {
  const re = tryCompile(pattern);
  if (!re) return [];
  re.lastIndex = from;
  const out: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push(m.index);
    if (m[0] === "") re.lastIndex++;
  }
  return out;
}

const fill = (format: string, name: string) => format.replaceAll("%s", escapeRegExp(name));

/** UTF-16 offset of the first format in `formats` (each with one `%s`) that matches `member`. */
export function patternStart(text: string, member: string | undefined, formats: readonly string[]): number | undefined {
  if (member === undefined) return undefined;
  for (const f of formats) {
    const at = firstMatch(text, fill(f, member));
    if (at !== undefined) return at;
  }
  return undefined;
}

export function lineNumber(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const trimEnd = (s: string) => s.replace(/\s+$/u, "");

/** The rest of the line starting at `offset`, trailing space trimmed. */
export function declarationLine(text: string, offset: number): string {
  const nl = text.indexOf("\n", offset);
  return trimEnd(text.slice(offset, nl < 0 ? text.length : nl));
}

export function lineMember(text: string, member: string | undefined, formats: readonly string[]): string | undefined {
  const at = patternStart(text, member, formats);
  return at === undefined ? undefined : declarationLine(text, at);
}

export function memberLineOf(text: string, member: string | undefined, formats: readonly string[]): number | undefined {
  const at = patternStart(text, member, formats);
  return at === undefined ? undefined : lineNumber(text, at);
}

/** Title from the file (or namespace) and the member. */
export function fileTitle(ident: SourceIdent): string {
  return (ident.file ?? ident.ns ?? "") + (ident.name === undefined ? "" : `/${ident.name}`);
}

// ---------- languages ----------

interface Language {
  /** Files to try, relative to the project root, in order. */
  candidates(ident: SourceIdent): string[];
  extract(text: string, ident: SourceIdent): string | undefined;
  startLine(text: string, ident: SourceIdent): number | undefined;
}

const fileOf = (ident: SourceIdent): string[] => (ident.file ? [ident.file.replaceAll("\\", "/")] : []);

const patternLanguage = (formats: readonly string[]): Language => ({
  candidates: fileOf,
  extract: (text, ident) => lineMember(text, ident.name, formats),
  startLine: (text, ident) => memberLineOf(text, ident.name, formats),
});

export const TYPESCRIPT_FORMATS = [
  "export\\s+default\\s+async\\s+function\\s+%s\\b",
  "export\\s+async\\s+function\\s+%s\\b",
  "export\\s+default\\s+function\\s+%s\\b",
  "export\\s+function\\s+%s\\b",
  "export\\s+default\\s+class\\s+%s\\b",
  "export\\s+class\\s+%s\\b",
  "export\\s+const\\s+%s\\b",
  "export\\s+let\\s+%s\\b",
  "export\\s+var\\s+%s\\b",
  "export\\s+enum\\s+%s\\b",
  "async\\s+function\\s+%s\\b",
  "function\\s+%s\\b",
  "class\\s+%s\\b",
  "(?:const|let|var)\\s+%s\\b",
];

export const PYTHON_FORMATS = ["async\\s+def\\s+%s\\b", "def\\s+%s\\b", "class\\s+%s\\b"];

/** Rust: a fn, struct, trait or the like, with a leading `#[tauri::command]` included. */
export const RUST_FORMATS = [
  "#\\[\\s*tauri\\s*::\\s*command[^\\]]*\\]\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+%s\\b",
  "pub(?:\\([^)]*\\))?\\s+async\\s+fn\\s+%s\\b",
  "pub(?:\\([^)]*\\))?\\s+fn\\s+%s\\b",
  "async\\s+fn\\s+%s\\b",
  "fn\\s+%s\\b",
  "pub(?:\\([^)]*\\))?\\s+(?:struct|enum|trait|type|const|static)\\s+%s\\b",
  "(?:struct|enum|trait|type|const|static)\\s+%s\\b",
];

/** From the match through the end of the line holding the name. */
export function rustExtractMember(text: string, member: string | undefined): string | undefined {
  if (member === undefined) return undefined;
  const start = patternStart(text, member, RUST_FORMATS);
  if (start === undefined) return undefined;
  const nameAt = text.indexOf(member, start);
  const from = nameAt < 0 ? start : nameAt;
  const nl = text.indexOf("\n", from);
  return trimEnd(text.slice(start, nl < 0 ? text.length : nl));
}

const rust: Language = {
  candidates: fileOf,
  extract: (text, ident) => rustExtractMember(text, ident.name),
  startLine: (text, ident) => memberLineOf(text, ident.name, RUST_FORMATS),
};

// ---------- Clojure ----------

function clojureStart(text: string, member: string | undefined): number | undefined {
  if (member === undefined) return undefined;
  const re = new RegExp(`^\\((?:defn-|defn)\\s+${escapeRegExp(member)}(?=[\\s\\[\\{"]|$)`, "m");
  return re.exec(text)?.index;
}

/** Index after the form starting at `start`, skipping strings. */
function formEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) escaped = false;
    else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

export function clojureExtractMember(text: string, member: string | undefined): string | undefined {
  const start = clojureStart(text, member);
  return start === undefined ? undefined : trimEnd(text.slice(start, formEnd(text, start)));
}

export function clojureMemberLine(text: string, member: string | undefined): number | undefined {
  const start = clojureStart(text, member);
  return start === undefined ? undefined : lineNumber(text, start);
}

/** `src/<ns path>.clj|cljc|cljs`, with `-` as `_` and `.` as `/`. */
export function clojureSourcePaths(ns: string | undefined): string[] {
  if (ns === undefined) return [];
  const rel = ns.replaceAll("-", "_").replaceAll(".", "/");
  return ["clj", "cljc", "cljs"].map((ext) => `src/${rel}.${ext}`);
}

const clojure: Language = {
  candidates: (ident) => clojureSourcePaths(ident.ns),
  extract: (text, ident) => clojureExtractMember(text, ident.name),
  startLine: (text, ident) => clojureMemberLine(text, ident.name),
};

// ---------- Java ----------

const JAVA_MODIFIERS = "public|protected|private|static|final|abstract|synchronized|default|native|strictfp";
/** With a modifier first: `@Override public Optional<Book> find(`. */
const JAVA_MODIFIED = `(?:${JAVA_MODIFIERS})\\s+[^=;(){}]*?\\b%s\\s*\\(`;
/** Package-private or an interface method: a type, the name, the parameters, then `{` or `;`. */
const JAVA_PLAIN =
  "(?m)^[ \\t]*(?!(?:return|throw|new|else|case|yield|assert)\\b)[\\w<>\\[\\],.?@ ]*[\\w>\\]]\\s+%s\\s*\\([^)]*\\)\\s*(?:throws\\s[^{;]*)?[{;]";
/** A package-private constructor: `Cursor(int start) {`. */
const JAVA_CONSTRUCTOR = "(?m)^[ \\t]*%s\\s*\\([^)]*\\)\\s*(?:throws\\s[^{]*)?\\{";
const JAVA_TYPE = "\\b(?:class|interface|enum|record|@interface)\\s+%s\\b";

/** `Line.total(int)` -> types `["Line"]`, member `"total"`. */
export function javaMemberPath(name: string): { types: string[]; member: string } {
  const bare = name.split("(")[0] ?? name;
  const parts = bare.split(".");
  const member = parts.pop() ?? bare;
  return { types: parts, member };
}

/** Brace depth at `offset`, counted from `start`, skipping string and char literals. */
function braceDepth(text: string, start: number, offset: number): number {
  let d = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let i = start; i < Math.min(offset, text.length); i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return d;
}

/** Offset of the member's declaration directly inside its type, else of the innermost type found. */
function javaMemberStart(text: string, ident: SourceIdent): number | undefined {
  if (!ident.name) return undefined;
  const { types, member } = javaMemberPath(ident.name);
  const topType = ident.ns === undefined ? undefined : ident.ns.split(".").at(-1);
  let typeAt = topType === undefined ? undefined : firstMatch(text, fill(JAVA_TYPE, topType));
  for (const t of types) {
    const at = firstMatch(text, fill(JAVA_TYPE, t), typeAt ?? 0);
    if (at === undefined) break;
    typeAt = at;
  }
  const owner = types.at(-1) ?? topType;
  const formats = [JAVA_MODIFIED, JAVA_PLAIN, ...(member === owner ? [JAVA_CONSTRUCTOR] : [])];
  for (const f of formats) {
    for (const at of allMatches(text, fill(f, member), typeAt ?? 0)) {
      // A record's header is its constructor, at depth 0 from the declaration.
      if (typeAt === undefined) return at;
      if (at === typeAt || braceDepth(text, typeAt, at) === 1) return at;
    }
  }
  return typeAt;
}

const java: Language = {
  candidates: fileOf,
  extract: (text, ident) => {
    const at = javaMemberStart(text, ident);
    return at === undefined ? undefined : declarationLine(text, at);
  },
  startLine: (text, ident) => {
    const at = javaMemberStart(text, ident);
    return at === undefined ? undefined : lineNumber(text, at);
  },
};

/** The locators by `:lang`. A class without one uses Clojure's. */
const LANGUAGES: Record<string, Language> = {
  clojure,
  typescript: patternLanguage(TYPESCRIPT_FORMATS),
  rust,
  python: patternLanguage(PYTHON_FORMATS),
  java,
};

const languageOf = (ident: SourceIdent): Language | undefined => LANGUAGES[ident.lang ?? "clojure"];

/** Files that may hold `ident`, relative to the project root, in the order to try. */
export function sourceCandidates(ident: SourceIdent): string[] {
  return languageOf(ident)?.candidates(ident) ?? [];
}

/**
 * Where a member starts in a file's text. `found` is false when a named
 * member is not in the text; without a name the file opens at the top.
 */
export function locateMember(text: string, ident: SourceIdent): { found: boolean; line?: number } {
  const lang = languageOf(ident);
  if (!lang) return { found: false };
  if (!ident.name) return { found: true };
  if (lang.extract(text, ident) === undefined) return { found: false };
  return { found: true, line: lang.startLine(text, ident) };
}
