import type { Scene } from "@umlify/core";
import diagramCss from "../theme/diagram.css?raw";
import tokensCss from "../theme/tokens.css?raw";
import latinExt from "../theme/fonts/jetbrains-mono-latin-ext.woff2?inline";
import latin from "../theme/fonts/jetbrains-mono-latin.woff2?inline";
import { esc, renderScene } from "../render/svg";

/**
 * Export the current view as a standalone SVG or a PNG, the way archify's
 * Export does: the scene as it is drawn in the current theme and preset,
 * with the colours resolved, the diagram stylesheet and the font embedded,
 * so the file looks the same anywhere.
 */

const TOKEN_NAMES = [...new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string))];

function resolvedTokens(): string {
  const style = getComputedStyle(document.documentElement);
  return TOKEN_NAMES.map((name) => `${name}:${style.getPropertyValue(name).trim()};`).join("");
}

const FONT_FACES = `@font-face{font-family:"JetBrains Mono";font-weight:400 800;src:url(${latin}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215}@font-face{font-family:"JetBrains Mono";font-weight:400 800;src:url(${latinExt}) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0}`;

export function standaloneSvg(scene: Scene, graded: boolean): string {
  const fonts = `--font-mono:"JetBrains Mono",ui-monospace,monospace;--font-ui:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="diagram-svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="${esc(scene.title)}">
<title>${esc(scene.title)}</title>
<style>${FONT_FACES}svg{${resolvedTokens()}${fonts}}${diagramCss}.diagram-svg{position:static;cursor:default}</style>
<rect width="100%" height="100%" fill="var(--bg)"/>
${renderScene(scene, { graded })}
</svg>`;
}

function download(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const fileStem = (scene: Scene) => scene.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "diagram";

export function exportSvg(scene: Scene, graded: boolean): void {
  download(new Blob([standaloneSvg(scene, graded)], { type: "image/svg+xml" }), `${fileStem(scene)}.svg`);
}

/** A PNG at twice the scene's size, drawn from the standalone SVG. */
export async function exportPng(scene: Scene, graded: boolean, scale = 2): Promise<void> {
  const url = URL.createObjectURL(new Blob([standaloneSvg(scene, graded)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(scene.width * scale);
    canvas.height = Math.ceil(scene.height * scale);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (blob) download(blob, `${fileStem(scene)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The Export button opens a small menu: SVG or PNG (E opens it, as in archify). */
export function initExport(current: () => { scene: Scene; graded: boolean } | undefined): void {
  const button = document.getElementById("btn-export") as HTMLButtonElement;
  const menu = document.createElement("div");
  menu.className = "menu export-menu";
  menu.id = "export-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = `<button type="button" role="menuitem" data-format="svg">SVG <span>vector</span></button><button type="button" role="menuitem" data-format="png">PNG <span>2× image</span></button>`;
  button.after(menu);
  button.parentElement?.classList.add("export-wrap");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-controls", "export-menu");
  button.setAttribute("aria-expanded", "false");

  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button")?.focus();
  };
  button.addEventListener("click", () => setOpen(menu.hasAttribute("hidden")));
  menu.addEventListener("click", (e) => {
    const format = (e.target as Element).closest<HTMLElement>("[data-format]")?.dataset.format;
    const cur = current();
    setOpen(false);
    if (!cur || !format) return;
    if (format === "svg") exportSvg(cur.scene, cur.graded);
    else void exportPng(cur.scene, cur.graded);
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== button) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key.toLowerCase() === "e" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !button.disabled && !document.querySelector("dialog[open]")) {
      setOpen(menu.hasAttribute("hidden"));
    }
  });
}

/** Presentation stage: the diagram alone on the screen (F toggles, as in archify). */
export function initPresent(onChange: () => void): void {
  const root = document.documentElement;
  const button = document.getElementById("btn-present") as HTMLButtonElement;
  const toggle = () => {
    const on = root.dataset.present !== "true";
    if (on) root.dataset.present = "true";
    else delete root.dataset.present;
    button.setAttribute("aria-pressed", String(on));
    onChange();
  };
  button.addEventListener("click", toggle);
  document.getElementById("present-exit")?.addEventListener("click", toggle);
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key.toLowerCase() === "f" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("dialog[open]")) toggle();
  });
}
