import { save } from "../storage";

const RAIL_KEY = "umlify-rail";

// The side panel collapses to give the diagram the full width; index.html
// restores the stored state before first paint.
export function initRail(): void {
  const root = document.documentElement;
  const collapse = document.getElementById("rail-collapse");
  const reveal = document.getElementById("rail-reveal");

  function set(collapsed: boolean): void {
    if (collapsed) root.dataset.rail = "collapsed";
    else delete root.dataset.rail;
    collapse?.setAttribute("aria-expanded", String(!collapsed));
    reveal?.setAttribute("aria-expanded", String(!collapsed));
    save(RAIL_KEY, collapsed ? "collapsed" : "open");
    (collapsed ? reveal : collapse)?.focus();
  }

  collapse?.addEventListener("click", () => set(true));
  reveal?.addEventListener("click", () => set(false));
}
