import type { NodeID } from "../domain/model";

/**
 * Automatic row/col cells for archify's banded grid, which takes cells from
 * the author. Rows come from architectural level (highest on top, as
 * umlviewer stacks them) or, without levels, from dependency depth: a module
 * sits above what it depends on. Columns are ordered by barycenter sweeps to
 * cut crossings, and short rows are centred with archify's half-step cells.
 */

export interface GridNode {
  id: NodeID;
  /** Nodes of one group are stacked together, groups top to bottom. */
  group: number;
  level?: number;
}

export interface GridEdge {
  from: NodeID;
  to: NodeID;
}

export interface Cell {
  row: number;
  col: number;
}

export interface GridOptions {
  /** Longest row before it wraps. */
  maxCols: number;
  /** Rows become columns (`:direction :lr`). Rows are not centred then. */
  transpose: boolean;
  /** Empty rows left between groups, for their frame labels. */
  groupGap: number;
}

const SWEEPS = 4;

/** Longest-path depth from the nodes nobody depends on; cycles are broken in input order. */
function depths(ids: NodeID[], edges: GridEdge[]): Map<NodeID, number> {
  const inSet = new Set(ids);
  const preds = new Map<NodeID, NodeID[]>(ids.map((id) => [id, []]));
  const succs = new Map<NodeID, NodeID[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!inSet.has(e.from) || !inSet.has(e.to) || e.from === e.to) continue;
    succs.get(e.from)?.push(e.to);
    preds.get(e.to)?.push(e.from);
  }
  const depth = new Map<NodeID, number>();
  const placed = new Set<NodeID>();
  const waiting = new Map(ids.map((id) => [id, preds.get(id)?.length ?? 0]));
  while (placed.size < ids.length) {
    // Every node whose dependents are all placed; else force the first
    // unplaced node with the fewest unplaced dependents (a cycle).
    let ready = ids.filter((id) => !placed.has(id) && waiting.get(id) === 0);
    if (ready.length === 0) {
      const rest = ids.filter((id) => !placed.has(id));
      const fewest = Math.min(...rest.map((id) => waiting.get(id) as number));
      ready = [rest.find((id) => waiting.get(id) === fewest) as NodeID];
    }
    for (const id of ready) {
      const d = Math.max(-1, ...(preds.get(id) ?? []).filter((p) => placed.has(p)).map((p) => depth.get(p) as number)) + 1;
      depth.set(id, d);
      placed.add(id);
      for (const s of succs.get(id) ?? []) waiting.set(s, (waiting.get(s) as number) - 1);
    }
  }
  return depth;
}

/**
 * Layers of one group, top first: by level when the group has more than one,
 * else by dependency depth (a proposal layer stamps one level on all its
 * classes, which would order nothing).
 */
function layers(nodes: GridNode[], edges: GridEdge[]): NodeID[][] {
  const levelled = nodes.filter((n) => n.level !== undefined);
  const levels = [...new Set(levelled.map((n) => n.level as number))].sort((a, b) => b - a);
  if (levels.length > 1) {
    const out = levels.map((lv) => nodes.filter((n) => n.level === lv).map((n) => n.id));
    const unlevelled = nodes.filter((n) => n.level === undefined).map((n) => n.id);
    return unlevelled.length > 0 ? [...out, unlevelled] : out;
  }
  const d = depths(
    nodes.map((n) => n.id),
    edges,
  );
  const max = Math.max(0, ...d.values());
  return Array.from({ length: max + 1 }, (_, i) => nodes.filter((n) => d.get(n.id) === i).map((n) => n.id));
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Centred position of each node in its row, so rows of different length line up. */
function positions(rows: NodeID[][]): Map<NodeID, number> {
  const pos = new Map<NodeID, number>();
  for (const row of rows) row.forEach((id, i) => pos.set(id, i - (row.length - 1) / 2));
  return pos;
}

/** Reorder each row by the mean position of its neighbours in the row before it. */
function sweep(rows: NodeID[][], neighbours: Map<NodeID, NodeID[]>): void {
  for (let r = 1; r < rows.length; r++) {
    const pos = positions([rows[r - 1] as NodeID[]]);
    const row = rows[r] as NodeID[];
    const key = new Map(
      row.map((id, i) => {
        const ns = (neighbours.get(id) ?? []).filter((n) => pos.has(n));
        const own = i - (row.length - 1) / 2;
        return [id, ns.length === 0 ? own : ns.reduce((s, n) => s + (pos.get(n) as number), 0) / ns.length];
      }),
    );
    row.sort((a, b) => (key.get(a) as number) - (key.get(b) as number));
  }
}

/** Cells for every node: groups stacked, then the foreign row(s) at the bottom. */
export function assignCells(nodes: GridNode[], foreign: NodeID[], edges: GridEdge[], opts: GridOptions): Map<NodeID, Cell> {
  const groups = [...new Set(nodes.map((n) => n.group))].sort((a, b) => a - b);
  const rows: NodeID[][] = [];
  groups.forEach((g, gi) => {
    if (gi > 0) for (let i = 0; i < opts.groupGap; i++) rows.push([]);
    const members = nodes.filter((n) => n.group === g);
    const groupEdges = edges.filter((e) => members.some((n) => n.id === e.from) && members.some((n) => n.id === e.to));
    for (const layer of layers(members, groupEdges)) if (layer.length > 0) rows.push(...chunk(layer, opts.maxCols));
  });
  if (foreign.length > 0) rows.push(...chunk([...foreign], opts.maxCols));

  // Barycenter sweeps down and up; an empty row passes no positions along.
  const neighbours = new Map<NodeID, NodeID[]>();
  const link = (a: NodeID, b: NodeID) => neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  for (const e of edges) {
    if (e.from === e.to) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }
  for (let i = 0; i < SWEEPS; i++) {
    sweep(rows, neighbours);
    rows.reverse();
    sweep(rows, neighbours);
    rows.reverse();
  }

  const width = Math.max(1, ...rows.map((r) => r.length));
  const cells = new Map<NodeID, Cell>();
  rows.forEach((row, r) => {
    const offset = opts.transpose ? 0 : (width - row.length) / 2;
    row.forEach((id, i) => cells.set(id, opts.transpose ? { row: i, col: r } : { row: r, col: i + offset }));
  });
  return cells;
}
