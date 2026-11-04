import { describe, expect, it } from "vitest";
import { nextPreset, resolvePreset, resolveTheme, toggleTheme } from "../src/theme/theme";

describe("resolveTheme", () => {
  it("prefers the query parameter", () => {
    expect(resolveTheme("light", "dark", false)).toBe("light");
  });

  it("falls back to the stored choice", () => {
    expect(resolveTheme(null, "light", false)).toBe("light");
  });

  it("ignores unknown values and follows the OS preference", () => {
    expect(resolveTheme("sepia", "neon", true)).toBe("light");
    expect(resolveTheme(null, null, false)).toBe("dark");
  });
});

describe("resolvePreset", () => {
  it("prefers the query parameter, then storage, then classic", () => {
    expect(resolvePreset("blueprint", "editorial")).toBe("blueprint");
    expect(resolvePreset(null, "editorial")).toBe("editorial");
    expect(resolvePreset("nope", null)).toBe("classic");
  });
});

describe("cycling", () => {
  it("toggles the theme", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("cycles presets in archify's order and wraps", () => {
    expect(nextPreset("classic")).toBe("signal-flow");
    expect(nextPreset("signal-flow")).toBe("blueprint");
    expect(nextPreset("blueprint")).toBe("editorial");
    expect(nextPreset("editorial")).toBe("classic");
  });
});
