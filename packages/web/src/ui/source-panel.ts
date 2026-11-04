import { locateMember, sourceCandidates, type SourceIdent } from "@umlify/core";

/**
 * The source of a class or member, opened over the diagram at the member's
 * line (umlviewer's source window). Files come from the server's
 * /api/source; the language's locator finds the line.
 */

async function fetchFirst(paths: string[]): Promise<{ path: string; text: string } | undefined> {
  for (const path of paths) {
    const res = await fetch(`/api/source?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    if (res.ok) return { path, text: await res.text() };
  }
  return undefined;
}

export function initSourcePanel(container: HTMLElement): (ident: SourceIdent, owner: string) => Promise<void> {
  const panel = document.createElement("dialog");
  panel.className = "source-panel";
  panel.setAttribute("aria-label", "Source");
  panel.innerHTML = `<header><h2 class="source-title"></h2><button type="button" class="rail-control" data-close aria-label="Close source" title="Close (Esc)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><p class="source-note" hidden></p><pre class="source-code" tabindex="0"><code></code></pre>`;
  container.append(panel);
  const title = panel.querySelector(".source-title") as HTMLElement;
  const note = panel.querySelector(".source-note") as HTMLElement;
  const code = panel.querySelector("code") as HTMLElement;

  const close = () => panel.close();
  panel.querySelector("[data-close]")?.addEventListener("click", close);
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  let request = 0;
  return async (ident, owner) => {
    const mine = ++request;
    const what = ident.name ? `${owner} / ${ident.name}` : owner;
    title.textContent = what;
    note.hidden = true;
    code.replaceChildren();
    panel.show();
    const file = await fetchFirst(sourceCandidates(ident));
    if (mine !== request) return;
    if (!file) {
      note.textContent = `No source file found for ${what}.`;
      note.hidden = false;
      return;
    }
    const at = locateMember(file.text, ident);
    title.textContent = at.line ? `${file.path}:${at.line}` : file.path;
    if (!at.found) {
      note.textContent = `${ident.name} is not declared in ${file.path}; showing the file.`;
      note.hidden = false;
    }
    const { tokenize } = await import("../render/highlight");
    const lines = await tokenize(file.text, ident.lang ?? "clojure");
    if (mine !== request) return;
    const frag = document.createDocumentFragment();
    lines.forEach((tokens, i) => {
      const line = document.createElement("span");
      line.className = "line";
      line.dataset.line = String(i + 1);
      if (i + 1 === at.line) line.classList.add("target");
      for (const t of tokens) {
        const span = document.createElement("span");
        span.textContent = t.content;
        if (t.color) span.style.color = t.color;
        line.append(span);
      }
      line.append("\n");
      frag.append(line);
    });
    code.replaceChildren(frag);
    code.querySelector(".target")?.scrollIntoView({ block: "center" });
  };
}
