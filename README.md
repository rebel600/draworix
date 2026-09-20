# Drawrix

Local-first desktop app for diagrams and schema design. Write a DSL on the left,
get an auto-laid-out diagram on the right, organised into per-project workspaces.

## Status

**M2 complete** — the DSL has a real parser and the code pane is Monaco,
with highlighting, completions, hovers and live diagnostics. The canvas still
draws boxes in a flat list rather than a laid-out diagram; that is M3.

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Electron + React + TS scaffold, typed IPC | done |
| M1 | Workspaces, documents, autosave, history, SQLite index | done |
| M2 | DSL parser with source ranges, Monaco language | done |
| M3 | React Flow canvas + ELK auto-layout | next |
| M4 | Two-way code/canvas sync, unified undo | |
| M5 | Export: SQL, Prisma, DBML, PNG, SVG | |
| M6 | Command palette, themes, packaged installer | |

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
  renderer/   React UI, and the Monaco language registration in lib/
  shared/     types, ipc channel names, document helpers, the DSL parser
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

## How data is stored

Files on disk are the source of truth. The SQLite index in `userData` is
derived and can be deleted at any time — `index:rebuild` regenerates it by
walking the workspaces.

```
E:/drawrix-data/            <- data root, changeable in the app
  my-saas/                  <- workspace = folder
    workspace.json          <- name, icon
    schema.dgm              <- document
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
