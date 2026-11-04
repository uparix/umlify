# Vendored archify layout code

These modules are copied from [Archify](https://github.com/tt-a1i/archify)
3.2.0 (`renderers/`), licensed under the Apache License 2.0. See `NOTICE` at
the repository root.

| File | Source | Changes |
| --- | --- | --- |
| `routing.mjs` | `architecture/routing.mjs` | import paths flattened (`../shared/x.mjs` → `./x.mjs`) |
| `geometry.mjs` | `shared/geometry.mjs` | none |
| `route-quality.mjs` | `shared/route-quality.mjs` | none |
| `grid.mjs` | `erd/grid.mjs` | none |
| `diagnostics.mjs` | `shared/diagnostics.mjs` | replaced by a no-op `recordDiagnostic`; archify records diagnostics only in its CLI diagnostic mode |

The `.d.mts` files declare the small part of their API that umlify calls.
Do not edit the `.mjs` files; to update them, copy them again from a newer
archify and re-apply the changes in the table.
