/**
 * Node-only smoke test for the logic that must not regress: path escaping,
 * atomic writes, and tolerance of malformed documents.
 * Run with: npm run smoke
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertInsideRoot, readJson, writeJsonAtomic } from '../src/main/fs/atomic'
import { createDocument, normalizeDocument, slugifyName } from '../src/shared/dgm'
import { parse } from '../src/shared/dsl'
import type { Diagnostic, ParseResult } from '../src/shared/dsl'

let failures = 0

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function throws(name: string, fn: () => unknown): void {
  try {
    fn()
    failures++
    console.error(`  FAIL ${name} (expected a throw)`)
  } catch {
    console.log(`  ok   ${name}`)
  }
}

/** Diagnostic codes in source order — the shape assertions read better. */
function codes(result: ParseResult): string[] {
  return result.diagnostics.map((d: Diagnostic) => d.code)
}

function checkDsl(): void {
  console.log('\ndsl: erd')
  const erd = parse(createDocument('Schema', 'erd').source, 'erd')
  check('parses the starter schema cleanly', erd.diagnostics.length === 0, codes(erd).join(','))
  check('finds both tables', erd.diagram.nodes.map((n) => n.id).join(',') === 'users,orders')
  check('every table is a table', erd.diagram.nodes.every((n) => n.kind === 'table'))
  check('reads the columns', erd.diagram.nodes[0].fields.map((f) => f.name).join(',') === 'id,email,name,created_at')
  check('reads a column type', erd.diagram.nodes[0].fields[0].type === 'string')
  check('reads the modifiers', erd.diagram.nodes[0].fields[0].modifiers.join(',') === 'pk')
  check('an untagged column has no modifiers', erd.diagram.nodes[0].fields[2].modifiers.length === 0)
  check('finds the relationship', erd.diagram.edges.length === 1)
  check('reads both endpoints', erd.diagram.edges[0].from.field === 'user_id' && erd.diagram.edges[0].to.node === 'users')
  check('maps > to many-to-one', erd.diagram.edges[0].kind === 'many-to-one')

  console.log('\ndsl: source ranges')
  const src = 'users {\n  id string pk\n}\n'
  const ranged = parse(src, 'erd')
  const table = ranged.diagram.nodes[0]
  check('the table range spans the whole block', src.slice(table.range.start, table.range.end) === 'users {\n  id string pk\n}')
  check('the name range covers just the name', src.slice(table.nameRange.start, table.nameRange.end) === 'users')
  check('the field range covers the column line', src.slice(table.fields[0].range.start, table.fields[0].range.end) === 'id string pk')
  check('line numbers are 1-based', table.fields[0].range.startLine === 2)
  check('columns are 1-based', table.fields[0].range.startColumn === 3)

  console.log('\ndsl: columns')
  const typed = parse('t {\n  price decimal(10,2)\n  id pk\n  note text bogus\n}\n', 'erd')
  const fields = typed.diagram.nodes[0].fields
  check('keeps a parameterised type verbatim', fields[0].type === 'decimal(10,2)')
  check('a bare modifier is not mistaken for a type', fields[1].type === null && fields[1].modifiers.join(',') === 'pk')
  check('flags an unknown modifier', codes(typed).join(',') === 'unknown-modifier')
  check('keeps the column despite the bad modifier', fields[2].name === 'note' && fields[2].type === 'text')

  console.log('\ndsl: erd diagnostics')
  const unknownTable = parse('a {\n  id string\n}\n\na.id > ghosts.id\n', 'erd')
  check('warns about an unknown table', codes(unknownTable).join(',') === 'unknown-table')
  check('drops an edge that points nowhere', unknownTable.diagram.edges.length === 0)

  const unknownColumn = parse('a {\n  id string\n}\nb {\n  id string\n}\na.nope > b.id\n', 'erd')
  check('warns about an unknown column', codes(unknownColumn).join(',') === 'unknown-column')
  check('keeps the edge — the column may be next', unknownColumn.diagram.edges.length === 1)

  const dupes = parse('a {\n  id string\n  id int\n}\na {\n}\n', 'erd')
  check('rejects a duplicate column', codes(dupes).includes('duplicate-column'))
  check('rejects a duplicate table', codes(dupes).includes('duplicate-name'))
  check('keeps only the first of each', dupes.diagram.nodes.length === 1 && dupes.diagram.nodes[0].fields.length === 1)

  console.log('\ndsl: recovery')
  const broken = parse('!!!\nusers {\n  id string pk\n}\n', 'erd')
  check('reports the junk line', codes(broken).join(',') === 'unexpected-token')
  check('carries on to the next statement', broken.diagram.nodes.length === 1)

  const unclosed = parse('users {\n  id string pk\n', 'erd')
  check('reports an unclosed block', codes(unclosed).join(',') === 'unclosed-block')
  check('still returns the table being typed', unclosed.diagram.nodes[0].fields.length === 1)

  const stray = parse('}\nusers {\n}\n', 'erd')
  check('reports a stray closing brace', codes(stray).join(',') === 'unmatched-brace')
  check('parses what follows a stray brace', stray.diagram.nodes.length === 1)

  check('an empty document parses to nothing', parse('', 'erd').diagram.nodes.length === 0)
  const comments = parse('// just a note\n\n', 'erd')
  check('comments alone are not an error', comments.diagnostics.length === 0 && comments.diagram.nodes.length === 0)

  console.log('\ndsl: flow and arch')
  const flow = parse(createDocument('Flow', 'flow').source, 'flow')
  check('parses the starter flow cleanly', flow.diagnostics.length === 0, codes(flow).join(','))
  check('an edge creates its nodes', flow.diagram.nodes.map((n) => n.id).join(',') === 'start,validate,save,done')
  check('those nodes are marked implicit', flow.diagram.nodes.every((n) => n.implicit))
  check('finds every arrow', flow.diagram.edges.length === 3)

  const labelled = parse('a > b : happy path\nb <> c\nc - d\nd < a\n', 'flow')
  check('reads an edge label', labelled.diagram.edges[0].label === 'happy path')
  check('maps every operator', labelled.diagram.edges.map((e) => e.kind).join(',') === 'many-to-one,many-to-many,one-to-one,one-to-many')
  check('labels do not upset the parse', labelled.diagnostics.length === 0, codes(labelled).join(','))

  const arch = parse(createDocument('Arch', 'arch').source, 'arch')
  check('parses the starter architecture cleanly', arch.diagnostics.length === 0, codes(arch).join(','))
  check('a block becomes a group', arch.diagram.nodes[0].kind === 'group')
  check('members point at their group', arch.diagram.nodes[1].parentId === 'vpc')
  check('a declared member is not implicit', !arch.diagram.nodes[1].implicit)
  check('edges reuse the declared members', arch.diagram.nodes.length === 4 && arch.diagram.edges.length === 2)

  const dotted = parse('a.b > c\n', 'flow')
  check('a column reference is flow-only noise', codes(dotted).join(',') === 'unexpected-column')

  console.log('\ndsl: edge ids')
  const twice = parse('a > b\na > b\n', 'flow')
  check('an edge id describes its endpoints', twice.diagram.edges[0].id === 'amany-to-oneb')
  check('a repeated edge still gets a unique id', twice.diagram.edges[1].id === 'amany-to-oneb#1')
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drawrix-smoke-'))

  console.log('\npath guard')
  check('allows a path inside the root', assertInsideRoot(path.join(root, 'ws', 'a.dgm'), root).startsWith(root))
  throws('rejects ../ escape', () => assertInsideRoot(path.join(root, '..', 'evil.dgm'), root))
  throws('rejects an unrelated absolute path', () => assertInsideRoot('C:\\Windows\\system.ini', root))
  throws('rejects the root itself', () => assertInsideRoot(root, root))

  console.log('\nslugify')
  check('strips reserved characters', slugifyName('My: Project*?') === 'My-Project')
  check('collapses whitespace', slugifyName('  order   flow  ') === 'order-flow')
  check('returns empty for junk', slugifyName('***') === '')
  // Built from char codes so this file stays free of control literals.
  const withControls = `a${String.fromCharCode(0)}b${String.fromCharCode(31)}c`
  check('strips control characters', slugifyName(withControls) === 'a-b-c')
  check('handles backslash and pipe', slugifyName('a\\b|c') === 'a-b-c')

  console.log('\natomic write')
  const target = path.join(root, 'nested', 'doc.dgm')
  await writeJsonAtomic(target, createDocument('Schema', 'erd'))
  check('creates missing directories', await readJson<{ title: string }>(target).then((d) => d.title === 'Schema'))
  await writeJsonAtomic(target, { ...createDocument('Schema v2', 'erd') })
  check('overwrites in place', (await readJson<{ title: string }>(target)).title === 'Schema v2')
  const leftovers = (await fs.readdir(path.dirname(target))).filter((f) => f.endsWith('.tmp'))
  check('leaves no temp files behind', leftovers.length === 0)

  console.log('\nmalformed documents')
  const junk = normalizeDocument({ type: 'nonsense', layout: { a: { x: 'no' } } }, 'fallback')
  check('falls back to erd for an unknown type', junk.type === 'erd')
  check('drops non-numeric positions', Object.keys(junk.layout).length === 0)
  check('uses the fallback title', junk.title === 'fallback')
  check('survives null input', normalizeDocument(null, 'x').source === '')

  checkDsl()

  await fs.rm(root, { recursive: true, force: true })

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
