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
import { addEdge, applyEdits, parse, removeEdge, removeNode, renameNode } from '../src/shared/dsl'
import type { Diagnostic, ParseResult, TextEdit } from '../src/shared/dsl'
import {
  renderText,
  targetsFor,
  toDbml,
  toPrisma,
  toSql,
  toSvg
} from '../src/shared/export'
import type { DiagramType } from '../src/shared/types'

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

/** Parse, edit, and hand back the rewritten source. */
function edit(
  source: string,
  type: DiagramType,
  op: (source: string, diagram: ParseResult['diagram']) => TextEdit[]
): string {
  const { diagram } = parse(source, type)
  return applyEdits(source, op(source, diagram))
}

function checkEdits(): void {
  console.log('\ndsl edits: rename')
  const schema = [
    '// the people table',
    'users {',
    '  id    string pk',
    '  users string  // a column that happens to share the name',
    '}',
    '',
    'orders {',
    '  user_id string fk',
    '}',
    '',
    'orders.user_id > users.id',
    ''
  ].join('\n')

  const renamed = edit(schema, 'erd', (src, d) => renameNode(src, d, 'users', 'people'))
  check('renames the declaration', renamed.includes('people {'))
  check('follows the reference in the relationship', renamed.includes('> people.id'))
  check('leaves a same-named column alone', renamed.includes('  users string'))
  check('leaves comments alone', renamed.startsWith('// the people table'))
  check('does not touch other tables', renamed.includes('orders {'))
  const afterRename = parse(renamed, 'erd')
  check(
    'the rewritten source still parses cleanly',
    afterRename.diagnostics.length === 0,
    afterRename.diagnostics.map((x) => x.code).join(',')
  )
  check(
    'and describes the same diagram under the new name',
    afterRename.diagram.nodes.map((n) => n.id).join(',') === 'people,orders' &&
      afterRename.diagram.edges.length === 1
  )

  const quoted = edit(schema, 'erd', (src, d) => renameNode(src, d, 'users', 'App Users'))
  check('quotes a name that needs it', quoted.includes('"App Users" {'))
  check(
    'a quoted rename still parses',
    parse(quoted, 'erd').diagram.nodes.some((n) => n.name === 'App Users')
  )
  check(
    'renaming to the same name is not an edit',
    edit(schema, 'erd', (src, d) => renameNode(src, d, 'users', 'users')) === schema
  )

  const implicit = edit('start > validate\nvalidate > done\n', 'flow', (src, d) =>
    renameNode(src, d, 'validate', 'check')
  )
  check('renames a node that only edges mention', implicit === 'start > check\ncheck > done\n')

  console.log('\ndsl edits: delete')
  const withoutUsers = edit(schema, 'erd', (src, d) => removeNode(src, d, 'users'))
  check('removes the block', !withoutUsers.includes('users {'))
  check('removes the relationship that used it', !withoutUsers.includes('orders.user_id >'))
  check('keeps the other table whole', withoutUsers.includes('orders {'))
  check(
    'leaves nothing dangling',
    parse(withoutUsers, 'erd').diagnostics.length === 0,
    JSON.stringify(withoutUsers)
  )

  const arch = 'vpc {\n  alb\n  api\n}\n\nalb > api\napi > db\n'
  const withoutVpc = edit(arch, 'arch', (src, d) => removeNode(src, d, 'vpc'))
  check('deleting a group takes its members', !withoutVpc.includes('alb'))
  check('and every relationship between them', !withoutVpc.includes('> api'))
  check('leaving only what stood outside it', withoutVpc.trim() === '')

  const oneMember = edit(arch, 'arch', (src, d) => removeNode(src, d, 'alb'))
  check('deleting a member keeps the group', oneMember.includes('vpc {'))
  check('and keeps its siblings', oneMember.includes('  api'))
  check('and drops the relationships it was in', !oneMember.includes('alb'))
  check('and keeps the ones it was not in', oneMember.includes('api > db'))

  const trimmed = edit('a > b // why\nb > c\n', 'flow', (src, d) =>
    removeEdge(src, d, parse(src, 'flow').diagram.edges[0].id)
  )
  check('removing a relationship takes its trailing comment', trimmed === 'b > c\n')
  check(
    'removing a relationship leaves both nodes alone',
    edit('x\ny\nx > y\n', 'flow', (src, d) =>
      removeEdge(src, d, parse(src, 'flow').diagram.edges[0].id)
    ) === 'x\ny\n'
  )

  console.log('\ndsl edits: connect')
  check(
    'appends a relationship',
    edit('a > b\n', 'flow', (src, d) => addEdge(src, d, 'b', 'c')) === 'a > b\nb > c\n'
  )
  check(
    'uses the operator for the kind asked for',
    edit('a > b\n', 'flow', (src, d) => addEdge(src, d, 'b', 'c', 'many-to-many')) ===
      'a > b\nb <> c\n'
  )
  check(
    'starts a new line when the file lacks one',
    edit('a > b', 'flow', (src, d) => addEdge(src, d, 'b', 'c')) === 'a > b\nb > c\n'
  )
  check(
    'refuses to duplicate a relationship',
    edit('a > b\n', 'flow', (src, d) => addEdge(src, d, 'a', 'b')) === 'a > b\n'
  )
  check(
    'refuses to join a node to itself',
    edit('a > b\n', 'flow', (src, d) => addEdge(src, d, 'a', 'a')) === 'a > b\n'
  )
  check(
    'quotes a name that needs it',
    edit('a > b\n', 'flow', (src, d) => addEdge(src, d, 'a', 'two words')).includes('"two words"')
  )
}

