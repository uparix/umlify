import {
  applyDeclutter,
  layerView,
  layoutDiagram,
  namedProposals,
  proposalView,
  segs,
  viewAt,
  type Declutter,
  type Diagram,
  type HierarchyDocument,
  type NodeID,
  type Scene,
} from "@umlify/core";
import { documentTitle, type Loaded } from "../live/load";
import { renderScene } from "../render/svg";
import { centerOn, fit, pan, transformOf, visibleWorld, zoomAt, type Camera } from "./camera";
import { formatHash, parseHash, sameView, type Trace, type ViewState } from "./state";

/**
 * The diagram on screen: builds the view for the current level or proposal
 * and declutter mode, lays it out, draws it, and handles pan, zoom,
 * selection, tracing, drill-down, breadcrumbs and the minimap. A live
 * reload keeps the view, the selection and the camera.
 */

export interface ViewerEvents {
  /** After every change of view or selection. */
  changed(info: { loaded: Loaded; scene: Scene; state: ViewState; layoutMs: number }): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ZOOM_STEP = 1.25;
const KEY_PAN = 48;
const DRAG_SLOP = 3;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Nodes and arrows reachable from `id` along the arrows (down) or against them (up). */
export function traceFrom(scene: Scene, id: NodeID, dir: Trace): { nodes: Set<NodeID>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift() as NodeID;
    for (const e of scene.edges) {
      const [from, to] = dir === "down" ? [e.from, e.to] : [e.to, e.from];
      if (from !== cur) continue;
      edges.add(e.id);
      if (!nodes.has(to)) {
        nodes.add(to);
        queue.push(to);
      }
    }
  }
  return { nodes, edges };
}

