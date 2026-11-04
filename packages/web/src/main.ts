import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/diagram.css";
import { startSession } from "./live/session";
import { initExport, initPresent } from "./ui/export";
import { initFinder } from "./ui/finder";
import { initInspector } from "./ui/inspector";
import { initRail } from "./ui/rail";
import { initSourcePanel } from "./ui/source-panel";
import { showConnection, showFailure, showLoaded, showRendered } from "./ui/status";
import { initToolbar } from "./ui/toolbar";
import { Viewer } from "./view/viewer";

initToolbar();
initRail();

const diagram = document.getElementById("diagram") as HTMLElement;
const openSource = initSourcePanel(diagram);
// The viewer reports changes only after the first load, when `inspect` exists.
const viewer = new Viewer(diagram, {
  changed: (info) => {
    showRendered(info.loaded, info.scene, info.layoutMs);
    inspect(info);
  },
});
const inspect = initInspector(viewer, { openSource: (ident, owner) => void openSource(ident, owner) });
initFinder(viewer);
initExport(() => {
  const cur = viewer.current;
  return cur && { scene: cur.scene, graded: cur.loaded.graded };
});
initPresent(() => viewer.fitView());

void startSession({
  connection: showConnection,
  loaded: (r) => {
    showLoaded(r);
    viewer.show(r);
  },
  failed: showFailure,
});
