import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadMetrics, type Metrics, type MetricsFile } from "../../src/metrics/overlay";

function file(path: string): MetricsFile {
  return { path, modified: statSync(path).mtimeMs, text: readFileSync(path, "utf8") };
}

/** `.metrics/crap.edn` and every `.metrics/mutate/**.edn` under `root`, loaded. */
export function loadMetricsDir(root: string): Metrics {
  const crap = join(root, ".metrics/crap.edn");
  const mutateDir = join(root, ".metrics/mutate");
  const mutate = existsSync(mutateDir)
    ? readdirSync(mutateDir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".edn"))
        .map((f) => join(mutateDir, f))
        .filter((p) => statSync(p).isFile())
        .map(file)
    : [];
  return loadMetrics(existsSync(crap) ? file(crap) : undefined, mutate);
}
