# Drawrix

Local-first desktop app for diagrams and schema design. Write a DSL on the left,
get an auto-laid-out diagram on the right, organised into per-project workspaces.

## Status

**M5 complete** — a schema exports to SQL, Prisma and DBML, and any diagram
exports to SVG and PNG. Next is M6: a command palette, themes, and a packaged
installer.

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Electron + React + TS scaffold, typed IPC | done |
| M1 | Workspaces, documents, autosave, history, SQLite index | done |
| M2 | DSL parser with source ranges, Monaco language | done |
| M3 | React Flow canvas + ELK auto-layout | done |
| M4 | Two-way code/canvas sync, unified undo | done |
| M5 | Export: SQL, Prisma, DBML, PNG, SVG | done |
| M6 | Command palette, themes, packaged installer | next |

## Commands

```bash
npm run dev        # hot-reloading dev app
npm start          # run the production build
npm run build      # typecheck + build all three bundles
npm run smoke      # node-only tests: path guards, atomic writes, the parser
npm run dist:win   # NSIS installer into dist/
node scripts/drive.mjs --clean   # drive the built app and screenshot each step
```

## Layout

```
src/
  main/       Node side: fs, settings, sqlite index, ipc handlers
  preload/    the only bridge the renderer can see (contextBridge)
  renderer/   React UI: Monaco setup and ELK layout in lib/, canvas in components/
  shared/     types, ipc names, document helpers, the DSL, its edits, exporters
```

`src/shared` is compiled into all three bundles, so nothing there may import
`node:` or touch the DOM. The parser lives there because main (for exports)
and renderer (for the editor and canvas) both need it.

## The DSL

One grammar covers all three diagram types. It is line-oriented — no
semicolons, no significant indentation.

```
users {                      a block: a table (erd) or a group (flow, arch)
  id         string  pk      a column: name, optional type, then modifiers
  email      string  unique
  price      decimal(10,2)   argument lists are kept verbatim
}

orders.user_id > users.id    a relationship between two endpoints
start > validate : ok        an edge with a label
done                         a bare name declares a node

// comments run to the end of the line
```

| | |
| --- | --- |
| Operators | `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many |
| Column modifiers | `pk` `fk` `unique` `index` `null` `notnull` |
| Names | letters, digits and `_`; quote anything else: `"Order Items"` |

In flow and arch diagrams, naming a node in a relationship creates it. In an
ERD it does not: a relationship pointing at a table you never declared is
almost always a typo, so it is reported and the edge is dropped.

The parser lives in `src/shared/dsl` and never throws. A line it cannot make
sense of becomes a diagnostic and is skipped, so a half-typed file still draws
everything around the line you are working on. Every declaration carries the
source range it came from, which is what the editor underlines today and what
M4 will use to map a canvas edit back to the text that produced it.

The editor and the canvas render from the same parse, so they cannot disagree.

## Where nodes go

Two sources, and only two.

**ELK**, running in a web worker, places anything nobody has touched. That
result is derived from the source and is never written to disk: it is
deterministic, so reopening a document puts everything back where it was.
Node sizes are computed rather than measured, which is what lets one layout
pass be enough.

**You**, by dragging. A dragged node's position is written to `layout` in the
`.dgm` file and wins from then on. So the file records positions a person
chose and nothing else, and `layout` stays empty until someone means it to
have something in it. *Auto layout* in the top-right of the canvas clears
those positions and hands the whole diagram back to ELK.

A group's box is sized around its members, so an architecture diagram's
containers grow with what is in them.

## Editing from either side

| On the canvas | What it does to the source |
| --- | --- |
| Pencil on a node, or F2 | Rewrites the declaration and every reference to it |
| Delete on a selected node | Removes its block, anything nested in it, and its relationships |
| Delete on a selected relationship | Removes that one statement |
| Drag between two nodes | Appends a relationship |
| Drag a node | Touches `layout` only — never the source |

The canvas never prints the parsed model back out. Doing that would reformat
hand-written DSL, reorder statements and drop every comment, so each action
instead becomes a handful of replacements aimed at the ranges the parser
recorded. Deleting a relationship takes the comment trailing it; renaming a
table leaves a column that happens to share its name alone. The edits are
pure functions in `src/shared/dsl/edits.ts`, and they are the best-tested
code in the repo for good reason.

Edits are measured against the text they were computed from, and dropped if
the document has moved on since. An offset only means something against one
version of a file.

### Selection

There is one selection, shared. The editor sets it from whatever the caret is
inside; the canvas sets it from whatever you clicked and sends the caret
after it. Only that direction moves the caret — echoing the editor's own
caret back at it would drag the cursor around while you type.

### Undo

Canvas actions are applied to the editor's model rather than to the store, so
they land on the same undo stack as typing: Ctrl+Z from either pane takes
back the last change to the document, whichever pane made it.

Dragging is the exception, because it changes `layout` and Monaco knows
nothing about that. Those steps are kept in `lib/history.ts` alongside the
text version they happened at, which is what keeps the two in order: a drag
is only undone first if no text edit landed after it. *Auto layout* is
recorded the same way, so handing the diagram back to ELK is undoable too.

## Export

*Export* on the canvas writes into an `exports` folder beside the document,
inside its workspace — plain files like everything else here, with a toast
saying where each one landed.

| Format | For | Notes |
| --- | --- | --- |
| SQL | ERD | PostgreSQL DDL. Columns are nullable unless `pk` or `notnull`, as in SQL itself. |
| Prisma | ERD | Relations on both sides; names Prisma rejects are slugged and `@@map`ped back. |
| DBML | ERD | Near one-to-one: DBML uses the same four relationship operators. |
| SVG | any | Real vector artwork — rectangles, paths and text, no `foreignObject`. |
| PNG | any | The SVG above, rasterised at 2x. |

The exporters are pure functions in `src/shared/export`, so each one is tested
like the parser is. They say what they cannot do rather than guess: an unknown
column type passes through verbatim to SQL and DBML and is annotated in
Prisma, and a relationship with no columns named becomes a comment instead of
an invented foreign key.

Pictures are drawn from the model, not captured from the screen, using the
same sizes the canvas renders at — so an export is laid out exactly like the
canvas, and works even straight after switching tabs, before the canvas has
finished arranging itself.

## How data is stored

Files on disk are the source of truth. The SQLite index in `userData` is
derived and can be deleted at any time — `index:rebuild` regenerates it by
walking the workspaces.

```
E:/drawrix-data/            <- data root, changeable in the app
  my-saas/                  <- workspace = folder
    workspace.json          <- name, icon
    schema.dgm              <- document
    exports/                <- anything exported from it
    .history/               <- last 20 versions of each document
```

A `.dgm` file separates structure from position on purpose:

```json
{
  "version": 1,
  "type": "erd",
  "title": "Schema",
  "source": "users {\n  id string pk\n}\n",
  "layout": { "users": { "x": 120, "y": 40 } }
}
```

`source` is the DSL you author; `layout` holds node positions. Dragging a node
touches only `layout`, so the canvas can never reformat or mangle hand-written
source.

## Security posture

The renderer runs sandboxed with `contextIsolation` on and `nodeIntegration`
off. It reaches the filesystem only through the preload API, and every path it
supplies is re-validated against the data root in the main process before use.
