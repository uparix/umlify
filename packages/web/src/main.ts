import "./theme/fonts.css";
import "./theme/tokens.css";
import "./theme/app.css";
import { startSession } from "./live/session";
import { initRail } from "./ui/rail";
import { showConnection, showFailure, showLoaded } from "./ui/status";
import { initToolbar } from "./ui/toolbar";

initToolbar();
initRail();
void startSession({ connection: showConnection, loaded: showLoaded, failed: showFailure });
