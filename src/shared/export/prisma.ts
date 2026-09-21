/**
 * A Prisma schema from an ERD.
 *
 * Relationships become fields on both sides: the many side carries the
 * `@relation`, the one side carries the list. A name Prisma would reject is
 * slugged and mapped back with `@@map`, so the database keeps the name you
 * wrote.
 */
import type { Diagram, DiagramNode, Edge, Field } from '../dsl'
import { header, slug } from './shared'

const TYPES: Record<string, string> = {
  string: 'String',
  text: 'String',
  int: 'Int',
  bigint: 'BigInt',
  float: 'Float',
  decimal: 'Decimal',
  bool: 'Boolean',
  date: 'DateTime',
  timestamp: 'DateTime',
  uuid: 'String',
  json: 'Json',
  enum: 'String'
}

interface Relation {
  /** The field added to this model. */
  name: string
  type: string
  attribute: string
}

function prismaType(field: Field): { type: string; note: string } {
  if (!field.type) return { type: 'String', note: '' }
  const base = field.type.split('(')[0]
  const mapped = TYPES[base]
  // Never silently pretend an unknown type is a String: say what it was.
  return mapped ? { type: mapped, note: '' } : { type: 'String', note: ` // ${field.type}` }
}

function column(field: Field): { name: string; type: string; rest: string } {
  const { type, note } = prismaType(field)
  const optional =
    field.modifiers.includes('pk') || field.modifiers.includes('notnull') ? '' : '?'

  const attrs: string[] = []
  if (field.modifiers.includes('pk')) attrs.push('@id')
  if (field.modifiers.includes('unique')) attrs.push('@unique')

  return { name: slug(field.name), type: type + optional, rest: (attrs.join(' ') + note).trim() }
}

/** The two fields a relationship adds, keyed by the model each belongs to. */
function relationFields(edge: Edge, byId: Map<string, DiagramNode>): Array<[string, Relation]> {
  const [child, parent] = edge.kind === 'one-to-many' ? [edge.to, edge.from] : [edge.from, edge.to]
  if (!byId.has(child.node) || !byId.has(parent.node)) return []

  if (edge.kind === 'many-to-many') {
    // Nothing to hang a foreign key on, so both sides are plain lists and
    // Prisma builds the join table itself.
    return [
      [child.node, { name: slug(parent.node), type: `${slug(parent.node)}[]`, attribute: '' }],
      [parent.node, { name: slug(child.node), type: `${slug(child.node)}[]`, attribute: '' }]
    ]
  }

  // Without columns there is no way to say which field references which.
  if (!child.field || !parent.field) return []

  return [
    [
      child.node,
      {
        name: slug(parent.node),
        type: slug(parent.node),
        attribute: `@relation(fields: [${slug(child.field)}], references: [${slug(parent.field)}])`
      }
    ],
    [
      parent.node,
      {
        name: slug(child.node),
        type: edge.kind === 'one-to-one' ? slug(child.node) : `${slug(child.node)}[]`,
        attribute: ''
      }
    ]
  ]
}

function model(node: DiagramNode, relations: Relation[]): string {
  const columns = node.fields.map(column)
  const taken = new Set(columns.map((c) => c.name))

  const rows = [
    ...columns.map((c) => [c.name, c.type, c.rest] as const),
    // A relation field cannot collide with a column of the same name.
    ...relations
      .filter((r) => !taken.has(r.name))
      .map((r) => [r.name, r.type, r.attribute] as const)
  ]

  const namePad = Math.max(...rows.map((r) => r[0].length), 0)
  const typePad = Math.max(...rows.map((r) => r[1].length), 0)
  const body = rows
    .map(([name, type, rest]) =>
      `  ${name.padEnd(namePad)} ${type.padEnd(typePad)} ${rest}`.trimEnd()
    )
    .join('\n')

  const mapped = slug(node.name) === node.name ? '' : `\n\n  @@map("${node.name}")`
  return `model ${slug(node.name)} {\n${body}${mapped}\n}`
}

export function toPrisma(diagram: Diagram, title: string): string {
  const tables = diagram.nodes.filter((n) => n.kind === 'table' && !n.implicit)
  const byId = new Map(tables.map((t) => [t.id, t]))

  const relations = new Map<string, Relation[]>()
  for (const edge of diagram.edges) {
    for (const [id, relation] of relationFields(edge, byId)) {
      const list = relations.get(id)
      if (list) list.push(relation)
      else relations.set(id, [relation])
    }
  }

  return [
    header(title, '//'),
    'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}',
    'generator client {\n  provider = "prisma-client-js"\n}',
    ...tables.map((node) => model(node, relations.get(node.id) ?? []))
  ].join('\n\n') + '\n'
}
