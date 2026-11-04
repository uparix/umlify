import {
  DECLUTTER_MODES,
  namedProposals,
  passportOf,
  sourceCandidates,
  type Declutter,
  type Passport,
  type Scene,
  type SourceIdent,
  type StatsRow,
} from "@umlify/core";
import type { Loaded } from "../live/load";
import { gradeColor, gradesOf } from "../render/grade";
import { esc } from "../render/svg";
import type { ViewState } from "../view/state";
import type { Viewer } from "../view/viewer";

/**
 * The side panel: which diagram and declutter mode (umlviewer's inspector),
 * then the selected box's passport (umlviewer's class card) with metrics,
 * members, relationships, dependency tracing and links to the source.
 */

const MODE_LABEL: Record<Declutter, [string, string]> = {
  full: ["Full", "Every arrow and member"],
  arrows: ["Arrows", "One arrow per direction between boxes"],
  triangles: ["Counts", "No arrows; counts of incoming and outgoing dependencies on each box"],
  elements: ["Boxes", "Boxes without members, children or ports"],
  classes: ["Layers", "One box per package"],
};

export interface InspectorActions {
  openSource(ident: SourceIdent, title: string): void;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function viewControls(loaded: Loaded, state: ViewState): string {
  const proposals = loaded.doc.kind === "hierarchy" ? namedProposals(loaded.doc.doc) : [];
  const select =
    proposals.length > 0
      ? `<label class="field"><span>Diagram</span><select data-action="proposal">
<option value="">Code</option>
${proposals.map((p) => `<option value="${esc(p.id)}"${p.id === state.proposal ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
</select></label>`
      : "";
  const mode = state.mode ?? "full";
  const buttons = DECLUTTER_MODES.map(
    (m) =>
      `<button type="button" role="radio" aria-checked="${m === mode}" data-mode="${m}" title="${MODE_LABEL[m][1]}">${MODE_LABEL[m][0]}</button>`,
  ).join("");
  return `<section class="rail-section view-controls">${select}<div class="field"><span id="declutter-label">Declutter <kbd>D</kbd></span><div class="segmented" role="radiogroup" aria-labelledby="declutter-label">${buttons}</div></div></section>`;
}

function overview(scene: Scene): string {
  const boxes = scene.nodes.filter((n) => n.kind === "box").length;
  const violations = scene.edges.filter((e) => e.violating).length;
  return `<section class="rail-section">
<h3 class="rail-title">${esc(scene.title)}</h3>
<p class="rail-muted">${count(boxes, "box", "boxes")} · ${count(scene.edges.length, "arrow", "arrows")}${violations > 0 ? ` · <span class="u-bad">${count(violations, "violation", "violations")}</span>` : ""}</p>
<p class="rail-empty">Select a box to see its metrics, members, relationships and source. Double-click a folder to open it.</p>
</section>`;
}

function statsTable(p: Passport): string {
  if (!p.stats) return "";
  const cell = (v: string | number | undefined, cls = "") => `<td class="${cls}">${v === undefined ? "" : esc(String(v))}</td>`;
  const row = (r: StatsRow, head: boolean) => {
    const mutation = r.noSites
      ? `<td colspan="3" class="rail-muted">no mutation sites</td>`
      : cell(r.killed) + cell(r.survived, r.survived ? "u-bad" : "") + cell(r.uncovered);
    const label =
      !head && r.name !== undefined && sourceCandidates(p.source).length > 0
        ? `<button type="button" class="link" data-source-member="${esc(r.name)}">${esc(r.label)}</button>`
        : esc(r.label);
    return `<tr class="${head ? "stats-class" : r.isPrivate ? "stats-private" : ""}"><th scope="row">${label}</th>${cell(r.crap)}${cell(r.cc)}${cell(r.coverage)}${mutation}</tr>`;
  };
  return `<section class="rail-section"><h4>Metrics</h4><div class="table-wrap"><table class="stats">
<thead><tr><th></th><th colspan="3" class="group">crap</th><th colspan="3" class="group">mutation</th></tr>
<tr><th></th><th>CRAP</th><th>CC</th><th>Cov</th><th>killed</th><th>surv.</th><th>uncov.</th></tr></thead>
<tbody>${row(p.stats.cls, true)}${p.stats.ops.map((r) => row(r, false)).join("")}</tbody></table></div></section>`;
}

function passport(p: Passport, scene: Scene, graded: boolean, state: ViewState): string {
  const node = scene.nodes.find((n) => n.id === p.id);
  const g = node ? gradesOf(node.cls) : undefined;
  const facts = [
    p.stereotype ? `«${p.stereotype}»` : "",
    p.level !== undefined ? `Level ${p.level}` : "",
    p.packageLabel && p.packageLabel !== "view" ? `Package ${p.packageLabel}` : "",
    p.oval ? "External library" : "",
  ].filter(Boolean);
  const hasSource = sourceCandidates(p.source).length > 0;
  const grades =
    graded && g && !p.oval
      ? `<p class="grades"><span class="grade" style="--g:${gradeColor(g.crap)}">C ${g.crap.toFixed(1)}</span><span class="grade" style="--g:${gradeColor(g.mutation)}">M ${g.mutation.toFixed(1)}</span>${p.crapLine ? `<span class="rail-muted">${esc(p.crapLine)}</span>` : ""}</p>`
      : p.crapLine
        ? `<p class="rail-muted">${esc(p.crapLine)}</p>`
        : "";
  const actions = [
    p.drill ? `<button type="button" class="chip-button" data-drill="${esc(p.id)}">Open ↵</button>` : "",
    hasSource ? `<button type="button" class="chip-button" data-source-module="">Source</button>` : "",
    p.rels.length > 0
      ? `<button type="button" class="chip-button" aria-pressed="${state.trace === "up"}" data-trace="up" title="Highlight everything that depends on this, transitively">Dependents ↑</button><button type="button" class="chip-button" aria-pressed="${state.trace === "down"}" data-trace="down" title="Highlight everything this depends on, transitively">Dependencies ↓</button>`
      : "",
  ].join("");
  const children =
    p.children.length > 0
      ? `<section class="rail-section"><h4>Contents</h4><ul class="plain">${p.children
          .map((c) => `<li><button type="button" class="link" data-child="${esc(c.id)}" data-child-drill="${c.drill}">${esc(c.name)}${c.drill ? "/" : ""}</button></li>`)
          .join("")}</ul></section>`
      : "";
  const fields =
    p.fields.length > 0
      ? `<section class="rail-section"><h4>Fields</h4><ul class="plain mono">${p.fields.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></section>`
      : "";
  const rels =
    p.rels.length > 0
      ? `<section class="rail-section"><h4>Relationships</h4><ul class="plain rels">${p.rels
          .map(
            (r) =>
              `<li class="${r.violating ? "u-bad" : ""}"><span class="rail-muted">${esc(r.phrase)}</span> <button type="button" class="link" data-select-id="${esc(r.id)}">${esc(r.name)}</button>${r.label ? ` <span class="rail-muted">«${esc(r.label)}»</span>` : ""}${r.violating ? ' <span class="tag">violates levels</span>' : ""}</li>`,
          )
          .join("")}</ul></section>`
      : "";
  return `<section class="rail-section passport">
<h3 class="rail-title">${esc(p.name)}</h3>
${p.module ? `<p class="mono rail-muted">${esc(p.module)}</p>` : ""}
${facts.length > 0 ? `<p class="rail-muted">${esc(facts.join(" · "))}</p>` : ""}
${grades}
${actions ? `<div class="actions">${actions}</div>` : ""}
</section>${children}${statsTable(p)}${fields}${rels}`;
}

export function initInspector(viewer: Viewer, actions: InspectorActions): (info: { loaded: Loaded; scene: Scene; state: ViewState }) => void {
  const body = document.querySelector("#reader-rail .rail-body") as HTMLElement;
  const heading = document.querySelector("#reader-rail .rail-head h2") as HTMLElement;
  let shown: Passport | undefined;

  body.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("button");
    if (!t) return;
    if (t.dataset.mode) viewer.setMode(t.dataset.mode as Declutter);
    else if (t.dataset.selectId) viewer.select(t.dataset.selectId);
    else if (t.dataset.drill) viewer.drill(t.dataset.drill);
    else if (t.dataset.child) {
      // A folder child opens that folder; a module child is shown in its level.
      if (t.dataset.childDrill === "true") viewer.drill(t.dataset.child);
      else viewer.reveal(t.dataset.child);
    } else if (t.dataset.trace) {
      const trace = t.dataset.trace as "up" | "down";
      viewer.setTrace(viewer.current?.state.trace === trace ? undefined : trace);
    } else if (shown && t.dataset.sourceMember !== undefined) {
      actions.openSource({ ...shown.source, name: t.dataset.sourceMember }, shown.name);
    } else if (shown && t.dataset.sourceModule !== undefined) {
      actions.openSource(shown.source, shown.name);
    }
  });
  body.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.action === "proposal") viewer.setProposal(t.value || undefined);
  });
  // D cycles the declutter modes, as umlviewer's button did.
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "d" || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const cur = viewer.current;
    if (!cur) return;
    const mode = cur.state.mode ?? "full";
    viewer.setMode(DECLUTTER_MODES[(DECLUTTER_MODES.indexOf(mode) + 1) % DECLUTTER_MODES.length] as Declutter);
  });

  return ({ loaded, scene, state }) => {
    shown = state.selected ? passportOf(scene, state.selected) : undefined;
    heading.textContent = shown ? "Class" : "View";
    body.innerHTML = viewControls(loaded, state) + (shown ? passport(shown, scene, loaded.graded, state) : overview(scene));
  };
}
