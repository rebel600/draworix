/**
 * PostgreSQL DDL from an ERD.
 *
 * A column is nullable unless it is a primary key or marked `notnull`, which
 * is what SQL itself does. Types the DSL does not know are passed through
 * verbatim rather than guessed at: if you wrote `citext`, you meant `citext`.
 */
import type { Diagram, DiagramNode, Edge, Field } from '../dsl'
import { header, quoteIf } from './shared'

/** DSL type to Postgres type. Anything unlisted passes through as written. */
const TYPES: Record<string, string> = {
  string: 'text',
  text: 'text',
  int: 'integer',
  bigint: 'bigint',
  float: 'double precision',
  decimal: 'numeric',
  bool: 'boolean',
  date: 'date',
  timestamp: 'timestamptz',
  uuid: 'uuid',
  json: 'jsonb',
  enum: 'text'
}

/** Postgres folds unquoted identifiers to lower case; quote anything else. */
function ident(name: string): string {
  return quoteIf(name, /^[a-z_][a-z0-9_]*$/, '"')
}

function sqlType(field: Field): string {
  if (!field.type) return 'text'
  // `decimal(10,2)` keeps its arguments, mapping only the name in front.
  const open = field.type.indexOf('(')
  const base = open === -1 ? field.type : field.type.slice(0, open)
  const args = open === -1 ? '' : field.type.slice(open)
  return (TYPES[base] ?? base) + args
}

function column(field: Field, pad: number): string {
  const required = field.modifiers.includes('pk') || field.modifiers.includes('notnull')
  return `  ${ident(field.name).padEnd(pad)} ${sqlType(field)}${required ? ' NOT NULL' : ''}`
}

function table(node: DiagramNode): string {
  const pad = Math.max(...node.fields.map((f) => ident(f.name).length), 0)
  const lines = node.fields.map((f) => column(f, pad))

  const keys = node.fields.filter((f) => f.modifiers.includes('pk')).map((f) => ident(f.name))
  if (keys.length > 0) lines.push(`  PRIMARY KEY (${keys.join(', ')})`)
  for (const field of node.fields) {
    if (field.modifiers.includes('unique')) lines.push(`  UNIQUE (${ident(field.name)})`)
  }

  if (lines.length === 0) {
    return `CREATE TABLE ${ident(node.name)} ();`
  }
  return `CREATE TABLE ${ident(node.name)} (\n${lines.join(',\n')}\n);`
}

/** A relationship, read in the direction the foreign key points. */
function foreignKey(edge: Edge): string {
  const [child, parent] =
    edge.kind === 'one-to-many' ? [edge.to, edge.from] : [edge.from, edge.to]

  if (edge.kind === 'many-to-many') {
    return `-- ${edge.from.node} <> ${edge.to.node}: a many-to-many needs a join table.`
  }
  if (!child.field || !parent.field) {
    return `-- ${edge.from.node} to ${edge.to.node}: name the columns to get a foreign key.`
  }

  const name = ident(`${child.node}_${child.field}_fkey`)
  const unique =
    edge.kind === 'one-to-one'
      ? `\nALTER TABLE ${ident(child.node)} ADD CONSTRAINT ${ident(
          `${child.node}_${child.field}_key`
        )} UNIQUE (${ident(child.field)});`
      : ''

  return (
    `ALTER TABLE ${ident(child.node)} ADD CONSTRAINT ${name} ` +
    `FOREIGN KEY (${ident(child.field)}) REFERENCES ${ident(parent.node)} (${ident(parent.field)});` +
    unique
  )
}

export function toSql(diagram: Diagram, title: string): string {
  const tables = diagram.nodes.filter((n) => n.kind === 'table' && !n.implicit)
  const indexes = tables.flatMap((node) =>
    node.fields
      .filter((f) => f.modifiers.includes('index'))
      .map(
        (f) =>
          `CREATE INDEX ${ident(`${node.name}_${f.name}_idx`)} ` +
          `ON ${ident(node.name)} (${ident(f.name)});`
      )
  )

  const parts = [
    header(title, '--'),
    ...tables.map(table),
    ...indexes,
    ...diagram.edges.map(foreignKey)
  ]
  return parts.filter(Boolean).join('\n\n') + '\n'
}
