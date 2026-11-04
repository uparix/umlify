import type { NodeID } from "@umlify/core";

/**
 * The view a reader is on — the level (namespace path) and the selected
 * box — kept in the URL hash so a link or a reload opens the same view, and
 * the browser's Back button leaves a drilled level.
 */

export interface ViewState {
  path: string[];
  selected?: NodeID;
}

export function parseHash(hash: string): ViewState {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const path = q.get("path");
  const selected = q.get("sel") ?? undefined;
  return { path: path ? path.split("/").filter(Boolean) : [], selected };
}

export function formatHash(s: ViewState): string {
  const q = new URLSearchParams();
  if (s.path.length > 0) q.set("path", s.path.join("/"));
  if (s.selected) q.set("sel", s.selected);
  const text = q.toString();
  return text ? `#${text}` : "";
}
