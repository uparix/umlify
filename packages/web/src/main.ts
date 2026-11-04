import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/app.css";
import "./theme/diagram.css";
import type { Loaded } from "./live/load";
import { startSession } from "./live/session";
import { initRail } from "./ui/rail";
import { showConnection, showFailure, showLoaded, showRendered } from "./ui/status";
import { initToolbar } from "./ui/toolbar";
import { Viewer } from "./view/viewer";

initToolbar();
initRail();

let current: Loaded | undefined;
const viewer = new Viewer(document.getElementById("diagram") as HTMLElement, {
  rendered: (scene, ms) => current && showRendered(current, scene, ms),
});

void startSession({
  connection: showConnection,
  loaded: (r) => {
    current = r;
    showLoaded(r);
    viewer.show(r);
  },
  failed: showFailure,
});
