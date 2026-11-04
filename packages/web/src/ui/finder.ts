import { nodeLabel, type DiagramClass, type NodeID, type UMLDocument } from "@umlify/core";
import { esc } from "../render/svg";
import type { Viewer } from "../view/viewer";

/**
 * Find any class in the document (archify's node finder): ⌘K, Ctrl-K or
 * "/" opens it, typing filters by name, id and namespace, Enter shows the
 * class in its level, selected.
 */

export interface Candidate {
  id: NodeID;
  name: string;
  detail: string;
}

export function candidatesOf(doc: UMLDocument): Candidate[] {
  const of = (c: DiagramClass, detail: string): Candidate => ({ id: c.id, name: c.name && !c.ns ? c.name : nodeLabel(c.id), detail });
  if (doc.kind === "hierarchy") return doc.doc.classes.filter((c) => !c.foreign).map((c) => of(c, c.ns ?? c.id));
  return doc.diagrams.flatMap((d) => d.packages.flatMap((p) => p.classes.map((c) => ({ id: c.id, name: c.name ?? c.id, detail: p.label ?? p.id }))));
}

/** Matches for `query`, best first: name starts with it, then contains it, then id or detail does. */
export function search(all: Candidate[], query: string, limit = 50): Candidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const rank = (c: Candidate): number => {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (c.id.toLowerCase().includes(q) || c.detail.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return all
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.c.id.localeCompare(b.c.id))
    .slice(0, limit)
    .map((x) => x.c);
}

export function initFinder(viewer: Viewer): void {
  const dialog = document.createElement("dialog");
  dialog.className = "finder";
  dialog.setAttribute("aria-label", "Find a class");
  dialog.innerHTML = `<input type="search" placeholder="Find a class…" aria-label="Find a class" aria-controls="finder-results" autocomplete="off" spellcheck="false"><ul id="finder-results" role="listbox" aria-label="Classes"></ul><p class="finder-hint"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> show · <kbd>Esc</kbd> close</p>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input") as HTMLInputElement;
  const list = dialog.querySelector("ul") as HTMLUListElement;
  let results: Candidate[] = [];
  let active = 0;

  const paint = () => {
    list.innerHTML = results
      .map(
        (c, i) =>
          `<li role="option" id="finder-${i}" data-index="${i}" aria-selected="${i === active}"><span class="finder-name">${esc(c.name)}</span><span class="finder-detail">${esc(c.detail)}</span></li>`,
      )
      .join("");
    input.setAttribute("aria-activedescendant", results.length > 0 ? `finder-${active}` : "");
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };
  const refresh = () => {
    const cur = viewer.current;
    results = cur ? search(candidatesOf(cur.loaded.doc), input.value) : [];
    active = 0;
    paint();
  };
  const choose = (i: number) => {
    const c = results[i];
    if (!c) return;
    dialog.close();
    viewer.reveal(c.id);
  };
  const open = () => {
    if (!viewer.current || dialog.open) return;
    input.value = "";
    refresh();
    dialog.showModal();
    input.focus();
  };

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, Math.min(results.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as Element).closest<HTMLElement>("[data-index]");
    if (li) choose(Number(li.dataset.index));
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // a click on the backdrop
  });
  document.getElementById("btn-find")?.addEventListener("click", open);
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
      e.preventDefault();
      open();
    }
  });
}
