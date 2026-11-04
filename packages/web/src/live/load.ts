import {
  applyMetrics,
  documentFrom,
  layoutDiagram,
  loadMetrics,
  readEDN,
  viewAt,
  type Diagram,
  type Metrics,
  type Scene,
  type UMLDocument,
} from "@umlify/core";
import type { MetricsFiles } from "./api";

/**
 * From file texts to a laid-out scene, all in the browser. Pure apart from
 * timing, so the live session can keep the last good result when a file
 * does not parse.
 */

export interface Loaded {
  path: string;
  doc: UMLDocument;
  metrics: Metrics;
  metricsFiles: number;
  /** The top level: the namespace tree's root, or the first hand-drawn diagram. */
  view: Diagram;
  scene: Scene;
  layoutMs: number;
}

/** A file that could not be read, with the reason. */
export class LoadError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "LoadError";
  }
}

function attempt<T>(path: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    throw new LoadError(path, (e as Error).message);
  }
}

export function topView(doc: UMLDocument): Diagram {
  if (doc.kind === "hierarchy") return viewAt(doc.doc, []);
  const first = doc.diagrams[0];
  if (!first) throw new Error("the file holds no diagram");
  return first;
}

export function load(path: string, irText: string, files: MetricsFiles): Loaded {
  const raw = attempt(path, () => readEDN(irText));
  const metrics = attempt(".metrics", () => loadMetrics(files.crap, files.mutate));
  const doc = attempt(path, () => applyMetrics(documentFrom(raw), metrics));
  const view = attempt(path, () => topView(doc));
  const started = performance.now();
  const scene = layoutDiagram(view);
  return {
    path,
    doc,
    metrics,
    metricsFiles: (files.crap ? 1 : 0) + files.mutate.length,
    view,
    scene,
    layoutMs: performance.now() - started,
  };
}
