import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // packages/core/src/layout/archify is vendored from archify unchanged.
  { ignores: ["**/dist/**", "**/node_modules/**", "playwright-report/**", "test-results/**", "packages/core/src/layout/archify/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
