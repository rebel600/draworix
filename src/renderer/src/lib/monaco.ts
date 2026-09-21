/**
 * The Drawrix language, taught to Monaco.
 *
 * Highlighting is a Monarch grammar (fast, regex-based, runs on every
 * keystroke). Everything that needs real structure — completions, hovers,
 * diagnostics — goes through the shared parser instead, so the editor and the
 * canvas can never disagree about what the source says.
 *
 * Importing `editor.api` rather than `editor.main` keeps the ninety bundled
 * languages out: we ship one language and it is ours. The editor features we
 * do want are listed in monaco-contrib.
 */
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import './monaco-contrib'
import {
  EDGE_OPERATORS,
  FIELD_MODIFIERS,
  FIELD_TYPES,
  parse,
  type Diagnostic,
  type DiagramNode,
  type Range as SourceRange,
  type TextEdit
} from '@shared/dsl'
import type { DiagramType } from '@shared/types'

export const LANGUAGE_ID = 'drawrix'
export const THEME_ID = 'drawrix-dark'
/** Marker owner, so setModelMarkers only ever clears our own diagnostics. */
const MARKER_OWNER = 'drawrix'

/**
 * Monaco spins up one worker for editor-side services. We register only the
 * base worker — no TypeScript, JSON or CSS services are loaded.
 */
globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

/** Which diagram type each model holds, so providers can parse it correctly. */
const modelTypes = new WeakMap<monaco.editor.ITextModel, DiagramType>()
/** The document path behind each model, kept verbatim rather than re-parsed
 *  out of the uri — Windows paths do not survive a round trip through one. */
const modelPaths = new WeakMap<monaco.editor.ITextModel, string>()

let registered = false

export function setupMonaco(): typeof monaco {
  if (registered) return monaco
  registered = true

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.dgm'], aliases: ['Drawrix'] })
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration)
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, monarch)
  monaco.editor.defineTheme(THEME_ID, theme)
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, completions)
  monaco.languages.registerHoverProvider(LANGUAGE_ID, hovers)

  return monaco
}

/** Get (or create) the model backing one document path. */
export function getModel(
  path: string,
  source: string,
  type: DiagramType
): monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(`drawrix:///${encodeURIComponent(path)}`)
  const existing = monaco.editor.getModel(uri)
  const model = existing ?? monaco.editor.createModel(source, LANGUAGE_ID, uri)
  modelTypes.set(model, type)
  modelPaths.set(model, path)
  return model
}

/** The document path a model was created for. */
export function pathOfModel(model: monaco.editor.ITextModel): string {
  return modelPaths.get(model) ?? ''
}

/** Drop models for documents that are no longer open in a tab. */
export function disposeModelsExcept(keepPaths: readonly string[]): void {
  const keep = new Set(keepPaths)
  for (const model of monaco.editor.getModels()) {
    if (!keep.has(pathOfModel(model))) model.dispose()
  }
}

/**
 * The editor currently on screen. The canvas needs it to move the caret and to
 * push its own edits through the same undo stack the keyboard uses.
 */
let editor: monaco.editor.IStandaloneCodeEditor | null = null

export function setEditor(instance: monaco.editor.IStandaloneCodeEditor | null): void {
  editor = instance
}

function modelFor(path: string): monaco.editor.ITextModel | null {
  const model = editor?.getModel()
  return model && pathOfModel(model) === path ? model : null
}

/** The model's version id, which changes with every edit to the text. */
export function textVersion(path: string): number {
  return modelFor(path)?.getAlternativeVersionId() ?? 0
}

/**
 * Apply a canvas action to the document as text.
 *
 * The edits go through the model, not the store, so they join the editor's
 * undo stack: one stack element per action, undone by the same Ctrl+Z that
 * undoes typing.
 *
 * `expected` is the source the edits were computed against. Offsets only mean
 * anything against the text they were measured from, so if the document has
 * moved on since — a second commit of the same rename, an autosave racing a
 * keystroke — the edits are dropped rather than applied to the wrong spans.
 */
export type EditOutcome = 'applied' | 'stale' | 'no-editor'

export function applyTextEdits(
  path: string,
  edits: readonly TextEdit[],
  expected: string
): EditOutcome {
  const model = modelFor(path)
  if (!model) return 'no-editor'
  if (edits.length === 0) return 'applied'
  if (model.getValue() !== expected) return 'stale'

  model.pushStackElement()
  model.pushEditOperations(
    [],
    edits.map((edit) => ({
      range: monaco.Range.fromPositions(
        model.getPositionAt(edit.start),
        model.getPositionAt(edit.end)
      ),
      text: edit.text
    })),
    () => null
  )
  model.pushStackElement()
  return 'applied'
}

