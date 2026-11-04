import { nodeLabel } from "../domain/hierarchy";
import type { Diagram, DiagramClass, EdgeKind, LeafDep, NodeID } from "../domain/model";
import { bandedLayout, resolveEntityPos } from "./archify/grid.mjs";
import { legacyDefaultFromSide, legacyDefaultToSide } from "./archify/geometry.mjs";
import { createRouter, type Point, type RouterComponent, type Side } from "./archify/routing.mjs";
import { CARD, measureCard, type Card } from "./card";
import { assignCells } from "./grid";

/**
 * One diagram (a hierarchy view or a hand-drawn diagram) placed on
 * archify's banded grid and routed with archify's router. The result is
 * everything the renderer draws; it holds no DOM and is the same for the
 * same input.
 */

export interface SceneNode {
  id: NodeID;
  kind: "box" | "oval";
  /** The package the node sits in; absent for foreign ovals. */
  package?: NodeID;
  cls: DiagramClass;
  card: Card;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneEdge {
  id: string;
  from: NodeID;
  to: NodeID;
  kind: EdgeKind;
  violating: boolean;
  label?: string;
  /** The leaf dependencies a collapsed arrow bundles. */
  deps?: LeafDep[];
  points: Point[];
  /** SVG path data with archify's rounded corners. */
  d: string;
  fromSide: Side;
  toSide: Side;
}

/** A package drawn around its boxes when a diagram has several. */
export interface SceneFrame {
  id: NodeID;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Scene {
  title: string;
  proposal: boolean;
  /** Declutter "triangles": draw no arrows. */
  hideEdges: boolean;
  width: number;
  height: number;
  nodes: SceneNode[];
  edges: SceneEdge[];
  frames: SceneFrame[];
}

/** archify's class grid (gaps leave room for markers and labels), plus umlify's row wrap and frames. */
export const LAYOUT = {
  originX: 40,
  originY: 40,
  framedOriginY: 72,
  gapX: 128,
  gapY: 84,
  margin: 24,
  maxCols: 6,
  framePad: 18,
  frameLabelH: 26,
  minWidth: 320,
  minHeight: 240,
} as const;

const GENERALIZATION = new Set(["implements", "inheritance"]);

const titleOf = (c: DiagramClass) => c.name ?? nodeLabel(c.id);
const isOval = (c: DiagramClass) => c.foreign || c.shape === "oval";

export function layoutDiagram(d: Diagram): Scene {
  const framed = d.packages.length > 1;
  const placedIn = new Map<NodeID, NodeID>();
  const classes: DiagramClass[] = [];
  d.packages.forEach((p) =>
    p.classes.forEach((c) => {
      placedIn.set(c.id, p.id);
      classes.push(c);
    }),
  );
  const all = [...classes, ...d.foreign];
  const byID = new Map(all.map((c) => [c.id, c]));
  const edges = d.edges.filter((e) => byID.has(e.from) && byID.has(e.to) && e.from !== e.to);

  // ---- cells ----
  const groupOf = new Map(d.packages.map((p, i) => [p.id, i]));
  const cells = assignCells(
    classes.map((c) => ({ id: c.id, group: groupOf.get(placedIn.get(c.id) as NodeID) ?? 0, level: c.level })),
    d.foreign.map((c) => c.id),
    edges,
    { maxCols: LAYOUT.maxCols, transpose: d.direction === "lr", groupGap: framed ? 1 : 0 },
  );

  // ---- placement on archify's banded grid ----
  const measured = all.map((c) => {
    const card = measureCard(c, titleOf(c));
    const cell = cells.get(c.id) as { row: number; col: number };
    return { c, card, row: cell.row, col: cell.col, width: card.width, height: card.height };
  });
  const grid = {
    origin: [LAYOUT.originX, framed ? LAYOUT.framedOriginY : LAYOUT.originY] as [number, number],
    gapX: LAYOUT.gapX,
    gapY: LAYOUT.gapY,
    entityW: CARD.minW,
  };
  const bands = bandedLayout(measured, grid);
  const nodes: SceneNode[] = measured.map((m) => {
    const [x, top] = resolveEntityPos(m, grid, bands);
    // Centred in the row band, so an arrow between two boxes of a row is straight.
    const y = top + ((bands.heights.get(m.row) ?? m.height) - m.height) / 2;
    return {
      id: m.c.id,
      kind: isOval(m.c) ? "oval" : "box",
      package: placedIn.get(m.c.id),
      cls: m.c,
      card: m.card,
      row: m.row,
      col: m.col,
      x,
      y,
      width: m.width,
      height: m.height,
    };
  });

  // ---- frames ----
  const frames: SceneFrame[] = framed
    ? d.packages.flatMap((p) => {
        const inside = nodes.filter((n) => n.package === p.id);
        if (inside.length === 0) return [];
        const x0 = Math.min(...inside.map((n) => n.x)) - LAYOUT.framePad;
        const y0 = Math.min(...inside.map((n) => n.y)) - LAYOUT.framePad - LAYOUT.frameLabelH;
        const x1 = Math.max(...inside.map((n) => n.x + n.width)) + LAYOUT.framePad;
        const y1 = Math.max(...inside.map((n) => n.y + n.height)) + LAYOUT.framePad;
        return [{ id: p.id, label: p.label ?? p.id, x: x0, y: y0, width: x1 - x0, height: y1 - y0 }];
      })
    : [];

  // ---- routes ----
  const components = new Map<string, RouterComponent>(
    nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, cx: n.x + n.width / 2, cy: n.y + n.height / 2 }]),
  );
  const connections = edges.map((e) => ({ ...e, id: `${e.from}->${e.to}` }));
  // As archify's class renderer: a generalization stands vertically unless
  // the two boxes are side by side; stacked boxes use their facing sides.
  const sideFor = (conn: (typeof connections)[number], endpoint: "source" | "target"): Side | undefined => {
    const from = components.get(conn.from);
    const to = components.get(conn.to);
    if (!from || !to) return undefined;
    const overlapX = from.x < to.x + to.width && to.x < from.x + from.width;
    const overlapY = from.y < to.y + to.height && to.y < from.y + from.height;
    const vertical = overlapX || (!overlapY && GENERALIZATION.has(conn.kind));
    if (!vertical) return endpoint === "source" ? legacyDefaultFromSide(from, to) : legacyDefaultToSide(from, to);
    const down = to.cy > from.cy;
    if (endpoint === "source") return down ? "bottom" : "top";
    return down ? "top" : "bottom";
  };
  const router = createRouter(components, connections, {
    frames,
    sideFor,
    maxPortSpacing: 26,
    preferReadableRoutes: true,
    crossingFreeGridFirst: true,
    componentGapPx: 10,
  });
  const sceneEdges: SceneEdge[] = connections.map((conn) => {
    const { points, d: path } = router.pathFor(conn);
    return {
      id: conn.id,
      from: conn.from,
      to: conn.to,
      kind: conn.kind,
      violating: conn.violating,
      label: conn.label,
      deps: conn.deps,
      points,
      d: path,
      fromSide: router.connectionEndpointSide(conn, "source"),
      toSide: router.connectionEndpointSide(conn, "target"),
    };
  });

  // ---- extent ----
  // Detours may leave the boxes' extent, so routes count too.
  const rects = [...nodes, ...frames];
  const routePoints = sceneEdges.flatMap((e) => e.points);
  const right = Math.max(0, ...rects.map((r) => r.x + r.width), ...routePoints.map((p) => p[0]));
  const bottom = Math.max(0, ...rects.map((r) => r.y + r.height), ...routePoints.map((p) => p[1]));
  const width = Math.ceil(Math.max(LAYOUT.minWidth, right + LAYOUT.margin));
  const height = Math.ceil(Math.max(LAYOUT.minHeight, bottom + LAYOUT.margin));
  return { title: d.title, proposal: d.proposal, hideEdges: d.hideEdges, width, height, nodes, edges: sceneEdges, frames };
}
