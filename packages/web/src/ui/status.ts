import type { Connection } from "../live/session";
import type { Loaded } from "../live/load";

/**
 * Header status (live chip, title), the error toast, and the scene summary
 * shown in the diagram panel until the renderer draws the scene.
 */

const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Not connected",
};

const el = (id: string) => document.getElementById(id) as HTMLElement;

export function showConnection(state: Connection): void {
  el("live-chip").dataset.state = state === "live" ? "live" : state === "reconnecting" ? "error" : "idle";
  el("live-label").textContent = LABEL[state];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function showLoaded(r: Loaded): void {
  const title = r.scene.title;
  el("doc-title").textContent = title;
  document.title = `${title} — umlify`;
  el("toast").hidden = true;

  const boxes = r.scene.nodes.filter((n) => n.kind === "box").length;
  const ovals = r.scene.nodes.length - boxes;
  const summary = el("scene-summary");
  summary.hidden = false;
  el("empty-state").hidden = true;
  summary.querySelector("h2")!.textContent = title;
  summary.querySelector("[data-counts]")!.textContent = [
    count(boxes, "box", "boxes"),
    count(r.scene.edges.length, "arrow", "arrows"),
    ...(ovals > 0 ? [count(ovals, "library", "libraries")] : []),
  ].join(" · ");
  summary.querySelector("[data-source]")!.textContent =
    `${r.path} · ${r.metricsFiles > 0 ? count(r.metricsFiles, "metrics file", "metrics files") : "no metrics"} · laid out in ${Math.round(r.layoutMs)} ms`;
}

export function showFailure(message: string): void {
  const toast = el("toast");
  toast.querySelector("[data-message]")!.textContent = message;
  toast.hidden = false;
}