export function undoText(path: string): void {
  if (modelFor(path)) editor?.trigger('drawrix', 'undo', null)
}

export function redoText(path: string): void {
  if (modelFor(path)) editor?.trigger('drawrix', 'redo', null)
}

/**
 * True when the last caret move was ours rather than the author's.
 *
 * Revealing a range moves the caret, which would otherwise bounce straight
 * back as a fresh selection and overwrite the one the canvas just made.
 */
let programmatic = false

export function consumeProgrammaticCaret(): boolean {
  const was = programmatic
  programmatic = false
  return was
}

/** Put the caret on a range and bring it into view, without stealing focus. */
export function revealRange(path: string, range: SourceRange): void {
  const model = modelFor(path)
  if (!model || !editor) return
  const target = new monaco.Range(
    range.startLine,
    range.startColumn,
    range.endLine,
    range.endColumn
  )
  programmatic = true
  editor.setSelection(target)
  editor.revealRangeInCenterIfOutsideViewport(target, monaco.editor.ScrollType.Smooth)
}

export function showDiagnostics(
  model: monaco.editor.ITextModel,
  diagnostics: readonly Diagnostic[]
): void {
  monaco.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    diagnostics.map((d) => ({
      message: d.message,
      code: d.code,
      severity:
        d.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      startLineNumber: d.range.startLine,
      startColumn: d.range.startColumn,
      endLineNumber: d.range.endLine,
      endColumn: d.range.endColumn
    }))
  )
}

// ------------------------------------------------------------------ language

const languageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '//' },
  brackets: [
    ['{', '}'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '(', close: ')' },
    { open: '"', close: '"' }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '(', close: ')' },
    { open: '"', close: '"' }
  ],
  indentationRules: {
    increaseIndentPattern: /\{\s*$/,
    decreaseIndentPattern: /^\s*\}/
  }
}

const monarch: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  modifiers: [...FIELD_MODIFIERS],
  types: [...FIELD_TYPES],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/"[^"]*"?/, 'string'],
      // A name with a block after it is the thing being declared.
      [/[a-zA-Z_]\w*(?=\s*\{)/, 'entity'],
      // The left side of a dotted reference: `orders`.user_id
      [/[a-zA-Z_]\w*(?=\.)/, 'entity'],
      [
        /[a-zA-Z_]\w*/,
        { cases: { '@modifiers': 'keyword', '@types': 'type', '@default': 'identifier' } }
      ],
      [/\d[\d.]*/, 'number'],
      [/<>|[<>-]/, 'operator'],
      [/[{}]/, '@brackets'],
      [/[.:,()]/, 'delimiter']
    ]
  }
}

const theme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'e6eaf2' },
    { token: 'comment', foreground: '5a6478', fontStyle: 'italic' },
    { token: 'entity', foreground: '7ba3ff', fontStyle: 'bold' },
    { token: 'type', foreground: '6fd3c7' },
    { token: 'keyword', foreground: 'e2b04a' },
    { token: 'identifier', foreground: 'e6eaf2' },
    { token: 'operator', foreground: 'b9c1d0' },
    { token: 'delimiter', foreground: '7b8598' },
    { token: 'number', foreground: 'c792ea' },
    { token: 'string', foreground: '9ece6a' }
  ],
  colors: {
    'editor.background': '#11141c',
    'editor.foreground': '#e6eaf2',
    'editor.lineHighlightBackground': '#171b26',
    'editor.selectionBackground': '#2a3140',
    'editorCursor.foreground': '#5b8cff',
    'editorLineNumber.foreground': '#3a4356',
    'editorLineNumber.activeForeground': '#7b8598',
    'editorWidget.background': '#171b26',
    'editorWidget.border': '#2a3140',
    'editorSuggestWidget.background': '#171b26',
    'editorSuggestWidget.border': '#2a3140',
    'editorSuggestWidget.selectedBackground': '#2a3140',
    'editorHoverWidget.background': '#171b26',
    'editorHoverWidget.border': '#2a3140',
    'editorIndentGuide.background1': '#1e2431',
    'editorIndentGuide.activeBackground1': '#3a4356'
  }
}

// ------------------------------------------------------------------ providers

