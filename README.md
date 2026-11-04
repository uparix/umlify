# umlify

A live UML viewer for the browser. It reads the umlviewer data format (an
EDN description of a project's modules, dependencies and metrics) and draws
it in the style of [archify](https://github.com/tt-a1i/archify). When the
files change, the page updates within a second and keeps your place.

umlify replaces the Swift `UML Viewer.app`; files written for it open
unchanged. It is read-only: it never writes to your project.

- **Drill down** through the namespace tree. Dependencies that leave the
  current level become ports on the boxes, and external libraries become
  ovals.
- **Read the metrics at a glance:** each box is coloured by its CRAP and
  mutation grades (red, amber, green), with a dot for each grade.
- **Read a class in the side panel:** module, level, the metrics table per
  function, fields, relationships, and the source at the member's line.
- **Find** any class (⌘K), **trace** what depends on a class or what it
  depends on, switch to a **proposal**, **declutter**, **export** SVG or
  PNG, and **present**.
- archify's themes (dark and light) and styles (Classic, Signal flow,
  Blueprint, Editorial). Tested in Chrome and Brave.

## Requirements

Node.js 22.18 or newer, and Chrome or Brave.

## Install

```bash
git clone <this repository> umlify
cd umlify
npm install
npm run build      # the web app and the umlify command
npm link           # puts `umlify` on your PATH
```

To remove it again: `npm unlink -g umlify`.

## Use

```bash
umlify path/to/project/uml/project.edn
```

umlify finds the project root (the nearest folder above the file that holds
`.metrics/`), starts a server on `http://127.0.0.1:4321/` and opens your
browser. Leave it running: every change to the IR file or to `.metrics/`
reaches the page within a second. Stop it with Ctrl-C.

| Option | |
| --- | --- |
| `--port <n>` | Port on 127.0.0.1 (default 4321; `0` picks a free one) |
| `--no-open` | Do not open a browser |
| `--browser brave` / `chrome` | Open in that browser instead of the default |
| `--help`, `--version` | |

The server answers only on 127.0.0.1 and to local host names, serves only
files inside the project root, and accepts only GET requests.

### Mouse and keys

| | |
| --- | --- |
| Click | Select a box; its neighbours stay, the rest fades |
| Double-click | Open a folder, a proposal layer or a nested group |
| Drag, two-finger scroll | Pan |
| Pinch, Ctrl-scroll | Zoom |
| `+` `−` `0` | Zoom in, zoom out, fit |
| Arrow keys | Pan |
| `Enter` | Open the selected folder |
| `Backspace` | Up one level |
| `Esc` | Stop tracing, else clear the selection, else go up |
| `⌘K`, `Ctrl-K`, `/` | Find a class |
| `D` | Next declutter mode |
| `T` | Dark or light theme |
| `S` | Next style |
| `E` | Export |
| `F` | Presentation stage |

The browser's Back button leaves a level you opened.

### Links

The page's URL holds the view, so a link (or a reload) opens the same
place:

- `?file=uml/other.edn` opens another IR file under the same root.
- `?theme=light` and `?preset=blueprint` choose the theme and style.
- `#path=engine/sub` sets the level.
- `#sel=engine.route` selects a box, and `&trace=up` or `&trace=down`
  traces from it.
- `#prop=<id>&layer=<id>` opens a proposal and one of its layers.
- `#mode=arrows` (also `triangles`, `elements`, `classes`) picks the
  declutter mode.

## Producing data

The format is described in [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md):
the IR file (the namespace tree, or hand-drawn diagrams), the `.metrics/`
snapshots, and how umlify reads them. Producers should write every file
atomically (a temp file in the same folder, then rename it over the old
one); umlify keeps showing the last good version if it ever sees a broken
file.

`examples/` holds the umlviewer project's own IR with its metrics, and a
hand-drawn diagram:

```bash
umlify examples/uml-viewer.edn
```

## Differences from umlviewer

- **Read-only.** umlify does not edit proposals, write `session.edn` or
  answer the `.uml-viewer/` agent mailbox. The view lives in the URL
  instead of a session file.
- **Layout and look are archify's.** Boxes sit on archify's grid (rows by
  level or dependency depth) and arrows use archify's router and UML
  markers. umlviewer used its own Sugiyama layout and curved routes.
- **No metrics, no red.** A document with no metrics at all is drawn in a
  neutral tone. With metrics, missing data still counts as red, as in
  umlviewer.
- **Counts instead of triangles.** In the decluttered mode without arrows,
  each box shows how many dependencies come in and go out.
- **No `--snapshot`.** Check a file by opening it; errors show their line
  and column.

## Development

```bash
npm install
npm run dev        # server with Vite on examples/uml-viewer.edn, live reload of the app
npm run check      # typecheck, lint, unit tests, browser tests
```

| Script | |
| --- | --- |
| `npm run dev` | The server in development mode on the example |
| `npm run build` | Web app to `packages/web/dist`, server to `packages/server/dist` |
| `npm start -- <ir.edn>` | The built server, without `npm link` |
| `npm test` | Unit and parity tests (Vitest) |
| `npm run e2e` | Build, then browser tests (Playwright, in Chrome or else Brave; `UMLIFY_BROWSER` points at another Chromium) |
| `npm run typecheck`, `npm run lint` | |

```
packages/core     the umlviewer semantics in TypeScript: EDN, model, views,
                  metrics overlay, source lookup, class card, archify layout
packages/server   the CLI and the local read-only server
packages/web      the browser app
e2e/              browser tests against a scratch copy of examples/
docs/             the data format
```

`packages/core` is checked against umlviewer's recorded behaviour:
- the calls recorded from its Clojure specs;
- the views of 38 reference scenes;
- the 5 painted reference documents.

[PLAN.md](PLAN.md) records how umlify was built and the decisions behind
it.

## Credits

- Theme tokens, the look of the viewer, and the layout and routing modules
  in `packages/core/src/layout/archify` come from
  [archify](https://github.com/tt-a1i/archify) 3.2.0 (Apache License 2.0).
- The bundled font is [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)
  (SIL Open Font License 1.1).
- Source highlighting uses [Shiki](https://shiki.style) (MIT).

See [NOTICE](NOTICE).
