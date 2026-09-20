/**
 * Editor features, picked one by one.
 *
 * `editor.api` is only the editing core: without these imports there is no
 * suggest widget, no hover, no find. The usual shortcut is to import
 * `editor.main`, but that also registers ninety languages we will never open —
 * so this file lists what Drawrix actually uses, and nothing else.
 *
 * Side-effect imports only: each module registers itself with Monaco.
 */
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js'
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js'
