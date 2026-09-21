/**
 * DBML, for dbdiagram.io and dbdocs.
 *
 * The closest target of the three: DBML's relationship operators are the same
 * four this DSL uses, and its types are free text, so nothing is translated
 * that does not have to be.
 */
import type { Diagram, DiagramNode, Edge, Field } from '../dsl'
import { EDGE_OPERATORS } from '../dsl'
import { header, quoteIf } from './shared'

function ident(name: string): string {
  return quoteIf(name, /^[A-Za-z_]\w*$/, '"')
}

/** DBML column settings, in the square brackets after the type. */
function settings(field: Field): string {
  const parts: string[] = []
  if (field.modifiers.includes('pk')) parts.push('pk')
  if (field.modifiers.includes('unique')) parts.push('unique')
  if (field.modifiers.includes('notnull')) parts.push('not null')
  if (field.modifiers.includes('null')) parts.push('null')
  return parts.length ? ` [${parts.join(', ')}]` : ''
}

function table(node: DiagramNode): string {
  const pad = Math.max(...node.fields.map((f) => ident(f.name).length), 0)
  const columns = node.fields.map(
    (f) => `  ${ident(f.name).padEnd(pad)} ${f.type ?? 'text'}${settings(f)}`
  )

  // `index` is an Indexes block in DBML rather than a column setting.
  const indexed = node.fields.filter((f) => f.modifiers.includes('index'))
  const indexes = indexed.length
    ? ['', '  Indexes {', ...indexed.map((f) => `    ${ident(f.name)}`), '  }']
    : []

  return `Table ${ident(node.name)} {\n${[...columns, ...indexes].join('\n')}\n}`
}

function ref(edge: Edge): string {
  const operator = EDGE_OPERATORS[edge.kind]
  if (!edge.from.field || !edge.to.field) {
    return `// ${edge.from.node} ${operator} ${edge.to.node}: name the columns to get a Ref.`
  }
  return (
    `Ref: ${ident(edge.from.node)}.${ident(edge.from.field)} ${operator} ` +
    `${ident(edge.to.node)}.${ident(edge.to.field)}`
  )
}

export function toDbml(diagram: Diagram, title: string): string {
  const tables = diagram.nodes.filter((n) => n.kind === 'table' && !n.implicit)
  return (
    [header(title, '//'), ...tables.map(table), ...diagram.edges.map(ref)]
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}
