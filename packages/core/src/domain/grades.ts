import type { CrapSummary, DiagramClass, Mutants } from "./model";
import { scoreOf } from "./model";

/**
 * CRAP and mutation thresholds, 1–10 grades, and pooling across modules
 * (umlviewer `Grades.swift`, Clojure `uml-viewer.domain.config`).
 * Missing data always counts as red.
 */

export type Band = "green" | "yellow" | "red";

/** CRAP μ+σ. Lower is better. */
export const CRAP_GREEN = 8;
export const CRAP_YELLOW = 12;
export const CRAP_RED = 20;

/** Mutation score 0–1. Higher is better. */
export const MUTATION_RED = 0.8;
export const MUTATION_YELLOW = 0.9;
export const MUTATION_GREEN = 1;

export const BEST = 10;
export const MID = 5.5;
export const WORST = 1;

export function crapBand(score: number | undefined): Band {
  if (score === undefined) return "red";
  if (score <= CRAP_GREEN) return "green";
  if (score <= CRAP_YELLOW) return "yellow";
  return "red";
}

export function mutationBand(score: number | undefined): Band {
  if (score === undefined) return "red";
  if (score <= MUTATION_RED) return "red";
  if (score <= MUTATION_YELLOW) return "yellow";
  return "green";
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return x0 === x1 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function along(x: number, x0: number, x1: number, x2: number, y0: number, y1: number, y2: number): number {
  if (x <= x0) return y0;
  if (x <= x1) return lerp(x, x0, x1, y0, y1);
  if (x <= x2) return lerp(x, x1, x2, y1, y2);
  return y2;
}

/** μ+σ, or undefined without μ. */
export function crapRisk(crap: CrapSummary | undefined): number | undefined {
  return crap?.mu === undefined ? undefined : crap.mu + (crap.sigma ?? 0);
}

export function crapGrade(score: number | undefined): number {
  return score === undefined ? WORST : along(score, CRAP_GREEN, CRAP_YELLOW, CRAP_RED, BEST, MID, WORST);
}

/** Killed over killed + survived + gap. Undefined without data, or with none tried. */
export function mutationRatio(m: Mutants): number | undefined {
  const gap = m.mutGap ?? 0;
  if (m.killed === undefined && m.survived === undefined && gap <= 0) return undefined;
  const n = (m.killed ?? 0) + (m.survived ?? 0) + gap;
  return n > 0 ? (m.killed ?? 0) / n : undefined;
}

export function mutationGrade(score: number | undefined): number {
  return score === undefined ? WORST : along(score, MUTATION_RED, MUTATION_YELLOW, MUTATION_GREEN, WORST, MID, BEST);
}

/** Average of the grades present; undefined when both are missing. */
export function combinedGrade(crap: number | undefined, mutation: number | undefined): number | undefined {
  const xs = [crap, mutation].filter((x): x is number => x !== undefined);
  return xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest tenth, rounding half up like `Math/round`. */
export function round1(x: number): number {
  return Math.floor(x * 10 + 0.5) / 10;
}

/** Functions listed on a module, or one when it lists none. */
export function functionWeight(c: DiagramClass): number {
  return c.ops.length === 0 ? 1 : c.ops.length;
}

// ---------- CRAP pooling ----------

interface Group {
  n: number;
  mu: number;
  sigma: number;
  max: number;
}

function scoreGroup(xs: number[]): Group {
  const n = xs.length;
  const mu = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.map((x) => (x - mu) * (x - mu)).reduce((a, b) => a + b, 0) / n;
  return { n, mu, sigma: Math.sqrt(variance), max: Math.max(...xs) };
}

function rounded(g: Group): CrapSummary {
  return { mu: round1(g.mu), max: round1(g.max), sigma: round1(g.sigma), n: g.n };
}

/** μ, max, population σ, and count of the scores, to 0.1. Undefined when empty. */
export function summarizeScores(scores: number[]): CrapSummary | undefined {
  return scores.length === 0 ? undefined : rounded(scoreGroup(scores));
}

function opScores(c: DiagramClass): number[] {
  return c.ops.map((o) => scoreOf(o.crap)).filter((s): s is number => s !== undefined);
}

function summaryWeight(c: DiagramClass, s: CrapSummary, scores: number[]): number {
  if (s.n !== undefined && s.n > 0) return s.n;
  if (scores.length > 0) return scores.length;
  return functionWeight(c);
}

function known(n: number, s: CrapSummary & { mu: number }): Group {
  return { n, mu: s.mu, sigma: s.sigma ?? 0, max: s.max ?? s.mu };
}

/**
 * One module as an unrounded group. With `rolled`, a summary that already
 * covers the subtree wins over local ops. No data is the red threshold once
 * per function.
 */
function crapSample(c: DiagramClass, rolled: boolean): Group {
  const scores = opScores(c);
  const summary = c.crap?.mu !== undefined ? (c.crap as CrapSummary & { mu: number }) : undefined;
  if (rolled && summary) return known(summaryWeight(c, summary, scores), summary);
  if (scores.length > 0) return scoreGroup(scores);
  if (summary) return known(summaryWeight(c, summary, scores), summary);
  return { n: functionWeight(c), mu: CRAP_RED, sigma: 0, max: CRAP_RED };
}

function combine(all: Group[]): CrapSummary | undefined {
  const groups = all.filter((g) => g.n > 0);
  if (groups.length === 0) return undefined;
  const n = groups.reduce((a, g) => a + g.n, 0);
  const sumW = groups.reduce((a, g) => a + g.n * g.mu, 0);
  const sumM2 = groups.reduce((a, g) => a + g.n * (g.sigma * g.sigma + g.mu * g.mu), 0);
  const mu = sumW / n;
  const variance = Math.max(0, sumM2 / n - mu * mu);
  return rounded({ n, mu, sigma: Math.sqrt(variance), max: Math.max(...groups.map((g) => g.max)) });
}

const isModule = (c: DiagramClass) => !(c.foreign || c.shape === "oval");

/**
 * Function-weighted μ, max, and σ across modules. `rolled` means each
 * `crap` already pools that module's subtree.
 */
export function poolCrap(classes: DiagramClass[], rolled = false): CrapSummary | undefined {
  return combine(classes.filter(isModule).map((c) => crapSample(c, rolled)));
}

// ---------- mutation pooling ----------

const hasMutants = (c: DiagramClass) => c.killed !== undefined || c.survived !== undefined;

function mutantGap(c: DiagramClass): number {
  if (hasMutants(c) || c.mutGap !== undefined) return c.mutGap ?? 0;
  return functionWeight(c);
}

/**
 * Summed killed, survived, and uncovered. A module with no mutant data adds
 * failed trials (`mutGap`), one per function.
 */
export function poolMutants(classes: DiagramClass[]): Mutants | undefined {
  const modules = classes.filter(isModule);
  const measured = modules.filter(hasMutants);
  const uncovered = modules.map((c) => c.uncovered).filter((u): u is number => u !== undefined);
  const gap = modules.reduce((a, c) => a + mutantGap(c), 0);
  if (measured.length === 0 && gap <= 0) return undefined;
  const m: Mutants = {};
  if (measured.length > 0) {
    m.killed = measured.reduce((a, c) => a + (c.killed ?? 0), 0);
    m.survived = measured.reduce((a, c) => a + (c.survived ?? 0), 0);
  }
  if (uncovered.length > 0) m.uncovered = uncovered.reduce((a, b) => a + b, 0);
  if (gap > 0) m.mutGap = gap;
  return m;
}
