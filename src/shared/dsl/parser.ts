/**
 * Parser for the Drawrix DSL.
 *
 *   users {                     a block: a table (erd) or a group (flow/arch)
 *     id    string  pk          a column: name, optional type, modifiers
 *     email string  unique
 *   }
 *
 *   orders.user_id > users.id   a relationship between two endpoints
 *   start > validate : ok       an edge with a label
 *   done                        a bare name declares a node
 *
 * The parser never throws and never gives up on a file. A line it cannot make
 * sense of produces a diagnostic and is skipped, so the canvas keeps rendering
 * everything around the line you are still typing.
 */
import type { DiagramType } from '../types'
import {
  FIELD_MODIFIERS,
  type Diagnostic,
  type DiagramNode,
  type Edge,
  type EdgeKind,
  type Endpoint,
  type Field,
  type FieldModifier,
  type NodeKind,
  type ParseResult,
  type Range,
  type Severity
} from './ast'
import { spanRange, tokenize, type Token } from './lexer'

const MODIFIERS = new Set<string>(FIELD_MODIFIERS)

const EDGE_KINDS: Record<string, EdgeKind> = {
  '>': 'many-to-one',
  '<': 'one-to-many',
  '-': 'one-to-one',
  '<>': 'many-to-many'
}

/** An edge as written, before we know whether its endpoints exist. */
interface RawEdge {
  from: Endpoint
  to: Endpoint
  kind: EdgeKind
  label: string | null
  range: Range
}

interface Name {
  text: string
  range: Range
}

/** An endpoint plus the text the author actually wrote for it. */
type Qualified = Endpoint & { text: string }

class Parser {
  private readonly tokens: Token[]
  private pos = 0