/** Parse whatever is in the model right now. Cheap enough to do per request. */
function parseModel(model: monaco.editor.ITextModel): ReturnType<typeof parse> {
  return parse(model.getValue(), modelTypes.get(model) ?? 'erd')
}

const completions: monaco.languages.CompletionItemProvider = {
  triggerCharacters: ['.', ' ', '>', '<', '-'],
  provideCompletionItems(model, position) {
    const { diagram } = parseModel(model)
    const word = model.getWordUntilPosition(position)
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn
    }
    const before = model
      .getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })
      .replace(/\/\/.*$/, '')

    const names = (kind: monaco.languages.CompletionItemKind): monaco.languages.CompletionItem[] =>
      diagram.nodes.map((node) => ({
        label: node.name,
        kind,
        detail: describe(node),
        insertText: node.name,
        range
      }))

    // After `orders.` — the columns of that table, nothing else.
    const dotted = /([A-Za-z_]\w*)\.\w*$/.exec(before)
    if (dotted) {
      const table = diagram.nodes.find((n) => n.name === dotted[1])
      return {
        suggestions: (table?.fields ?? []).map((field) => ({
          label: field.name,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: [field.type, ...field.modifiers].filter(Boolean).join(' '),
          insertText: field.name,
          range
        }))
      }
    }

    // Just after a relationship operator — the other end can only be a name.
    if (/(<>|[<>-])\s*\w*$/.test(before)) {
      return { suggestions: names(monaco.languages.CompletionItemKind.Reference) }
    }

    const indented = /^\s+/.test(before)
    const wordsBefore = before.trim().split(/\s+/).filter(Boolean).length

    if (diagram.type === 'erd' && indented) {
      // Second word on a column line is its type, anything after is a modifier.
      const first = wordsBefore <= 1 || (wordsBefore === 2 && word.word.length > 0)
      return {
        suggestions: first
          ? FIELD_TYPES.map((type) => ({
              label: type,
              kind: monaco.languages.CompletionItemKind.TypeParameter,
              insertText: type,
              range
            }))
          : FIELD_MODIFIERS.map((modifier) => ({
              label: modifier,
              kind: monaco.languages.CompletionItemKind.Keyword,
              detail: MODIFIER_HELP[modifier],
              insertText: modifier,
              range
            }))
      }
    }

    const suggestions = names(monaco.languages.CompletionItemKind.Class)
    if (wordsBefore <= 1) {
      suggestions.push(...operatorSuggestions(range))
    }
    return { suggestions }
  }
}

const MODIFIER_HELP: Record<string, string> = {
  pk: 'primary key',
  fk: 'foreign key',
  unique: 'unique constraint',
  index: 'indexed',
  null: 'nullable',
  notnull: 'required'
}

const EDGE_HELP: Record<string, string> = {
  'many-to-one': 'many to one',
  'one-to-many': 'one to many',
  'one-to-one': 'one to one',
  'many-to-many': 'many to many'
}

function operatorSuggestions(range: monaco.IRange): monaco.languages.CompletionItem[] {
  return Object.entries(EDGE_OPERATORS).map(([kind, operator]) => ({
    label: `${operator}  ${EDGE_HELP[kind]}`,
    kind: monaco.languages.CompletionItemKind.Operator,
    insertText: `${operator} `,
    filterText: operator,
    range
  }))
}

const hovers: monaco.languages.HoverProvider = {
  provideHover(model, position) {
    const word = model.getWordAtPosition(position)
    if (!word) return null
    const { diagram } = parseModel(model)
    const node = diagram.nodes.find((n) => n.name === word.word)
    if (!node) return null

    const lines = [`**${node.name}** — ${describe(node)}`]
    if (node.fields.length) {
      lines.push('', ...node.fields.map((f) => `\`${f.name}\` ${[f.type, ...f.modifiers].filter(Boolean).join(' ')}`))
    }
    const connected = diagram.edges.filter((e) => e.from.node === node.id || e.to.node === node.id)
    if (connected.length) {
      lines.push('', `${connected.length} relationship${connected.length === 1 ? '' : 's'}`)
    }

    return {
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      },
      contents: [{ value: lines.join('\n\n') }]
    }
  }
}

function describe(node: DiagramNode): string {
  if (node.implicit) return 'used in a relationship, never declared'
  if (node.kind === 'table') {
    return `table, ${node.fields.length} column${node.fields.length === 1 ? '' : 's'}`
  }
  return node.kind
}
