import { load, save } from "../storage";
import {
  nextPreset,
  PRESET_KEY,
  PRESET_LABELS,
  PRESETS,
  resolvePreset,
  resolveTheme,
  THEME_KEY,
  toggleTheme,
  type Preset,
  type Theme,
} from "../theme/theme";

const root = document.documentElement;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

function applyTheme(theme: Theme): void {
  root.dataset.theme = theme;
  byId("theme-label").textContent = theme === "dark" ? "Dark" : "Light";
}

function applyPreset(preset: Preset): void {
  root.dataset.preset = preset;
  byId("preset-label").textContent = PRESET_LABELS[preset];
  for (const item of byId("preset-menu").querySelectorAll<HTMLElement>("[data-preset]")) {
    item.setAttribute("aria-checked", String(item.dataset.preset === preset));
  }
}

function currentTheme(): Theme {
  return root.dataset.theme === "light" ? "light" : "dark";
}

function currentPreset(): Preset {
  return resolvePreset(root.dataset.preset ?? null, null);
}

function setTheme(theme: Theme): void {
  applyTheme(theme);
  save(THEME_KEY, theme);
}

function setPreset(preset: Preset): void {
  applyPreset(preset);
  save(PRESET_KEY, preset);
}

function buildPresetMenu(): void {
  const menu = byId("preset-menu");
  const button = byId<HTMLButtonElement>("btn-preset");
  const items = PRESETS.map((preset) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitemradio");
    item.dataset.preset = preset;
    item.textContent = PRESET_LABELS[preset];
    item.addEventListener("click", () => {
      setPreset(preset);
      close(true);
    });
    return item;
  });
  menu.replaceChildren(...items);

  const isOpen = () => !menu.hidden;
  function open(): void {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }
  function close(refocus: boolean): void {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }

  button.addEventListener("click", () => (isOpen() ? close(false) : open()));
  menu.addEventListener("keydown", (e) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") close(true);
    else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  });
  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !menu.parentElement?.contains(e.target as Node)) close(false);
  });
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function initToolbar(): void {
  const query = new URLSearchParams(location.search);
  buildPresetMenu();
  applyTheme(resolveTheme(query.get("theme"), load(THEME_KEY), matchMedia("(prefers-color-scheme: light)").matches));
  applyPreset(resolvePreset(query.get("preset"), load(PRESET_KEY)));

  byId("btn-theme").addEventListener("click", () => setTheme(toggleTheme(currentTheme())));

  // archify's single-key shortcuts: T theme, S style.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === "t") setTheme(toggleTheme(currentTheme()));
    else if (key === "s") setPreset(nextPreset(currentPreset()));
  });
}