export class Viewer {
  private loaded?: Loaded;
  private scene?: Scene;
  private layoutMs = 0;
  private state: ViewState = parseHash(location.hash);
  private camera: Camera = { x: 0, y: 0, k: 1 };
  /** The reader moved the camera since the last fit; a reload then keeps it. */
  private moved = false;
  private readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private readonly minimap: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly on: ViewerEvents,
  ) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("diagram-svg");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("hidden", "");
    this.viewport = document.createElementNS(SVG_NS, "g");
    this.viewport.classList.add("viewport");
    this.svg.append(this.viewport);
    container.prepend(this.svg);

    this.minimap = document.createElement("div");
    this.minimap.className = "minimap";
    this.minimap.hidden = true;
    this.minimap.setAttribute("aria-label", "Overview: click to move there");
    container.append(this.minimap);

    this.bindPointer();
    this.bindKeys();
    this.bindButtons();
    window.addEventListener("popstate", () => this.go(parseHash(location.hash), false));
    new ResizeObserver(() => {
      if (!this.scene) return;
      if (this.moved) this.applyCamera();
      else this.fitView();
    }).observe(container);
  }

  get current(): { loaded: Loaded; scene: Scene; state: ViewState } | undefined {
    return this.loaded && this.scene ? { loaded: this.loaded, scene: this.scene, state: this.state } : undefined;
  }

  /** A new or reloaded document. Keeps view, selection and camera when they still apply. */
  show(loaded: Loaded): void {
    const sameFile = this.loaded?.path === loaded.path;
    this.loaded = loaded;
    if (!sameFile) this.moved = false;
    this.render(this.state, this.moved);
    this.writeHash(false);
  }

  // ---------- views ----------

  private hierarchy(): HierarchyDocument | undefined {
    const doc = this.loaded?.doc;
    return doc?.kind === "hierarchy" ? doc.doc : undefined;
  }

  /** `wanted` with whatever no longer exists in the document dropped. */
  private resolve(wanted: ViewState): ViewState {
    const doc = this.hierarchy();
    if (!doc) return { path: [], selected: wanted.selected, mode: wanted.mode, trace: wanted.trace };
    if (wanted.proposal !== undefined) {
      if (!namedProposals(doc).some((p) => p.id === wanted.proposal)) return this.resolve({ ...wanted, proposal: undefined, layer: undefined });
      const root = proposalView(doc, wanted.proposal);
      const layerExists =
        wanted.layer !== undefined &&
        root.packages.some((p) => p.id === wanted.layer || p.classes.some((c) => c.id === wanted.layer && c.proposalGroup));
      return { ...wanted, path: [], layer: layerExists ? wanted.layer : undefined };
    }
    let path = wanted.path;
    while (path.length > 0 && !viewAt(doc, path).packages.some((p) => p.classes.length > 0)) path = path.slice(0, -1);
    return { ...wanted, path, layer: undefined };
  }

  private viewFor(s: ViewState): Diagram {
    const loaded = this.loaded as Loaded;
    const doc = this.hierarchy();
    let mode: Declutter = s.mode ?? "full";
    // An open layer is one package already; "classes" would empty it.
    if (s.layer && mode === "classes") mode = "elements";
    const source = !doc
      ? ((loaded.doc.kind === "diagrams" ? loaded.doc.diagrams[0] : undefined) as Diagram)
      : s.proposal
        ? s.layer
          ? layerView(doc, s.proposal, s.layer)
          : proposalView(doc, s.proposal)
        : viewAt(doc, s.path);
    return applyDeclutter(source, mode);
  }

  private render(wanted: ViewState, keepCamera: boolean): void {
    const s = this.resolve(wanted);
    const started = performance.now();
    const scene = layoutDiagram(this.viewFor(s));
    this.layoutMs = performance.now() - started;
    const selected = s.selected && scene.nodes.some((n) => n.id === s.selected) ? s.selected : undefined;
    this.scene = scene;
    this.state = { ...s, selected, trace: selected ? s.trace : undefined };

    this.svg.removeAttribute("hidden");
    this.svg.setAttribute("aria-label", `${scene.title}: ${scene.nodes.length} boxes`);
    this.viewport.innerHTML = renderScene(scene, { graded: (this.loaded as Loaded).graded });
    this.applySelection();
    this.renderBreadcrumbs();
    this.renderMinimap();
    if (keepCamera) this.applyCamera();
    else this.fitView();
    for (const id of ["btn-zoom-in", "btn-zoom-out", "btn-fit", "btn-export", "btn-find"]) {
      document.getElementById(id)?.removeAttribute("disabled");
    }
    this.notify();
  }

  private notify(): void {
    if (this.loaded && this.scene) this.on.changed({ loaded: this.loaded, scene: this.scene, state: this.state, layoutMs: this.layoutMs });
  }

  /** Go to a view; `push` adds a history entry so Back returns. */
  go(next: ViewState, push: boolean): void {
    if (!this.loaded) return;
    const viewChanged = !sameView(next, this.state);
    if (viewChanged) this.moved = false;
    this.render(next, !viewChanged);
    this.writeHash(push);
  }

  /** Open a folder box, a proposal package, or a nested proposal group. */
  drill(id: NodeID): void {
    if (!this.hierarchy()) return;
    if (this.state.proposal) this.go({ ...this.state, layer: id, selected: undefined, trace: undefined }, true);
    else this.go({ ...this.state, path: segs(id), selected: undefined, trace: undefined }, true);
  }

  up(): void {
    if (this.state.layer) this.go({ ...this.state, layer: undefined, selected: this.state.layer, trace: undefined }, true);
    else if (this.state.path.length > 0) {
      this.go({ ...this.state, path: this.state.path.slice(0, -1), selected: this.state.path.join("."), trace: undefined }, true);
    }
  }

  setMode(mode: Declutter): void {
    this.go({ ...this.state, mode }, false);
  }

  /** The code's namespace tree (undefined) or a proposal. */
  setProposal(proposal: NodeID | undefined): void {
    this.go({ path: [], proposal, mode: this.state.mode }, true);
  }

  /** Show a class wherever it lives in the namespace tree, selected. */
  reveal(id: NodeID): void {
    if (this.hierarchy()) this.go({ path: segs(id).slice(0, -1), selected: id, mode: this.state.mode }, true);
    else this.select(id);
    this.centerOnSelection();
  }

  private writeHash(push: boolean): void {
    const hash = formatHash(this.state);
    if (hash === location.hash) return;
    const url = `${location.pathname}${location.search}${hash}`;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }

  // ---------- selection and tracing ----------

  select(id: NodeID | undefined): void {
    this.state = { ...this.state, selected: id, trace: undefined };
    this.writeHash(false);
    this.applySelection();
    this.notify();
  }

  setTrace(trace: Trace | undefined): void {
    if (!this.state.selected) return;
    this.state = { ...this.state, trace };
    this.writeHash(false);
    this.applySelection();
    this.notify();
  }

  private applySelection(): void {
    const id = this.state.selected;
    for (const el of this.viewport.querySelectorAll(".u-selected, .u-related")) el.classList.remove("u-selected", "u-related");
    if (!id || !this.scene) {
      this.svg.removeAttribute("data-selection");
      return;
    }
    this.svg.setAttribute("data-selection", id);
    let nodes: Set<NodeID>;
    let edges: Set<string>;
    if (this.state.trace) ({ nodes, edges } = traceFrom(this.scene, id, this.state.trace));
    else {
      const touching = this.scene.edges.filter((e) => e.from === id || e.to === id);
      edges = new Set(touching.map((e) => e.id));
      nodes = new Set([id, ...touching.flatMap((e) => [e.from, e.to])]);
    }
    for (const e of this.viewport.querySelectorAll<SVGGElement>("[data-edge-id]")) {
      if (edges.has(e.dataset.edgeId as string)) e.classList.add("u-related");
    }
    for (const nd of this.viewport.querySelectorAll<SVGGElement>("[data-node-id]")) {
      const nid = nd.dataset.nodeId as string;
      if (nodes.has(nid)) nd.classList.add("u-related");
      if (nid === id) nd.classList.add("u-selected");
    }
  }

  private centerOnSelection(): void {
    const node = this.scene?.nodes.find((n) => n.id === this.state.selected);
    if (!node) return;
    const k = Math.max(this.camera.k, 0.8);
    this.setCamera(centerOn({ ...this.camera, k }, node.x + node.width / 2, node.y + node.height / 2, this.size()));
  }

  // ---------- camera ----------

  private size() {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  private applyCamera(): void {
    this.viewport.setAttribute("transform", transformOf(this.camera));
    this.svg.dataset.zoom = this.camera.k.toFixed(3);
    this.updateMinimapView();
  }

  private setCamera(cam: Camera): void {
    this.camera = cam;
    this.moved = true;
    this.applyCamera();
  }

  fitView(): void {
    if (!this.scene) return;
    this.camera = fit(this.scene, this.size());
    this.moved = false;
    this.applyCamera();
  }

  zoomBy(factor: number): void {
    const { width, height } = this.size();
    this.setCamera(zoomAt(this.camera, factor, width / 2, height / 2));
  }

  // ---------- breadcrumbs and minimap ----------

  private renderBreadcrumbs(): void {
    const nav = document.getElementById("breadcrumbs") as HTMLElement;
    const loaded = this.loaded as Loaded;
    const s = this.state;
    const crumbs: { label: string; to: ViewState }[] = [];
    const doc = this.hierarchy();
    if (s.proposal && doc) {
      const named = namedProposals(doc).find((p) => p.id === s.proposal);
      crumbs.push({ label: named?.name ?? s.proposal, to: { path: [], proposal: s.proposal, mode: s.mode } });
      if (s.layer) {
        const label = this.scene?.packages.find((p) => p.id === s.layer)?.label ?? s.layer;
        crumbs.push({ label, to: { ...s } });
      }
    } else if (s.path.length > 0) {
      crumbs.push({ label: documentTitle(loaded.doc), to: { path: [], mode: s.mode } });
      s.path.forEach((seg, i) => crumbs.push({ label: seg, to: { path: s.path.slice(0, i + 1), mode: s.mode } }));
    }
    if (crumbs.length === 0) {
      nav.replaceChildren();
      return;
    }
    const ol = document.createElement("ol");
    crumbs.forEach((c, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.label;
      if (i === crumbs.length - 1) b.setAttribute("aria-current", "location");
      else b.addEventListener("click", () => this.go(c.to, true));
      li.append(b);
      ol.append(li);
    });
    nav.replaceChildren(ol);
  }

  private renderMinimap(): void {
    const s = this.scene as Scene;
    const nodes = s.nodes.map((nd) => `<rect class="mm-node" x="${nd.x}" y="${nd.y}" width="${nd.width}" height="${nd.height}" rx="6"/>`).join("");
    this.minimap.innerHTML = `<svg viewBox="0 0 ${s.width} ${s.height}" aria-hidden="true">${nodes}<rect class="mm-view"/></svg>`;
  }

  private updateMinimapView(): void {
    const s = this.scene;
    const rect = this.minimap.querySelector(".mm-view");
    if (!s || !rect) return;
    const v = visibleWorld(this.camera, this.size());
    // Only worth showing when part of the scene is out of view.
    this.minimap.hidden = v.x <= 0 && v.y <= 0 && v.x + v.width >= s.width && v.y + v.height >= s.height;
    rect.setAttribute("x", String(v.x));
    rect.setAttribute("y", String(v.y));
    rect.setAttribute("width", String(v.width));
    rect.setAttribute("height", String(v.height));
  }

  // ---------- input ----------

  private nodeAt(target: EventTarget | null): SVGGElement | undefined {
    return (target as Element | null)?.closest?.<SVGGElement>("[data-node-id]") ?? undefined;
  }

  private bindPointer(): void {
    // Capture the pointer only once a drag starts: captured events are
    // retargeted to the SVG, and a click must still see the box it hit.
    let drag: { x: number; y: number; cam: Camera; moved: boolean; node?: string } | undefined;
    this.svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, cam: this.camera, moved: false, node: this.nodeAt(e.target)?.dataset.nodeId };
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        drag.moved = true;
        this.svg.setPointerCapture(e.pointerId);
        this.svg.classList.add("panning");
      }
      this.setCamera(pan(drag.cam, dx, dy));
    });
    this.svg.addEventListener("pointerup", () => {
      const d = drag;
      drag = undefined;
      this.svg.classList.remove("panning");
      if (d && !d.moved) this.select(d.node);
    });
    this.svg.addEventListener("pointercancel", () => {
      drag = undefined;
      this.svg.classList.remove("panning");
    });
    this.svg.addEventListener("dblclick", (e) => {
      // A folder row opens that folder, a frame its proposal package, else the box itself.
      const target = e.target as Element;
      const row = target.closest<SVGGElement>(".u-drill[data-target]");
      const frame = target.closest<SVGGElement>("[data-frame-id]");
      const node = this.nodeAt(e.target);
      if (row?.dataset.target) this.drill(row.dataset.target);
      else if (node?.classList.contains("u-drillable")) this.drill(node.dataset.nodeId as string);
      else if (frame && this.state.proposal) this.drill(frame.dataset.frameId as string);
    });
    this.svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.svg.getBoundingClientRect();
        // Pinch and Ctrl-wheel zoom; a plain wheel or two-finger scroll pans.
        if (e.ctrlKey || e.metaKey) this.setCamera(zoomAt(this.camera, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
        else this.setCamera(pan(this.camera, -e.deltaX, -e.deltaY));
      },
      { passive: false },
    );
    this.minimap.addEventListener("click", (e) => {
      const s = this.scene;
      if (!s) return;
      const r = this.minimap.getBoundingClientRect();
      this.setCamera(centerOn(this.camera, ((e.clientX - r.left) / r.width) * s.width, ((e.clientY - r.top) / r.height) * s.height, this.size()));
    });
  }

  private bindKeys(): void {
    document.addEventListener("keydown", (e) => {
      if (!this.scene || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const actions: Record<string, () => void> = {
        Escape: () => (this.state.trace ? this.setTrace(undefined) : this.state.selected ? this.select(undefined) : this.up()),
        Backspace: () => this.up(),
        "+": () => this.zoomBy(ZOOM_STEP),
        "=": () => this.zoomBy(ZOOM_STEP),
        "-": () => this.zoomBy(1 / ZOOM_STEP),
        "0": () => this.fitView(),
        ArrowLeft: () => this.setCamera(pan(this.camera, KEY_PAN, 0)),
        ArrowRight: () => this.setCamera(pan(this.camera, -KEY_PAN, 0)),
        ArrowUp: () => this.setCamera(pan(this.camera, 0, KEY_PAN)),
        ArrowDown: () => this.setCamera(pan(this.camera, 0, -KEY_PAN)),
        Enter: () => {
          const id = this.state.selected;
          if (id && this.viewport.querySelector(`[data-node-id="${CSS.escape(id)}"].u-drillable`)) this.drill(id);
        },
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    });
  }

  private bindButtons(): void {
    document.getElementById("btn-zoom-in")?.addEventListener("click", () => this.zoomBy(ZOOM_STEP));
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => this.zoomBy(1 / ZOOM_STEP));
    document.getElementById("btn-fit")?.addEventListener("click", () => this.fitView());
  }
}
