import {
  combinedGrade,
  crapGrade,
  crapRisk,
  mutationGrade,
  mutationRatio,
  WORST,
  BEST,
  type DiagramClass,
  type UMLDocument,
} from "@umlify/core";

/**
 * A box's colour, umlviewer's way: the average of its CRAP and mutation
 * grades (1 red … 5.5 amber … 10 green), drawn with archify's security,
 * cloud and backend tokens so every theme and preset applies.
 */

export interface Grades {
  crap: number;
  mutation: number;
  combined: number;
}

export function gradesOf(c: DiagramClass): Grades {
  const crap = crapGrade(crapRisk(c.crap));
  const mutation = mutationGrade(mutationRatio(c));
  return { crap, mutation, combined: combinedGrade(crap, mutation) ?? WORST };
}

/** CSS colour for a grade: red at 1, amber at 5.5, green at 10, blended in between. */
export function gradeColor(grade: number): string {
  const t = Math.min(1, Math.max(0, (grade - WORST) / (BEST - WORST)));
  if (t <= 0) return "var(--security-stroke)";
  if (t >= 1) return "var(--backend-stroke)";
  if (t === 0.5) return "var(--cloud-stroke)";
  return t < 0.5
    ? `color-mix(in oklab, var(--cloud-stroke) ${Math.round(t * 200)}%, var(--security-stroke))`
    : `color-mix(in oklab, var(--backend-stroke) ${Math.round((t - 0.5) * 200)}%, var(--cloud-stroke))`;
}

/** The colour when nothing in the document carries metrics: grading it all red would say nothing. */
export const NEUTRAL = "var(--external-stroke)";

const measured = (c: DiagramClass) =>
  c.crap?.mu !== undefined || c.killed !== undefined || c.survived !== undefined || c.ops.some((o) => o.crap !== undefined || o.killed !== undefined);

/** True when any class carries CRAP or mutation data, from snapshots or authored. */
export function hasMetrics(doc: UMLDocument): boolean {
  if (doc.kind === "hierarchy") return doc.doc.classes.some(measured);
  return doc.diagrams.some((d) => d.packages.some((p) => p.classes.some(measured)));
}
