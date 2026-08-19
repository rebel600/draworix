# Drawrix

Local-first desktop app for diagrams and schema design. Write a DSL on the left,
get an auto-laid-out diagram on the right, organised into per-project workspaces.

## Status

**M1 complete** — app shell, workspaces, documents, autosave, index.
The code pane is a plain textarea and the canvas is a placeholder; both are
replaced in M2/M3.

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Electron + React + TS scaffold, typed IPC | done |
| M1 | Workspaces, documents, autosave, history, SQLite index | done |
| M2 | DSL parser with source ranges, Monaco language | next |
| M3 | React Flow canvas + ELK auto-layout | |
| M4 | Two-way code/canvas sync, unified undo | |
| M5 | Export: SQL, Prisma, DBML, PNG, SVG | |
| M6 | Command palette, themes, packaged installer | |

## Commands

```bash
npm run dev        # hot-reloading dev app
npm start          # run the production build
npm run build      # typecheck + build all three bundles
npm run smoke      # node-only tests for path guards and atomic writes
npm run dist:win   # NSIS installer into dist/
```

## Layout

```
src/
  main/       Node side: fs, settings, sqlite index, ipc handlers
  preload/    the only bridge the renderer can see (contextBridge)
  renderer/   React UI
  shared/     types, ipc channel names, document helpers
```

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
