import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * The project on disk: its root, the IR files in it, and the metrics
 * snapshots under `.metrics/`. Read-only.
 */

/**
 * The project root: the nearest folder at or above the IR file that holds a
 * `.metrics` directory (DATA-FORMAT.md), else the IR file's folder.
 */
export function findProjectRoot(irPath: string): string {
  const start = dirname(realpathSync(irPath));
  for (let dir = start; ; dir = dirname(dir)) {
    const metrics = join(dir, ".metrics");
    if (existsSync(metrics) && statSync(metrics).isDirectory()) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/**
 * `rel` resolved against `root`, or undefined when it leaves the root
 * (`..`, an absolute path elsewhere, or a symlink pointing out).
 */
export function insideRoot(root: string, rel: string): string | undefined {
  const realRoot = realpathSync(root);
  let path = resolve(realRoot, rel);
  if (existsSync(path)) path = realpathSync(path);
  return path === realRoot || path.startsWith(realRoot + sep) ? path : undefined;
}

const SKIPPED_DIRS = new Set(["node_modules", "target", "dist", "build", "out"]);
const MAX_IR_FILES = 500;

/** IR candidates: `.edn` files outside dot-folders and build output, policy files excluded. Paths relative to root. */
export function listIRFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_IR_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
      } else if (entry.name.endsWith(".edn") && !entry.name.endsWith(".policy.edn")) {
        out.push(relative(root, path).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

/** A metrics file as `@umlify/core`'s `loadMetrics` takes it. */
export interface MetricsFile {
  path: string;
  modified: number;
  text: string;
}

function metricsFile(root: string, path: string): MetricsFile {
  return { path: relative(root, path).split(sep).join("/"), modified: statSync(path).mtimeMs, text: readFileSync(path, "utf8") };
}

/** `.metrics/crap.edn` and every `.metrics/mutate/**.edn`. */
export function readMetricsFiles(root: string): { crap?: MetricsFile; mutate: MetricsFile[] } {
  const crap = join(root, ".metrics", "crap.edn");
  const mutateDir = join(root, ".metrics", "mutate");
  const mutate = existsSync(mutateDir)
    ? readdirSync(mutateDir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".edn"))
        .map((f) => join(mutateDir, f))
        .filter((p) => statSync(p).isFile())
        .sort()
        .map((p) => metricsFile(root, p))
    : [];
  return { crap: existsSync(crap) ? metricsFile(root, crap) : undefined, mutate };
}

/** True for a path (relative to root) whose change the viewer should hear about. */
export function isWatched(rel: string): boolean {
  if (!rel.endsWith(".edn")) return false;
  const parts = rel.split(/[\\/]/);
  return parts.slice(0, -1).every((p) => p === ".metrics" || (!p.startsWith(".") && !SKIPPED_DIRS.has(p)));
}
