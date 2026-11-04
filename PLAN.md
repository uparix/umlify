# umlify — plan

A browser viewer (Chrome, Brave) for the **umlviewer data format** with the
**look, layout and colors of archify**. It reads the files the Swift
`UML Viewer.app` read, and it updates live when they change. umlify
**replaces** the Swift app and is a **read-only** viewer: it never writes
to the project.

```
 producers (unchanged)                 umlify (this folder)
 ─────────────────────────             ─────────────────────────────────────────────
 IR generator ──► uml/*.edn    ─┐      Node server                   Browser (SPA)
 policy       ──► *.policy.edn ─┼─►  watch ─► read ─► SSE "changed" ─► fetch ─► core (TS)
 metrics      ──► .metrics/**  ─┘      /api/file, /api/source             │ IR → overlay → hierarchy
 source files (read-only)      ──►   click-to-source                      ▼
                                                                   grid layout + SVG (archify)
```

## Decisions (agreed 2026-11-04)

1. **umlify replaces the Swift app.** We don't mirror its session or
   mailbox files. View state (file, level, proposal, selection, zoom,
   theme) lives in the URL hash and `localStorage`.
2. **Read-only.** No proposal editing, no `session.edn`, no agent mailbox.
   The server exposes only `GET` endpoints. Proposals that exist in the IR
   are still *shown*.
3. **Layout and colors come from archify, not from umlviewer.**
   - Layout: archify's grid (`layout.mode: "grid"`, each node gets
     `row`/`col`, fixed gaps).
   - Rows come from `:level` (highest level on top, as umlviewer stacks
     them) or, without levels, from dependency rank. Columns are ordered by
     barycenter to reduce crossings, then snapped to the grid.
   - Edges are routed the way archify's class renderer does
     (`renderers/class/render-class.mjs`), with its markers per kind.
   - Grades map onto archify tokens: green `--backend-stroke`, amber
     `--cloud-stroke`, red `--security-stroke`, interpolated over the grade.
     Foreign libraries use `--external-*`. Violating edges use
     `--security-stroke`.
   - So the Swift `Engine/` (Layout, Route, Curve, Compose) is **not
     ported**, and its layout/route/scene goldens are not used.
4. **Local Node server plus a browser single-page app.** We need a server,
   because:
   - a browser can't watch files;
   - Brave ships with the File System Access API turned off;
   - click-to-source needs disk access.

   The server serves files and watches them. All diagram logic runs in the
   browser.
5. **Live update via Server-Sent Events.** The server watches the
   *directories* that hold the IR and policy files, plus `.metrics/**`.
   Watching directories catches temp-file + rename writes. Changes are
   debounced (~150 ms), then the server sends
   `event: changed {paths, stamps}`. The page re-fetches, recompiles and
   repaints while keeping the level, proposal, selection and zoom. If a file
   fails to parse, the page shows an error toast and keeps the previous
   diagram.
6. **Port the semantic half of `UMLCore` to TypeScript as a pure core with
   no DOM.**
   - Port: EDN reader (the writer is not needed), Model, IR, Policy (view
     time), Hierarchy, Grades, Overlay, Detail, Source locators.
   - Check against the umlviewer goldens: replayed domain calls, the
     `:view` stage of the hierarchy scenes, and the painted documents.
7. **No runtime dependency on archify.** We reimplement its UI chrome and
   reuse its CSS tokens, theme behaviour and JetBrains Mono subsets
   (Apache-2.0 / OFL), with attribution in `NOTICE`.
