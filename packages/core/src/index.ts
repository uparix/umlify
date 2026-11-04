// Public surface of @umlify/core: EDN, the umlviewer data model, the
// namespace-tree views, and the metrics overlay.
export * from "./edn/value";
export { EDNReadError, readAllEDN, readEDN } from "./edn/reader";
export { groupBy, hasheq } from "./edn/clojure-hash";
export * from "./domain/model";
export * from "./domain/grades";
export { IRError, classIndex, documentFrom, normalize } from "./domain/ir";
export * from "./domain/policy";
export * from "./domain/hierarchy";
export { documentEDN, diagramEDN } from "./domain/encode";
export {
  ClojureMap,
  applyMetrics,
  emptyMetrics,
  loadMetrics,
  namespaceFromSource,
  overlayClass,
  type CrapEntry,
  type Metrics,
  type MetricsFile,
  type MutationForm,
  type MutationSnapshot,
} from "./metrics/overlay";