  private readonly nodes = new Map<string, DiagramNode>()
  private readonly order: string[] = []
  private readonly rawEdges: RawEdge[] = []
  private readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly source: string,
    private readonly type: DiagramType
  ) {
    this.tokens = tokenize(source)
  }

  parse(): ParseResult {
    this.parseStatements(null)

    // A stray '}' at top level: report it rather than silently stopping here.
    while (!this.atEnd()) {
      const token = this.next()
      if (token.kind === 'punct' && token.text === '}') {
        this.report('error', 'unmatched-brace', 'No block is open here.', token.range)
      }
      this.parseStatements(null)
    }

    const edges = this.resolveEdges()
    return {
      diagram: {
        type: this.type,
        nodes: this.order.map((id) => this.nodes.get(id) as DiagramNode),
        edges
      },
      diagnostics: this.diagnostics
    }
  }

  // ---------------------------------------------------------------- statements

  /** Parse until eof or the '}' that closes the enclosing block. */
  private parseStatements(parentId: string | null): void {
    for (;;) {
      this.skipTrivia()
      if (this.atEnd()) return
      if (this.at('punct', '}')) return
      this.parseStatement(parentId)
    }
  }

  private parseStatement(parentId: string | null): void {
    const name = this.parseName()
    if (!name) {
      const token = this.peek()
      this.report('error', 'unexpected-token', `Expected a name, found ${quote(token)}.`, token.range)
      this.skipLine()
      return
    }

    // A dotted name only means something on either side of an operator.
    const qualified = this.parseQualifier(name)

    if (this.at('punct', '{')) {
      if (qualified.field) {
        this.report('error', 'dotted-block-name', 'A block name cannot contain a dot.', qualified.range)
      }
      this.parseBlock(qualified, parentId)
      return
    }

    if (this.peek().kind === 'op') {
      this.parseEdge(qualified)
      return
    }

    if (this.atLineEnd()) {
      if (qualified.field) {
        this.report(
          'error',
          'dangling-column',
          `'${qualified.text}' names a column but declares no relationship.`,
          qualified.range
        )
      } else {
        this.declare(name, this.type === 'erd' ? 'table' : 'node', parentId, name.range)
      }
      this.skipLine()
      return
    }

    const token = this.peek()
    this.report(
      'error',
      'unexpected-token',
      `Expected '{' or a relationship operator after '${qualified.text}', found ${quote(token)}.`,
      token.range
    )
    this.skipLine()
  }

  private parseBlock(name: Qualified, parentId: string | null): void {
    const open = this.next() // '{'
    const kind: NodeKind = this.type === 'erd' ? 'table' : 'group'
    const node = this.declare({ text: name.node, range: name.range }, kind, parentId, name.range)

    if (this.type === 'erd') {
      this.parseFields(node)
    } else {
      this.parseStatements(node ? node.id : parentId)
    }

    if (this.at('punct', '}')) {
      const close = this.next()
      if (node) node.range = spanRange(node.range, close.range)
    } else {
      this.report('error', 'unclosed-block', `'${name.node}' is missing a closing brace.`, open.range)
      if (node) node.range = spanRange(node.range, this.peek().range)
    }
  }

  private parseFields(table: DiagramNode | null): void {
    for (;;) {
      this.skipTrivia()
      if (this.atEnd() || this.at('punct', '}')) return
      const field = this.parseField()
      if (!field || !table) continue
      if (table.fields.some((f) => f.name === field.name)) {
        this.report(
          'error',
          'duplicate-column',
          `'${table.name}' already has a column called '${field.name}'.`,
          field.nameRange
        )
        continue
      }
      table.fields.push(field)
    }
  }

  private parseField(): Field | null {
    const name = this.parseName()
    if (!name) {
      const token = this.peek()
      this.report(
        'error',
        'unexpected-token',
        `Expected a column name, found ${quote(token)}.`,
        token.range
      )
      this.skipLine()
      return null
    }

    let type: string | null = null
    let last = name.range

    // The first bare word is the type — unless it is a modifier, so that
    // `id pk` means an untyped primary key, not a column of type `pk`.
    if (this.peek().kind === 'ident' && !MODIFIERS.has(this.peek().text)) {
      const typeToken = this.next()
      last = typeToken.range
      if (this.at('punct', '(')) {
        // Keep `decimal(10,2)` verbatim — the M5 exporters need the arguments.
        while (!this.atEnd() && !this.atLineEnd() && !this.at('punct', ')')) this.next()
        if (this.at('punct', ')')) {
          last = this.next().range
        } else {
          this.report('error', 'unclosed-args', 'Missing a closing parenthesis.', typeToken.range)
        }
      }
      type = this.source.slice(typeToken.range.start, last.end)
    }

    const modifiers: FieldModifier[] = []
    while (!this.atEnd() && !this.atLineEnd()) {
      const token = this.peek()
      if (token.kind !== 'ident') {
        this.report(
          'error',
          'unexpected-token',
          `Expected a column modifier, found ${quote(token)}.`,
          token.range
        )
        break
      }
      this.next()
      last = token.range
      if (MODIFIERS.has(token.text)) {
        modifiers.push(token.text as FieldModifier)
      } else {
        this.report(
          'warning',
          'unknown-modifier',
          `Unknown column modifier '${token.text}'. Known: ${FIELD_MODIFIERS.join(', ')}.`,
          token.range
        )
      }
    }

    this.skipLine()
    return {
      name: name.text,
      type,
      modifiers,
      range: spanRange(name.range, last),
      nameRange: name.range
    }
  }

  private parseEdge(from: Qualified): void {
    const op = this.next()
    const kind = EDGE_KINDS[op.text]
    if (!kind) {
      this.report('error', 'unknown-operator', `Unknown operator '${op.text}'.`, op.range)
      this.skipLine()
      return
    }

    const target = this.parseName()
    if (!target) {
      const token = this.peek()
      const blank = token.kind === 'newline' || token.kind === 'eof' || token.kind === 'comment'
      this.report(
        'error',
        'missing-endpoint',
        `Expected a name after '${op.text}'.`,
        blank ? op.range : token.range
      )
      this.skipLine()
      return
    }
    const to = this.parseQualifier(target)

    let label: string | null = null
    let last = to.range
    if (this.at('punct', ':')) {
      const colon = this.next()
      const end = this.lineEndOffset()
      label = this.source.slice(colon.range.end, end).trim() || null
      if (!label) {
        this.report('warning', 'empty-label', 'This relationship has an empty label.', colon.range)
      }
      // The label is raw text, so step over whatever it tokenized into.
      while (!this.atEnd() && !this.atLineEnd()) last = this.next().range
    } else if (!this.atLineEnd()) {
      const token = this.peek()
      this.report(
        'error',
        'unexpected-token',
        `Unexpected ${quote(token)} after the relationship.`,
        token.range
      )
    }
    this.skipLine()

    this.rawEdges.push({
      from: { node: from.node, field: from.field, range: from.range },
      to: { node: to.node, field: to.field, range: to.range },
      kind,
      label,
      range: spanRange(from.range, last)
    })
  }

  // ------------------------------------------------------------------ helpers

  /** `users`, or `orders.user_id` when a dot follows. */
  private parseQualifier(name: Name): Qualified {
    if (!this.at('punct', '.')) {
      return { node: name.text, field: null, range: name.range, text: name.text }
    }
    this.next()
    const field = this.parseName()
    if (!field) {
      this.report('error', 'missing-column', 'Expected a column name after the dot.', this.peek().range)
      return { node: name.text, field: null, range: name.range, text: name.text }
    }
    return {
      node: name.text,
      field: field.text,
      range: spanRange(name.range, field.range),
      text: `${name.text}.${field.text}`
    }
  }

  private declare(
    name: Name,
    kind: NodeKind,
    parentId: string | null,
    range: Range
  ): DiagramNode | null {
    const existing = this.nodes.get(name.text)
    if (existing) {
      // An edge earlier in the file may have invented this node; a real
      // declaration takes it over rather than colliding with it.
      if (existing.implicit) {
        existing.implicit = false
        existing.kind = kind
        existing.parentId = parentId
        existing.range = range
        existing.nameRange = name.range
        return existing
      }
      this.report(
        'error',
        'duplicate-name',
        `'${name.text}' is already defined in this diagram.`,
        name.range
      )
      return null
    }

    const node: DiagramNode = {
      id: name.text,
      name: name.text,
      kind,
      parentId,
      fields: [],
      implicit: false,
      range,
      nameRange: name.range
    }
    this.nodes.set(node.id, node)
    this.order.push(node.id)
    return node
  }

  /**
   * Second pass. Endpoints may point forwards, so resolution only makes sense
   * once every declaration in the file has been seen.
   */
  private resolveEdges(): Edge[] {
    const edges: Edge[] = []
    const used = new Map<string, number>()

    for (const raw of this.rawEdges) {
      const from = this.resolveEndpoint(raw.from)
      const to = this.resolveEndpoint(raw.to)
      if (!from || !to) continue

      // Ids are derived from the endpoints so they survive edits elsewhere in
      // the file; a repeated relationship gets a counter.
      const base = `${endpointKey(raw.from)}${raw.kind}${endpointKey(raw.to)}`
      const seen = used.get(base) ?? 0
      used.set(base, seen + 1)

      edges.push({
        id: seen === 0 ? base : `${base}#${seen}`,
        from: raw.from,
        to: raw.to,
        kind: raw.kind,
        label: raw.label,
        range: raw.range
      })
    }

    return edges
  }

  /** Returns null when the edge should be dropped from the diagram. */
  private resolveEndpoint(endpoint: Endpoint): DiagramNode | null {
    const node = this.nodes.get(endpoint.node)

    if (this.type === 'erd') {
      // A typo'd table should surface as a warning, not as a phantom box.
      if (!node) {
        this.report(
          'warning',
          'unknown-table',
          `No table called '${endpoint.node}' in this diagram.`,
          endpoint.range
        )
        return null
      }
      if (endpoint.field && !node.fields.some((f) => f.name === endpoint.field)) {
        this.report(
          'warning',
          'unknown-column',
          `'${node.name}' has no column '${endpoint.field}'.`,
          endpoint.range
        )
      }
      return node
    }

    if (endpoint.field) {
      this.report(
        'warning',
        'unexpected-column',
        'Only ERD relationships can point at a column.',
        endpoint.range
      )
    }
    if (node) return node

    // In flow and arch diagrams, naming a node in an edge is how you create it.
    const implicit: DiagramNode = {
      id: endpoint.node,
      name: endpoint.node,
      kind: 'node',
      parentId: null,
      fields: [],
      implicit: true,
      range: endpoint.range,
      nameRange: endpoint.range
    }
    this.nodes.set(implicit.id, implicit)
    this.order.push(implicit.id)
    return implicit
  }

  private parseName(): Name | null {
    const token = this.peek()
    if (token.kind !== 'ident' && token.kind !== 'string') return null
    this.next()
    return { text: token.text, range: token.range }
  }

  private report(severity: Severity, code: string, message: string, range: Range): void {
    this.diagnostics.push({ severity, code, message, range })
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const token = this.tokens[this.pos]
    if (token.kind !== 'eof') this.pos++
    return token
  }

  private at(kind: Token['kind'], text: string): boolean {
    const token = this.peek()
    return token.kind === kind && token.text === text
  }

  private atEnd(): boolean {
    return this.peek().kind === 'eof'
  }

  /** True when only a comment or a line break is left on this line. */
  private atLineEnd(): boolean {
    const kind = this.peek().kind
    return kind === 'newline' || kind === 'comment' || kind === 'eof'
  }

  /** Where the current line's content stops, ignoring any trailing comment. */
  private lineEndOffset(): number {
    for (let i = this.pos; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (token.kind === 'newline' || token.kind === 'comment' || token.kind === 'eof') {
        return token.range.start
      }
    }
    return this.source.length
  }

  /** Recovery: drop whatever is left of the line, including the line break. */
  private skipLine(): void {
    while (!this.atEnd() && this.peek().kind !== 'newline') this.next()
    if (this.peek().kind === 'newline') this.next()
  }

  private skipTrivia(): void {
    while (this.peek().kind === 'newline' || this.peek().kind === 'comment') this.next()
  }
}

function endpointKey(endpoint: Endpoint): string {
  return endpoint.field ? `${endpoint.node}.${endpoint.field}` : endpoint.node
}

/** Tokens print inside quotes; end-of-input has no text to print. */
function quote(token: Token): string {
  if (token.kind === 'eof') return 'the end of the file'
  if (token.kind === 'newline') return 'the end of the line'
  return `'${token.text}'`
}

export function parse(source: string, type: DiagramType): ParseResult {
  return new Parser(source, type).parse()
}