8. **Stack:**
   - TypeScript 6.0 (typescript-eslint doesn't support 7 yet); Node ≥ 22.12;
     npm workspaces.
   - Browser: Vite plus plain TS and SVG.
   - Server: `node:http` plus `chokidar`.
   - Tests: Vitest for unit and parity tests, Playwright for end-to-end
     tests, run in the installed Brave, or in Chrome when present.
   - Linting: ESLint plus typescript-eslint.
9. **Start-up:** `umlify path/to/ir.edn [--port 4321] [--no-open]
   [--browser brave|chrome]`.
   - Finds the project root by walking up to the folder that contains
     `.metrics/`, or falls back to the IR's folder.
   - Binds to `127.0.0.1` only.

## Folder layout

```
umlify/
├── package.json                 workspaces + scripts: dev, build, test, e2e, lint
├── packages/
│   ├── core/                    pure TS port of UMLCore's semantics (no DOM, no fs)
│   │   ├── src/edn/             reader, value, clojure-hash
│   │   ├── src/domain/          model, ir, policy, hierarchy, grades
│   │   ├── src/metrics/         overlay (crap + mutation snapshots)
│   │   ├── src/layout/          archify grid placement + edge routing
│   │   ├── src/app/             view state, detail (class card), source locators
│   │   └── test/                unit + parity tests, fixtures/ (umlviewer goldens)
│   ├── server/                  CLI + HTTP + watcher (read-only)
│   └── web/                     browser app
│       ├── index.html
│       └── src/
│           ├── theme/           archify tokens, presets, fonts
│           ├── render/          SVG: class nodes, ovals, ports, edges, markers, C/M dots
│           ├── ui/              toolbar, rail (passport/card), finder, minimap,
│           │                    breadcrumbs, proposals list, source panel, toasts
│           ├── interact/        pan/zoom, select, drill, keyboard, deep links
│           ├── live/            SSE client, reload + state preservation
│           └── export/          SVG/PNG export
├── e2e/                         Playwright specs
├── examples/                    copied from ../umlviewer/Examples
└── NOTICE                       archify (Apache-2.0), JetBrains Mono (OFL)
```

## HTTP API (local, GET only)

| Path | Purpose |
|---|---|
| `/api/project` | root, IR path, list of IR files under the root |
| `/api/file?path=…` | raw text of an IR or policy file (inside root only) |
| `/api/metrics` | every `.metrics/**` file: path, mtime, text |
| `/api/source?path=…` | source file text for click-to-source |
| `/api/events` | SSE: `changed` |

Every path is resolved and checked to stay under the project root.

## Phases

Each phase ends with green tests and a runnable `npm run dev`.

0. **Scaffold.** *(done)*
   - Workspaces, TS config, Vite, Vitest, Playwright, ESLint.
   - Copied the goldens and examples.
   - Empty page in archify chrome: toolbar with theme toggle (T), style
     presets (S), disabled zoom/find/export; diagram surface; side rail.
1. **EDN + Domain port.** *(done)* Reader, `ClojureHash`, Model, IR,
   Policy, Hierarchy, Grades in `packages/core/src/{edn,domain}`.
   - 859 recorded Clojure calls (config, ir, policy, hierarchy) replay
     equal, and the `:view` stage of all 38 hierarchy goldens matches.
   - Hand-written tests cover what the recordings miss (edge-kind strength
     order).
   - JS has one number type, so an integral float (`1.0`) reads as `1`;
     nothing the viewer shows depends on the difference.
2. **Metrics overlay.** *(done)* `packages/core/src/metrics/overlay.ts`:
   `crap.edn` plus both mutation formats, snapshot ownership, pooling.
   - All 5 painted documents match Clojure, op order included, and 41
     recorded overlay calls replay equal.
   - Hand-written tests cover the snapshot ownership precedence and
     newest-file-wins, which the goldens never exercise.
   - It stays pure: callers pass file texts with mtimes. Finding
     `.metrics/` and file stamps move to the server (phase 4).
3. **Archify grid layout + routing.** *(done)* `packages/core/src/layout/`.
   - archify's router, geometry, route-quality and banded-grid modules are
     vendored unchanged in `layout/archify/` (Apache-2.0; see the README
     there). They are browser-safe: the one `process.env` read is in
     archify's quality gates, which the router never calls.
   - umlify adds what archify leaves to the author: row/col cells.
     - Rows come from `:level` (highest on top) or, without distinct
       levels, from dependency depth (dependents above what they use).
     - Columns are ordered by barycenter sweeps; rows wrap after 6 boxes and
       are centred with half-step cells.
     - Foreign ovals go in a row below; packages are framed when a view has
       several; `:direction :lr` transposes.
   - Cards use archify's class-card metrics and text estimate; each holds
     children, public members and ports, so no DOM is needed.
   - All 38 reference views and the examples pass the invariants: no
     overlaps, boxes inside their frame, every route orthogonal and attached
     to both borders, the same output for the same input.
   - Speed: under 150 ms for a 13-box level; about 0.4–0.6 s for a 30-box,
     67-edge proposal. If larger projects feel slow, phase 5 can move
     layout into a Web Worker.
4. **Server + live reload.** CLI, root discovery, file API, watcher, SSE.
   *Done when* a Playwright test rewrites `crap.edn` or the IR (temp file +
   rename) and the page repaints within 1 s without losing selection or
   zoom, and a broken IR shows a toast while the old diagram stays.
5. **Rendering + navigation.**
   - Archify class nodes with grade colours, C/M dots, I/α glyphs and
     italic stereotypes; foreign ovals; ports.
   - Edges with markers per kind and red violations.
   - Double-click drill-down with breadcrumbs; back with Esc or Backspace;
     pan/zoom; minimap.
6. **Rail and exploration.**
   - Focus passport, the class card from `Detail`: metrics, ops, fields,
     relationships.
   - Source panel: Shiki highlighting, opened at the member line.
   - Exploration: node finder (⌘K), outline, upstream/downstream reach,
     proposals list, declutter modes, deep links, export SVG/PNG, present
     mode.
7. **Packaging.** `npm run build` produces the bundled web app plus a
   single `umlify` bin (`npm link`), and a README.

## Risks and mitigations

- **Ordering drift** between Swift/Clojure and JS: port `ClojureHash`
  exactly, and keep explicit orders where `group-by` order matters.
- **Grid layout on wide levels:** wrap rows after N columns, the way
  archify keeps its reader width, and let drill-down keep each level small.
- **Text metrics differ across OSes:** bundle the font and measure only
  after `document.fonts.ready`.
- **Watching on macOS** (fsevents, atomic renames, editors' swap files):
  watch directories, filter to `.edn`, debounce, and compare
  mtime + size + path stamps.
