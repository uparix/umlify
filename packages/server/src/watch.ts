import { watch } from "node:fs";
import { isWatched } from "./project.ts";

/**
 * Calls `onChange` with the changed `.edn` paths (relative to `root`) after
 * changes settle for `debounceMs`. It watches the whole root recursively, so
 * a producer's temp-file-then-rename write is seen as a change of the final
 * name. An event without a file name reports an empty list: something
 * changed, reload everything.
 */
export function watchProject(root: string, onChange: (paths: string[]) => void, debounceMs = 150): () => void {
  let pending = new Set<string>();
  let unknown = false;
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const paths = unknown ? [] : [...pending].sort();
    pending = new Set();
    unknown = false;
    onChange(paths);
  };

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (filename === null) unknown = true;
    else {
      const rel = filename.toString().split("\\").join("/");
      if (!isWatched(rel)) return;
      pending.add(rel);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
