import { layoutDiagram, segs, viewAt, type Diagram, type NodeID, type Scene } from "@umlify/core";
import { documentTitle, type Loaded } from "../live/load";
import { renderScene } from "../render/svg";
import { centerOn, fit, pan, transformOf, visibleWorld, zoomAt, type Camera } from "./camera";
import { formatHash, parseHash, type ViewState } from "./state";

/**
 * The diagram on screen: lays out the current level, draws it, and handles
 * pan, zoom, selection, drill-down, breadcrumbs and the minimap. A live
 * reload keeps the level, the selection and the camera; a new level fits.
 */

export interface ViewerEvents {
  /** After every draw, with the scene and how long layout took. */
  rendered(scene: Scene, layoutMs: number): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ZOOM_STEP = 1.25;
const KEY_PAN = 48;
const DRAG_SLOP = 3;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export class Viewer {
  private loaded?: Loaded;
  private scene?: Scene;
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
    this.viewport = document.createElementNS(SVG_NS, "g");
    this.viewport.classList.add("viewport");
    this.svg.append(this.viewport);
    this.svg.setAttribute("hidden", "");
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

  /** A new or reloaded document. Keeps level, selection and camera when they still apply. */
  show(loaded: Loaded): void {
    const sameFile = this.loaded?.path === loaded.path;
    this.loaded = loaded;
    if (!sameFile) this.moved = false;
    this.render(this.state, this.moved);
    this.writeHash(false);
  }

  // ---------- levels ----------

  private viewFor(path: string[]): Diagram {
    const doc = (this.loaded as Loaded).doc;
    return doc.kind === "hierarchy" ? viewAt(doc.doc, path) : (doc.diagrams[0] as Diagram);
  }

  /** The deepest prefix of `path` that still has boxes (a reload may remove a level). */
  private existingPath(path: string[]): string[] {
    const doc = (this.loaded as Loaded).doc;
    if (doc.kind !== "hierarchy") return [];
    for (let p = path; ; p = p.slice(0, -1)) {
      if (p.length === 0 || viewAt(doc.doc, p).packages.some((pk) => pk.classes.length > 0)) return p;
    }
  }

  private render(wanted: ViewState, keepCamera: boolean): void {
    const path = this.existingPath(wanted.path);
    const started = performance.now();
    const scene = layoutDiagram(this.viewFor(path));
    const layoutMs = performance.now() - started;
    const selected = wanted.selected && scene.nodes.some((n) => n.id === wanted.selected) ? wanted.selected : undefined;
    this.scene = scene;
    this.state = { path, selected };

    this.svg.removeAttribute("hidden");
    this.svg.setAttribute("aria-label", `${scene.title}: ${scene.nodes.length} boxes`);
    this.viewport.innerHTML = renderScene(scene, { graded: (this.loaded as Loaded).graded });
    this.applySelection();
    this.renderBreadcrumbs();
    this.renderMinimap();
    if (keepCamera) this.applyCamera();
    else this.fitView();
    for (const id of ["btn-zoom-in", "btn-zoom-out", "btn-fit"]) (document.getElementById(id) as HTMLButtonElement).disabled = false;
    this.on.rendered(scene, layoutMs);
  }

  /** Go to a level (and selection); `push` adds a history entry so Back returns. */
  private go(next: ViewState, push: boolean): void {
    if (!this.loaded) return;
    const levelChanged = next.path.join(".") !== this.state.path.join(".");
    if (levelChanged) this.moved = false;
    this.render(next, !levelChanged);
    this.writeHash(push);
  }

  drill(id: NodeID): void {
    if (this.loaded?.doc.kind !== "hierarchy") return;
    this.go({ path: segs(id) }, true);
  }

  up(): void {
    if (this.state.path.length === 0) return;
    const child = this.state.path.join(".");
    this.go({ path: this.state.path.slice(0, -1), selected: child }, true);
  }

  private writeHash(push: boolean): void {
    const hash = formatHash(this.state);
    if (hash === location.hash) return;
    const url = `${location.pathname}${location.search}${hash}`;
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }

  // ---------- selection ----------

  select(id: NodeID | undefined): void {
    this.state = { ...this.state, selected: id };
    this.writeHash(false);
    this.applySelection();
  }

  private applySelection(): void {
    const id = this.state.selected;
    for (const el of this.viewport.querySelectorAll(".u-selected, .u-related")) el.classList.remove("u-selected", "u-related");
    if (!id) {
      this.svg.removeAttribute("data-selection");
      return;
    }
    this.svg.setAttribute("data-selection", id);
    const related = new Set([id]);
    for (const e of this.viewport.querySelectorAll<SVGGElement>("[data-edge-id]")) {
      const { from, to } = e.dataset;
      if (from === id || to === id) {
        e.classList.add("u-related");
        related.add(from as string).add(to as string);
      }
    }
    for (const nd of this.viewport.querySelectorAll<SVGGElement>("[data-node-id]")) {
      const nid = nd.dataset.nodeId as string;
      if (related.has(nid)) nd.classList.add("u-related");
      if (nid === id) nd.classList.add("u-selected");
    }
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
    if (this.state.path.length === 0) {
      nav.replaceChildren();
      return;
    }
    const ol = document.createElement("ol");
    const crumbs = [{ label: documentTitle(loaded.doc), path: [] as string[] }].concat(
      this.state.path.map((seg, i) => ({ label: seg, path: this.state.path.slice(0, i + 1) })),
    );
    crumbs.forEach((c, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.label;
      if (i === crumbs.length - 1) b.setAttribute("aria-current", "location");
      else b.addEventListener("click", () => this.go({ path: c.path }, true));
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
    const end = () => {
      const d = drag;
      drag = undefined;
      this.svg.classList.remove("panning");
      if (d && !d.moved) this.select(d.node);
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", () => {
      drag = undefined;
      this.svg.classList.remove("panning");
    });
    this.svg.addEventListener("dblclick", (e) => {
      // A folder row inside a box opens that folder; elsewhere the box itself.
      const row = (e.target as Element).closest<SVGGElement>(".u-drill[data-target]");
      const node = this.nodeAt(e.target);
      if (row?.dataset.target) this.drill(row.dataset.target);
      else if (node?.classList.contains("u-drillable")) this.drill(node.dataset.nodeId as string);
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
      const wx = ((e.clientX - r.left) / r.width) * s.width;
      const wy = ((e.clientY - r.top) / r.height) * s.height;
      this.setCamera(centerOn(this.camera, wx, wy, this.size()));
    });
  }

  private bindKeys(): void {
    document.addEventListener("keydown", (e) => {
      if (!this.scene || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const actions: Record<string, () => void> = {
        Escape: () => (this.state.selected ? this.select(undefined) : this.up()),
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
