import { applyMetrics, documentFrom, loadMetrics, readEDN, type UMLDocument } from "@umlify/core";
import { hasMetrics } from "../render/grade";
import type { MetricsFiles } from "./api";

/**
 * From file texts to a painted document, all in the browser. Pure, so the
 * live session can keep the last good result when a file does not parse.
 */

export interface Loaded {
  path: string;
  doc: UMLDocument;
  metricsFiles: number;
  /** Whether any class carries metrics; without any, boxes are not graded. */
  graded: boolean;
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

export function load(path: string, irText: string, files: MetricsFiles): Loaded {
  const raw = attempt(path, () => readEDN(irText));
  const metrics = attempt(".metrics", () => loadMetrics(files.crap, files.mutate));
  const doc = attempt(path, () => applyMetrics(documentFrom(raw), metrics));
  if (doc.kind === "diagrams" && doc.diagrams.length === 0) throw new LoadError(path, "the file holds no diagram");
  return { path, doc, metricsFiles: (files.crap ? 1 : 0) + files.mutate.length, graded: hasMetrics(doc) };
}

export const documentTitle = (doc: UMLDocument): string => (doc.kind === "hierarchy" ? (doc.doc.title ?? "UML") : doc.title);
