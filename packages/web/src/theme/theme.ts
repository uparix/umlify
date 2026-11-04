// Theme and style preset resolution, archify's rules: a `?theme=` / `?preset=`
// query wins, then the stored choice, then (for the theme) the OS preference.
// index.html repeats resolveTheme inline so the first paint has no flash.

export type Theme = "dark" | "light";

export const PRESETS = ["classic", "signal-flow", "blueprint", "editorial"] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_LABELS: Record<Preset, string> = {
  classic: "Classic",
  "signal-flow": "Signal flow",
  blueprint: "Blueprint",
  editorial: "Editorial",
};

export const THEME_KEY = "umlify-theme";
export const PRESET_KEY = "umlify-preset";

const isTheme = (v: string | null): v is Theme => v === "dark" || v === "light";
const isPreset = (v: string | null): v is Preset => (PRESETS as readonly (string | null)[]).includes(v);

export function resolveTheme(param: string | null, stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(param)) return param;
  if (isTheme(stored)) return stored;
  return prefersLight ? "light" : "dark";
}

export function resolvePreset(param: string | null, stored: string | null): Preset {
  if (isPreset(param)) return param;
  if (isPreset(stored)) return stored;
  return "classic";
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function nextPreset(preset: Preset): Preset {
  return PRESETS[(PRESETS.indexOf(preset) + 1) % PRESETS.length] ?? "classic";
}
