// Public surface of @umlify/core: EDN, the umlviewer data model, and the
// namespace-tree views. Phase 2 adds the metrics overlay.
export * from "./edn/value";
export { EDNReadError, readAllEDN, readEDN } from "./edn/reader";
export { groupBy, hasheq } from "./edn/clojure-hash";
export * from "./domain/model";
export * from "./domain/grades";
export { IRError, classIndex, documentFrom, normalize } from "./domain/ir";
export * from "./domain/policy";
export * from "./domain/hierarchy";
