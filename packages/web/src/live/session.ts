import { fetchFile, fetchMetrics, fetchProject, subscribe } from "./api";
import { load, type Loaded } from "./load";

/**
 * The live session: load the IR named by `?file=` (else the one the server
 * was started with), reload when the server reports a change to it or to
 * `.metrics/`, and keep the last good result when a reload fails.
 */

export type Connection = "connecting" | "live" | "reconnecting" | "offline";

export interface SessionEvents {
  connection(state: Connection): void;
  /** A new good result. */
  loaded(result: Loaded): void;
  /** A load failed; the last good result (if any) stays. */
  failed(message: string): void;
}

const relevant = (paths: string[], ir: string) =>
  paths.length === 0 || paths.some((p) => p === ir || p.startsWith(".metrics/"));

export async function startSession(on: SessionEvents): Promise<void> {
  on.connection("connecting");
  let ir: string;
  try {
    const project = await fetchProject();
    ir = new URLSearchParams(location.search).get("file") ?? project.ir;
  } catch {
    // Opened without the umlify server (e.g. the Vite dev server alone).
    on.connection("offline");
    return;
  }

  // Responses can arrive out of order when changes come quickly; only the
  // newest request may update the page.
  let generation = 0;
  async function reload(): Promise<void> {
    const mine = ++generation;
    try {
      const [text, files] = await Promise.all([fetchFile(ir), fetchMetrics()]);
      if (mine !== generation) return;
      on.loaded(load(ir, text, files));
    } catch (e) {
      if (mine === generation) on.failed((e as Error).message);
    }
  }

  let seen = false;
  subscribe({
    open: () => {
      on.connection("live");
      // Changes made while disconnected were not announced.
      if (seen) void reload();
      seen = true;
    },
    lost: () => on.connection("reconnecting"),
    changed: (paths) => {
      if (relevant(paths, ir)) void reload();
    },
  });
  await reload();
}
