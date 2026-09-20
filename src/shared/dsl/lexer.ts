/**
 * Tokenizer for the Drawrix DSL.
 *
 * The language is line-oriented — there are no statement terminators — so
 * newlines are real tokens rather than whitespace. Every token keeps both its
 * offsets and its 1-based line/column so the parser can build ranges without
 * ever re-scanning the source.
 *
 * Nothing here throws. An unrecognised character becomes an `unknown` token
 * and the parser reports it; a half-typed file must still produce a diagram.
 */
import type { Range } from './ast'

export type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'op'
  | 'punct'
  | 'comment'
  | 'newline'
  | 'unknown'
  | 'eof'

export interface Token {
  kind: TokenKind
  /** Source text, with the quotes stripped for `string`. */
  text: string
  range: Range
}

const PUNCTUATION = new Set(['{', '}', '.', ':', '(', ')', ','])

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  let line = 1
  let column = 1

  /** Consume `count` characters, keeping the line/column cursor honest. */
  function advance(count: number): void {
    for (let i = 0; i < count; i++) {
      if (source[offset] === '\n') {
        line++
        column = 1
      } else {
        column++
      }
      offset++
    }
  }

  function push(kind: TokenKind, length: number, text?: string): void {
    const start = offset
    const startLine = line
    const startColumn = column
    const raw = source.slice(start, start + length)
    advance(length)
    tokens.push({
      kind,
      text: text ?? raw,
      range: {
        start,
        end: offset,
        startLine,
        startColumn,
        endLine: line,
        endColumn: column
      }
    })
  }

  while (offset < source.length) {
    const ch = source[offset]

    // Carriage returns are invisible structure; a lone \r still ends a line
    // only when a \n follows, which the newline branch handles.
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      advance(1)
      continue
    }

    if (ch === '\n') {
      push('newline', 1)
      continue
    }

    if (ch === '/' && source[offset + 1] === '/') {
      let end = offset
      while (end < source.length && source[end] !== '\n') end++
      push('comment', end - offset)
      continue
    }

    if (ch === '"') {
      let end = offset + 1
      while (end < source.length && source[end] !== '"' && source[end] !== '\n') end++
      const closed = source[end] === '"'
      const length = closed ? end - offset + 1 : end - offset
      push('string', length, source.slice(offset + 1, end))
      continue
    }

    if (isIdentStart(ch)) {
      let end = offset
      while (end < source.length && isIdentPart(source[end])) end++
      push('ident', end - offset)
      continue
    }

    if (isDigit(ch)) {
      let end = offset
      while (end < source.length && (isDigit(source[end]) || source[end] === '.')) end++
      push('number', end - offset)
      continue
    }

    if (ch === '<' && source[offset + 1] === '>') {
      push('op', 2)
      continue
    }

    if (ch === '>' || ch === '<' || ch === '-') {
      push('op', 1)
      continue
    }

    if (PUNCTUATION.has(ch)) {
      push('punct', 1)
      continue
    }

    push('unknown', 1)
  }

  tokens.push({
    kind: 'eof',
    text: '',
    range: {
      start: offset,
      end: offset,
      startLine: line,
      startColumn: column,
      endLine: line,
      endColumn: column
    }
  })

  return tokens
}

/** A range covering both ends, for spanning a whole statement. */
export function spanRange(from: Range, to: Range): Range {
  return {
    start: from.start,
    end: to.end,
    startLine: from.startLine,
    startColumn: from.startColumn,
    endLine: to.endLine,
    endColumn: to.endColumn
  }
}
