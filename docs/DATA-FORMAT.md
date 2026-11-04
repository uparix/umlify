# umlify data format

This is the contract between umlify and whatever produces its data: the
Clojure IR generator, a metrics tool, or an agent that analyses a project
and writes the files itself. It is the format of umlviewer (`UML
Viewer.app`), which umlify replaces; files written for umlviewer open
unchanged. umlify only reads these files: it never writes to the project
and never runs tools.

Everything is [EDN](https://github.com/edn-format/edn). umlify reloads on
its own: it watches the project folder, and when the open IR file or
anything under `.metrics/` changes it redraws within about a second,
keeping the current level, selection and zoom.

## Contents

1. [Files and where they go](#files-and-where-they-go)
2. [EDN umlify accepts](#edn-umlify-accepts)
3. [The IR: namespace tree](#the-ir-namespace-tree) (the usual form)
4. [The IR: hand-drawn diagrams](#the-ir-hand-drawn-diagrams)
5. [Metrics snapshots](#metrics-snapshots)
6. [How umlify reads it](#how-umlify-reads-it)
7. [Worked example](#worked-example)
8. [Checklist for producers](#checklist-for-producers)

## Files and where they go

```
project/                         the project root: the nearest folder at or
│                                above the IR file that holds .metrics/
├── uml/project.edn              the IR (any name ending in .edn, anywhere)
├── uml/project.policy.edn       optional; the generator's input, not read by umlify
└── .metrics/
    ├── crap.edn                 CRAP per function
    └── mutate/**/*.edn          one mutation snapshot per namespace
```

- **IR file.** Opened from the command line (`umlify path/to/file.edn`);
  `?file=other.edn` in the page's URL opens another IR under the same root.
  One file per diagram.
- **Project root.** umlify walks up from the IR file's folder until it
  finds a folder containing a `.metrics` directory; that folder is the
  project root. Without one, the IR file's folder is used. Relative paths
  in the data (`:file`) are relative to the project root, and umlify serves
  nothing outside it.
- **Source files** are read when the reader opens a class's or member's
  source in the side panel; see `:ns`, `:file`, and `:lang` below.

## EDN umlify accepts

Maps, vectors, lists, sets, keywords (`:a`, `:a.b`, `:a/b`), symbols,
strings with the usual escapes, characters, integers, floats (`1.5`,
`1.0E-4`, `##NaN`, `##Inf`), `nil`, `true`, `false`, `;` comments, `#_`
discards, and tagged literals (`#inst "…"`, kept as tagged values).

Not accepted: namespaced maps (`#:ns{…}`), metadata (`^…`), regexes
(`#"…"`), reader conditionals. Duplicate keys in a map or set are an error.
Ratios (`1/4`) read as floats; integers too large for 64 bits read as
floats; `12N` and `1.5M` read as an integer and a float.

A file that does not parse is shown as an error (with line and column),
and the previous diagram stays on screen.

## The IR: namespace tree

The usual IR is one map with `:hierarchical true`: every module of the
project as a class, every dependency as an edge, and the tree implied by
dots in the ids. umlify builds every screen from it: the top level, a
drilled-in level, proposals, and declutter modes.

### Top-level keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `:hierarchical` | `true` | yes | Marks the namespace-tree form. |
| `:title` | string | no | Page title and top-level label. Default `"UML"`. |
| `:prefix` | string | no | The namespace prefix stripped from ids (`"shop"` for `shop.web.handler`). Only used to match a Rust crate's metrics; ids are already stripped. |
| `:classes` | vector of [classes](#classes) | yes | Every module, plus every external library that should appear as an oval. |
| `:edges` | vector of [edges](#edges) | yes | Leaf-level dependencies between class ids. |
| `:order` | vector of ids, or map | no | Box order. A vector orders the top level (`[:web :domain]`); unlisted boxes follow, sorted by id. A map orders any level: keys are the dotted path as a string (`""` is the top level, `"web"` the children of `web`) and values list the **full** child ids (`{"web" [:web.handler :web.routes]}`). |
| `:edge-kinds` | map `[from to] → kind` | no | Overrides an edge's kind after merging, by leaf ids: `{[:web.handler :domain.cart] :association}`. |
| `:omit-edges` | vector of `[from to]` | no | Leaf edges to drop. |
| `:omit` | vector of ids | no | Ids hidden from the tree, with all their descendants. |
| `:levels` | vector of vectors of segments | no | Architectural levels, inner (core) first: `[[:domain] [:web]]`. **umlify does not compute anything from it**: producers use it to fill each class's `:level` and each edge's `:violating`. Keep it in the file for the record. |
| `:proposals` | vector of [proposals](#proposals) | no | Named groupings that are not in the code. |
| `:proposal` | vector of layers | no | Legacy single unnamed proposal; prefer `:proposals`. |
| `:policy-file` | string | no | The policy file, relative to the project root. umlify does not read it (proposals come from the IR); umlviewer wrote proposal edits there. |

Unknown keys are ignored.

### Ids

An id is a keyword naming a node of the tree, **without** the project
prefix: `shop.web.handler` becomes `:web.handler`. Each `.` is a level of
nesting: `:web.handler` is a child of `:web`. A node can be both a module
and a folder: if `:web` and `:web.handler` both exist, the `web` box lists
`web` (the module) and `handler` (the child).

Ids must be unique. Write them as keywords; symbols and strings are read as
their name. Hyphens are fine; a box title is the last segment in
CamelCase (`source-clojure` → `SourceClojure`; a segment that already has
a capital keeps it: `tauriFs` → `TauriFs`). A Rust source file's box is
titled by its file name instead.

### Classes

| Key | Type | Meaning |
|---|---|---|
| `:id` | keyword | Required; see [Ids](#ids). |
| `:name` | string | Shown in the side panel and on foreign ovals. Box titles come from the id. |
| `:ns` | string | The module's full namespace (`"shop.web.handler"`). Metrics snapshots are matched to classes by it; Clojure source is found from it. |
| `:file` | string | Source file, relative to the project root. Used to open TypeScript, Rust, Python, and Java source, and to title Rust boxes. |
| `:lang` | keyword | `:clojure` (default), `:typescript`, `:rust`, `:python`, or `:java`: how to find a member in the source. |
| `:level` | integer | Architectural rank, 0 = innermost (most stable). Shown in the box corner; at a level where any class has one, boxes are stacked by it, highest level on top. Containers take the highest level below them. |
| `:stereotype` | keyword | `:interface` (white **I** on the box), `:abstract` (white **α**), `:enumeration`, `:record`, `:annotation`, or a framework role such as `:service`; anything other than `:class` titles the box in italics. |
| `:foreign` | `true` | An external library. Drawn as an oval outside the boxes at any level where a visible module depends on it. Give it a short `:name`. |
| `:ops`, `:fields` | vectors of [members](#members) | Optional members. For Clojure the metrics overlay fills `:ops` from the snapshots, so they are usually omitted. |
| `:crap`, `:coverage`, `:cc`, `:killed`, `:survived`, `:uncovered`, `:sites` | see [Metrics](#metrics-snapshots) | Optional authored metrics, used only when no snapshot covers the class. |

How a source file is found from a class: for `:lang :clojure`, from `:ns`
as `src/<ns with . → / and - → _>.clj` (or `.cljc`, `.cljs`) under the
project root; for the other languages, `:file`, then the member by its
declaration (`export function name`, `fn name`, `def name`, …).

For `:lang :java`, an op's `:name` is the method with its parameter types,
`save(Book)`, so overloads stay apart; a method of a nested type is
prefixed with it, `Line.total()`, and a constructor is named after its
class, `Order(Customer)`. umlify drops the parameters, finds the nested
type, and opens at the first declaration of that name directly inside it
(overloads open at the first one). A member with no declaration of its own,
such as a record accessor or a default constructor, opens at its type.

### Edges

| Key | Type | Meaning |
|---|---|---|
| `:from`, `:to` | keyword | Required; class ids, foreign ids included. Use leaf ids (the module that has the dependency), not folders. |
| `:kind` | keyword | `:dependency` (a require or import), `:association`, `:implements`, `:inheritance`, `:aggregation`, `:composition`. Heads: open arrow for dependency and association, hollow triangle for implements and inheritance, hollow and filled diamonds for aggregation and composition. |
| `:violating` | `true` | This dependency breaks the dependency rule; drawn red. Set it only on `:dependency` edges whose `:from` has a **smaller** level than its `:to` (inner depends on outer). umlify keeps the flag when it bundles edges, and recomputes it only inside proposals. |
| `:label` | string | Shown with the relationship in the side panel. |

One edge per `[from to]` pair is enough; when there are several, the
umlify keeps the strongest kind (implements/inheritance > composition >
aggregation > association > dependency) and keeps `:violating` if any
dependency had it.

Edges to ids that are not classes are dropped. External libraries must
already be collapsed to the id of their `:foreign` class (`quil.core` →
`:quil`); umlify does not collapse them.

### Members

A member is a string (its display text) or a map:

```clojure
{:name "find" :args ["isbn"] :returns "Book"}   ; shown as "find(isbn) : Book"
{:name "isbn" :type "String"}                   ; a field: "isbn : String"
{:text "go(x)" :name "go" :private true}        ; private ops are not drawn on the box
```

Metrics on a member: `:crap` (number), `:cc`, `:coverage` (0–1),
`:killed`, `:survived`, `:uncovered`, `:sites`.

### Proposals

A proposal regroups real namespaces into named layers without touching the
code. The side panel's Diagram menu lists them next to the code.

```clojure
{:id :ports
 :name "2026-10-24 12:00:00"
 :layers [{:id :core :label "Core" :nses [:domain :source :graph]}
          {:id :delivery :label "Delivery"
           :nses [:application
                  {:id :ui :label "UI" :nses [:adapters.draw :adapters.sketch]}]}]
 :omit [:main]}
```

- `:layers` are **inner first**: the first layer has rank 0. Arrows inside
  a proposal are re-checked against this order, so a proposal can show
  violations the real tree does not have.
- `:nses` items are top-level segments (`:domain`), deeper ids
  (`:adapters.draw`), or a nested group map, drawn as a box inside the
  layer.
- Namespaces in no layer appear in an `Unassigned` package; `:omit` keeps
  ids (and their descendants) out of it.
- On screen, layer packages get the ids `:proposal.<layer id>`.

Preserve existing proposals when regenerating the IR.

## The IR: hand-drawn diagrams

Without `:hierarchical true`, the file is one static diagram, or several
stacked under `:diagrams`:

```clojure
{:title "Lending library"
 :direction :tb                       ; :tb (default) or :lr
 :packages [{:id :domain :label "Domain"
             :classes [{:id :book :name "Book"
                        :stereotype :class
                        :fields [{:name "isbn" :type "String"}]
                        :ops [{:name "find" :args ["isbn"] :returns "Book"}]}]}]
 :foreign [{:id :ring :name "ring"}]
 :edges [{:from :book :to :ring :kind :dependency}]}
```

```clojure
{:title "Doc" :diagrams [{:title "One" :packages [...] :edges [...]}
                         {:title "Two" :packages [...] :edges [...]}]}
```

This form is validated strictly: a class needs `:name` or `:id` (the id
defaults to the name, lowercased with spaces turned into `-`); class ids
are unique across packages and `:foreign`; every edge's ends exist;
`:coverage` is 0–1; counts are non-negative integers; `:cc` is
non-negative. `:crap` may be a number or `{:mu :max :sigma :n}`. Classes
may carry `:ns` for the metrics overlay.

## Metrics snapshots

Snapshots sit in `.metrics/` under the project root. Missing data is never
"unknown": a class with no CRAP or no mutation data is graded red.

### `.metrics/crap.edn`

```clojure
{:entries [{:name "add-item" :namespace "shop.domain.cart"
            :complexity 3 :coverage 87.5 :crap 3.1}
           ...]}
```

One entry per function. `:coverage` is a **percentage** (0–100). Rust
namespaces may use `::` (`shop::web`); it is read as `.`.

### `.metrics/mutate/**/*.edn`

One file per namespace, any name, any subfolder:

```clojure
{:namespace "shop.domain.cart"        ; or :source "src/shop/domain/cart.clj"
 :forms [{:id "defn/add-item" :killed 6 :survived 1 :uncovered 0 :sites 7}
         {:id "defn-/total" :killed 2 :survived 0 :uncovered 0 :sites 2}]}
```

- `:id` is `defn/<name>` for a public function and `defn-/<name>` for a
  private one; other ids are ignored. Other languages may use the same
  form or the neutral `method/<name>` and `method-/<name>`, which read the
  same. `<name>` must equal the op's `:name` (for Java, `save(Book)`).
- `:sites` is the number of mutation sites; `0` with no mutants shows
  "no mutation sites" in the side panel. When omitted it is taken as
  killed + survived + uncovered.
- With `:source` instead of `:namespace`, the namespace is the path without
  `src/` and the extension, `/` → `.`, `_` → `-`.
- When two files name the same namespace, the newer file wins.
- Other keys (`:version`, `:tested-at`, `:outcomes`, …) are ignored.

### Which class gets a snapshot

A snapshot's namespace belongs to the first match among the non-foreign
classes:

1. the class whose `:ns` equals it;
2. the class whose `:id` equals it;
3. the class whose id is a dotted prefix of it (the longest one), so a
   folder module can collect its sub-namespaces;
4. for a Rust project with exactly one undotted Rust class (the crate
   root): that class, when the namespace equals `:prefix`.

The class then shows: CRAP μ, max, and σ over its functions (rounded to
0.1) and their count; `:cc` as the sum of complexities; coverage as the
mean; summed killed, survived, uncovered, and sites; and one op per
function with its own numbers.

### Grades and colors

- CRAP is graded on μ + σ: ≤ 8 is 10 (green), 12 is 5.5 (yellow), ≥ 20 is
  1 (red), linear in between.
- Mutation is graded on killed ÷ (killed + survived + gap): ≤ 0.8 is 1
  (red), 0.9 is 5.5, 1.0 is 10 (green). The gap is one failed trial per
  function of a module that has no mutation data.
- A box's color is the average of the two; its **C** and **M** dots show
  each grade. A folder pools the CRAP of every function below it (weighted
  by function count) and sums its mutants.

## How umlify reads it

Producers should know what umlify derives, so they do not try to write it:

- **Levels of the tree.** At any level umlify shows the children of the
  current node as boxes, rolls up their metrics and levels, and collapses
  leaf edges onto those boxes. Dependencies leaving the current node become
  port rows inside the boxes (`← Web` incoming, `→ Web` outgoing); foreign
  libraries become ovals.
- **Layout and routing** are computed, on archify's grid with archify's
  router; there are no coordinates in the IR. Rows follow `:level`
  (highest on top) or, without distinct levels, dependency depth.
- **Declutter modes** (one arrow per pair, counts instead of arrows,
  hiding members, one box per package) are computed.
- **Not derived** and therefore the producer's job: `:level`, `:violating`,
  collapsing external libraries to `:foreign` ids, and `:ns` for metrics.

## Worked example

A small project, `shop`, with two levels: `domain` (inner) and `web`
(outer). `domain.order` depending on `web` breaks the dependency rule, so
that edge is `:violating`. The web handler uses the external library
`ring`.

`uml/shop.edn`:

```clojure
{:hierarchical true
 :title "Shop"
 :prefix "shop"
 :order [:web :domain]
 :levels [[:domain] [:web]]
 :classes [{:id :domain :name "Domain" :ns "shop.domain"
            :file "src/shop/domain.clj" :lang :clojure :level 0}
           {:id :domain.cart :name "Cart" :ns "shop.domain.cart"
            :file "src/shop/domain/cart.clj" :lang :clojure :level 0}
           {:id :domain.order :name "Order" :ns "shop.domain.order"
            :file "src/shop/domain/order.clj" :lang :clojure :level 0}
           {:id :domain.pricing :name "Pricing" :ns "shop.domain.pricing"
            :file "src/shop/domain/pricing.clj" :lang :clojure :level 0
            :stereotype :interface}
           {:id :web :name "Web" :ns "shop.web"
            :file "src/shop/web.clj" :lang :clojure :level 1}
           {:id :web.handler :name "Handler" :ns "shop.web.handler"
            :file "src/shop/web/handler.clj" :lang :clojure :level 1}
           {:id :ring :name "ring" :foreign true}]
 :edges [{:from :web.handler :to :domain.cart :kind :dependency}
         {:from :web.handler :to :domain.order :kind :dependency}
         {:from :web.handler :to :ring :kind :dependency}
         {:from :domain.cart :to :domain.pricing :kind :dependency}
         {:from :domain.order :to :domain.cart :kind :association}
         {:from :domain.order :to :web :kind :dependency :violating true}]}
```

`.metrics/crap.edn`:

```clojure
{:entries [{:name "add-item" :namespace "shop.domain.cart" :complexity 3 :coverage 92.0 :crap 3.0}
           {:name "total" :namespace "shop.domain.cart" :complexity 2 :coverage 100.0 :crap 2.0}
           {:name "place" :namespace "shop.domain.order" :complexity 9 :coverage 40.0 :crap 27.5}
           {:name "handle" :namespace "shop.web.handler" :complexity 4 :coverage 75.0 :crap 4.6}]}
```

`.metrics/mutate/shop.domain.cart.edn`:

```clojure
{:namespace "shop.domain.cart"
 :forms [{:id "defn/add-item" :killed 6 :survived 0 :uncovered 0 :sites 6}
         {:id "defn-/total" :killed 2 :survived 0 :uncovered 0 :sites 2}]}
```

What it shows at the top level: a **Web** box above a **Domain** box (by
level), a red arrow from Domain up to Web, and a `ring` oval. Both boxes
are red. Domain pools five functions (Cart's two, Order's `place`, and one
each for Pricing and the `domain` module, which have no CRAP and so count
as 20): μ 14.5, σ 10.2, and μ + σ = 24.7 is past red; three of those
functions have no mutation data, so mutation is 8 of 11. Web has a CRAP
entry for `handle` but no mutation data at all.

Double-clicking Domain shows the `domain` module, Cart (green, with its
public `add-item`; the private `total` is only in the side panel), Order (red,
CRAP 27.5), and Pricing (red, with **I**). Dependencies that leave the
current level become ports named after the outside node **at that depth**:
Cart and Order each get an incoming **Web** port (from `web.handler`), and
Order an outgoing **Web** port for its violating dependency.

Open it with `umlify uml/shop.edn`.

## Checklist for producers

1. Use the namespace-tree form (`:hierarchical true`) for a real project.
2. One class per module, with an id relative to the prefix, `:ns`, and
   (for non-Clojure code) `:file` and `:lang`. Ids are unique and stable
   between runs; renaming an id loses the reader's selection and links to it.
3. One class per external library you want to show, with `:foreign true`;
   point edges at it, and drop edges to libraries you do not list.
4. Edges between leaf ids with the right `:kind`.
5. `:level` on every module from your `:levels`, and `:violating true` on
   every dependency from a smaller level to a larger one.
6. Keep `:proposals` (and `:order`, `:edge-kinds`, `:omit`) from the
   previous file; they come from the policy, not from the code.
7. Write the IR and every snapshot **atomically**: write a temp file in the
   same folder, then rename it over the old one. A reader that sees a
   half-written file gets an error until the next change.
8. Check a new file by opening it in umlify: a file that does not load
   shows its error and line.
9. There is nothing to restart: a running umlify picks the change up within
   a second.
