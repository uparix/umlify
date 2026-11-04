import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Syntax colours for the source panel. Loaded on first use (this module is
 * imported dynamically), with Shiki's CSS-variables theme so the colours
 * come from archify's tokens in app.css and follow theme and preset.
 */

const theme = createCssVariablesTheme({ name: "umlify", variablePrefix: "--shiki-" });

const LANGS: Record<string, () => Promise<unknown>> = {
  clojure: () => import("shiki/langs/clojure.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  java: () => import("shiki/langs/java.mjs"),
};

let highlighter: Promise<HighlighterCore> | undefined;

export interface Token {
  content: string;
  color?: string;
}

/** Tokens per line, or plain lines when the language is unknown. */
export async function tokenize(text: string, lang: string): Promise<Token[][]> {
  const load = LANGS[lang];
  if (!load) return text.split("\n").map((l) => [{ content: l }]);
  highlighter ??= createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine() });
  const h = await highlighter;
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage((await load()) as never);
  return h.codeToTokensBase(text, { lang, theme: "umlify" }).map((line) => line.map((t) => ({ content: t.content, color: t.color })));
}
