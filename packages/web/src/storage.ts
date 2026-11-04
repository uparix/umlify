// localStorage that never throws: private windows and blocked site data
// make the accessor fail, and the viewer must work without it.

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference is kept for this page only.
  }
}