const SCHEMA = [
  '// a schema worth exporting',
  'users {',
  '  id         uuid      pk',
  '  email      string    unique',
  '  full_name  string',
  '  balance    decimal(10,2)',
  '  created_at timestamp notnull',
  '  legacy_ref citext    index',
  '}',
  '',
  'orders {',
  '  id      uuid   pk',
  '  user_id uuid   fk',
  '  total   decimal(10,2)',
  '}',
  '',
  'orders.user_id > users.id',
  ''
].join('\n')

function checkExports(): void {
  const { diagram } = parse(SCHEMA, 'erd')

  console.log('\nexport: sql')
  const sql = toSql(diagram, 'Billing')
  check('names the document it came from', sql.startsWith('-- Billing'))
  check('creates every table', sql.includes('CREATE TABLE users (') && sql.includes('CREATE TABLE orders ('))
  check('maps the types', sql.includes('email      text') && sql.includes('created_at timestamptz'))
  check('keeps type arguments', sql.includes('numeric(10,2)'))
  check('passes an unknown type through', sql.includes('citext'))
  check('a primary key is not null', sql.includes('id         uuid NOT NULL'))
  check('notnull is honoured', sql.includes('timestamptz NOT NULL'))
  check('a plain column stays nullable', sql.includes('full_name  text,'))
  check('declares the primary key', sql.includes('PRIMARY KEY (id)'))
  check('declares the unique', sql.includes('UNIQUE (email)'))
  check('creates the index', sql.includes('CREATE INDEX users_legacy_ref_idx ON users (legacy_ref);'))
  check(
    'adds the foreign key in the right direction',
    sql.includes(
      'ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id);'
    )
  )
  check(
    'reverses a one-to-many',
    toSql(parse('a {\n  id uuid pk\n}\nb {\n  a_id uuid\n}\na.id < b.a_id\n', 'erd').diagram, 't')
      .includes('ALTER TABLE b ADD CONSTRAINT b_a_id_fkey FOREIGN KEY (a_id) REFERENCES a (id);')
  )
  check(
    'a one-to-one is also unique',
    toSql(parse('a {\n  id uuid pk\n}\nb {\n  a_id uuid\n}\nb.a_id - a.id\n', 'erd').diagram, 't')
      .includes('ADD CONSTRAINT b_a_id_key UNIQUE (a_id);')
  )
  check(
    'says what it cannot do for a many-to-many',
    toSql(parse('a {\n  id uuid pk\n}\nb {\n  id uuid pk\n}\na.id <> b.id\n', 'erd').diagram, 't')
      .includes('a many-to-many needs a join table')
  )
  check(
    'says what it cannot do without columns',
    toSql(parse('a {\n  id uuid pk\n}\nb {\n  id uuid pk\n}\na > b\n', 'erd').diagram, 't')
      .includes('name the columns to get a foreign key')
  )
  check(
    'quotes a name that needs it',
    toSql(parse('"Order Items" {\n  id uuid pk\n}\n', 'erd').diagram, 't')
      .includes('CREATE TABLE "Order Items" (')
  )

  console.log('\nexport: prisma')
  const prisma = toPrisma(diagram, 'Billing')
  check('declares a datasource', prisma.includes('datasource db {'))
  check('models every table', prisma.includes('model users {') && prisma.includes('model orders {'))
  check('maps the types', prisma.includes('created_at DateTime'))
  check('marks the primary key', prisma.includes('@id'))
  check('marks the unique', prisma.includes('@unique'))
  check('optional unless required', prisma.includes('full_name  String?'))
  check('required stays required', /created_at DateTime\s/.test(prisma))
  check('notes an unmapped type rather than lying', prisma.includes('// citext'))
  check('writes the relation on the many side', prisma.includes('@relation(fields: [user_id], references: [id])'))
  check('and the list on the one side', prisma.includes('orders     orders[]'))
  const mapped = toPrisma(parse('"Order Items" {\n  id uuid pk\n}\n', 'erd').diagram, 't')
  check('slugs a name prisma would reject', mapped.includes('model Order_Items {'))
  check('and maps it back to the real one', mapped.includes('@@map("Order Items")'))

  console.log('\nexport: dbml')
  const dbml = toDbml(diagram, 'Billing')
  check('declares every table', dbml.includes('Table users {') && dbml.includes('Table orders {'))
  check('keeps the types as written', dbml.includes('decimal(10,2)'))
  check('carries the settings', dbml.includes('[pk]') && dbml.includes('[unique]'))
  check('writes an indexes block', dbml.includes('Indexes {') && dbml.includes('    legacy_ref'))
  check('writes the ref with our own operator', dbml.includes('Ref: orders.user_id > users.id'))
  check(
    'keeps the operator of every kind',
    toDbml(parse('a {\n  id uuid\n}\nb {\n  id uuid\n}\na.id <> b.id\n', 'erd').diagram, 't')
      .includes('Ref: a.id <> b.id')
  )

  console.log('\nexport: svg')
  const positions = { users: { x: 0, y: 0 }, orders: { x: 400, y: 120 } }
  const svg = toSvg(diagram, positions, 'Billing')
  check('is an svg document', svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  check('is closed', svg.trimEnd().endsWith('</svg>'))
  check('titles itself after the document', svg.includes('<title>Billing</title>'))
  check('draws no foreignObject', !svg.includes('foreignObject'))
  check('draws every table name', svg.includes('>users</text>') && svg.includes('>orders</text>'))
  check('draws the columns', svg.includes('>created_at</text>'))
  check('draws the modifiers apart from the type', svg.includes('<tspan fill="#7ba3ff"> pk</tspan>'))
  check('draws a relationship', svg.includes('marker-end="url(#arrow)"'))
  check('sizes the viewBox around the nodes', /viewBox="-28 -28 \d/.test(svg))
  check('escapes text', toSvg(parse('"a<b>" {\n}\n', 'erd').diagram, {}, 't').includes('a&lt;b&gt;'))
  check('survives an empty diagram', toSvg(parse('', 'erd').diagram, {}, 'Empty').includes('Nothing to draw'))

  const arch = parse(createDocument('Arch', 'arch').source, 'arch')
  const archSvg = toSvg(
    arch.diagram,
    { vpc: { x: 0, y: 0 }, alb: { x: 16, y: 34 }, api: { x: 190, y: 34 }, db: { x: 364, y: 34 } },
    'Platform'
  )
  check('draws a group as a dashed box', archSvg.includes('stroke-dasharray="4 4"'))
  check('labels the group', archSvg.includes('>VPC</text>'))
  check(
    'places members relative to their group',
    // alb sits at 16,34 inside a group at 0,0 — so it is drawn there, not at 16,34 of nowhere.
    archSvg.includes('x="16" y="34"')
  )

  console.log('\nexport: targets')
  check('an erd can export everything', targetsFor('erd').length === 5)
  check('a flow exports pictures only', targetsFor('flow').map((t) => t.id).join(',') === 'svg,png')
  check('renderText routes by format', renderText('dbml', diagram, 'Billing', {}).includes('Table users {'))
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
  checkEdits()
  checkExports()

  await fs.rm(root, { recursive: true, force: true })

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
