// Stand-in for archify's shared/diagnostics.mjs, which records layout
// diagnostics only in its CLI diagnostic mode and otherwise does nothing.
// umlify never enables that mode, and the original reads node:fs, which the
// browser does not have.
export function recordDiagnostic() {}
