import type { MetricsFile } from "@umlify/core";

/** The local server's read-only API (packages/server/src/http.ts). */

export interface ProjectInfo {
  name: string;
  /** The IR the server was started with, relative to the project root. */
  ir: string;
  files: string[];
}

export interface MetricsFiles {
  crap?: MetricsFile;
  mutate: MetricsFile[];
}

async function get(path: string): Promise<Response> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()) || res.statusText}`);
  return res;
}

export const fetchProject = async (): Promise<ProjectInfo> => (await get("/api/project")).json();

export const fetchFile = async (path: string): Promise<string> =>
  (await get(`/api/file?path=${encodeURIComponent(path)}`)).text();

export const fetchMetrics = async (): Promise<MetricsFiles> => (await get("/api/metrics")).json();

/** Server-Sent Events: `changed` with the `.edn` paths that changed (empty: anything may have). */
export function subscribe(handlers: {
  open: () => void;
  changed: (paths: string[]) => void;
  lost: () => void;
}): () => void {
  const source = new EventSource("/api/events");
  source.onopen = handlers.open;
  source.onerror = handlers.lost;
  source.addEventListener("changed", (e) => handlers.changed((JSON.parse((e as MessageEvent<string>).data) as { paths: string[] }).paths));
  return () => source.close();
}
