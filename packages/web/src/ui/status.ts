import type { Scene } from "@umlify/core";
import { documentTitle, type Loaded } from "../live/load";
import type { Connection } from "../live/session";

/** Header status (live chip, title) and the error toast. */

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
  const title = documentTitle(r.doc);
  el("doc-title").textContent = title;
  document.title = `${title} — umlify`;
  el("toast").hidden = true;
  el("empty-state").hidden = true;
}

/** What is on screen, in the live chip's tooltip. */
export function showRendered(r: Loaded, scene: Scene, layoutMs: number): void {
  const boxes = scene.nodes.filter((nd) => nd.kind === "box").length;
  el("live-chip").title = [
    r.path,
    r.metricsFiles > 0 ? count(r.metricsFiles, "metrics file", "metrics files") : "no metrics",
    `${count(boxes, "box", "boxes")}, ${count(scene.edges.length, "arrow", "arrows")}`,
    `laid out in ${Math.round(layoutMs)} ms`,
  ].join(" · ");
}

export function showFailure(message: string): void {
  const toast = el("toast");
  toast.querySelector("[data-message]")!.textContent = message;
  toast.hidden = false;
}
