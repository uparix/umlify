import { DECLUTTER_MODES, type Declutter, type NodeID } from "@umlify/core";

/**
 * The view a reader is on, kept in the URL hash so a link or a reload opens
 * the same view and the browser's Back button leaves a drilled level:
 * level (namespace path) or proposal (and its open layer), declutter mode,
 * selection, and a dependency trace from the selection.
 */

export type Trace = "up" | "down";

export interface ViewState {
  path: string[];
  selected?: NodeID;
  /** A proposal instead of the code's namespace tree. */
  proposal?: NodeID;
  /** One proposal package (or nested group) opened on its own. */
  layer?: NodeID;
  mode?: Declutter;
  /** Follow dependents (up) or dependencies (down) of the selection. */
  trace?: Trace;
}

export function parseHash(hash: string): ViewState {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const path = q.get("path");
  const mode = q.get("mode");
  const trace = q.get("trace");
  return {
    path: path ? path.split("/").filter(Boolean) : [],
    selected: q.get("sel") ?? undefined,
    proposal: q.get("prop") ?? undefined,
    layer: q.get("layer") ?? undefined,
    mode: (DECLUTTER_MODES as readonly string[]).includes(mode ?? "") && mode !== "full" ? (mode as Declutter) : undefined,
    trace: trace === "up" || trace === "down" ? trace : undefined,
  };
}

export function formatHash(s: ViewState): string {
  const q = new URLSearchParams();
  if (s.proposal) q.set("prop", s.proposal);
  if (s.layer) q.set("layer", s.layer);
  if (s.path.length > 0) q.set("path", s.path.join("/"));
  if (s.mode && s.mode !== "full") q.set("mode", s.mode);
  if (s.selected) q.set("sel", s.selected);
  if (s.selected && s.trace) q.set("trace", s.trace);
  const text = q.toString();
  return text ? `#${text}` : "";
}

/** Same level, proposal, layer and mode: the scene need not be laid out again. */
export const sameView = (a: ViewState, b: ViewState) =>
  a.path.join("/") === b.path.join("/") && a.proposal === b.proposal && a.layer === b.layer && (a.mode ?? "full") === (b.mode ?? "full");
