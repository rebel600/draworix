/**
 * Scripted UI driver for Drawrix.
 *
 * Launches the built app against a throwaway user-data dir and data root,
 * walks one real flow (workspace -> diagram -> edit -> autosave), screenshots
 * each step, and asserts what landed on disk.
 *
 * Windows has a real display, so there is no xvfb here. tmux is unavailable
 * too, which is why this is a scripted run rather than the usual REPL driver.
 *
 *   node scripts/drive.mjs            keeps the sandbox for inspection
 *   node scripts/drive.mjs --clean    removes it afterwards
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'out', 'shots')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'drawrix-drive-'))
const userDataDir = path.join(sandbox, 'userData')
const dataRoot = path.join(sandbox, 'data')

fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(SHOT_DIR, { recursive: true })
// Pre-seed settings so the run never touches the real E:\drawrix-data.
fs.writeFileSync(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify({ version: 1, dataRoot, theme: 'dark' }, null, 2)
)

let failures = 0
let step = 0

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${String(++step).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  shot ${file}`)
  return file
}

/** Poll until fn() is truthy, so we never rely on a blind sleep. */
async function until(label, fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if (await fn()) return true
    } catch {
      // Page may still be mid-navigation; keep polling.
    }
    if (Date.now() > deadline) {
      failures++
      console.error(`  FAIL timed out waiting for ${label}`)
      return false
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

/**
 * innerText is layout-aware and applies text-transform, so labels styled
 * `uppercase` come back uppercased. Compare case-insensitively.
 */
async function bodyHas(page, text) {
  return page.evaluate(
    (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    text
  )
}

/**
 * The visible text of the code pane. Monaco keeps the real buffer in a model
 * the page never exposes, so we read the rendered lines and normalise the
 * non-breaking spaces it pads them with.
 */
async function editorText(page) {
  return page.evaluate(() => {
    const lines = document.querySelector('[data-testid="source-editor"] .view-lines')
    return lines ? lines.innerText.replace(/\u00a0/g, ' ') : ''
  })
}

/**
 * Put the caret in the editor. Chromium supports the EditContext API, so
 * current Monaco has no hidden textarea to click — the rendered lines are the
 * input surface.
 */
async function focusEditor(page) {
  await page.locator('[data-testid="source-editor"] .view-lines').click()
}

/** DOM click by visible text — avoids coordinate math entirely. */
async function clickText(page, text) {
  return page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')]
    const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  }, text)
}

async function main() {
  console.log(`sandbox: ${sandbox}\n`)

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, `--user-data-dir=${userDataDir}`],
    timeout: 60_000
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Monaco loads a web worker and a theme at runtime; either failing shows up
  // here long before it shows up on screen.
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  console.log('launch')
  await until('app shell', () => page.evaluate(() => !!document.querySelector('aside')))
  check('window title is Drawrix', (await page.title()) === 'Drawrix')
  check('sidebar rendered', await page.evaluate(() => !!document.querySelector('aside')))
  check(
    'empty state shown',
    await bodyHas(page, 'No diagram open')
  )
  await shot(page, 'empty-state')

  console.log('\ncreate workspace')
  // The two "+" buttons are the workspace and diagram section headers.
  await page.evaluate(() => {
    const plus = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '+')
    plus[0]?.click()
  })
  await until('workspace prompt', () => page.evaluate(() => !!document.querySelector('input')))
  await page.locator('input').fill('Hellorix Platform')
  await shot(page, 'workspace-prompt')
  check('create enabled with a name', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create')
    return !!btn && !btn.disabled
  }))
  await clickText(page, 'Create')
  await until('workspace listed', () =>
    bodyHas(page, 'Hellorix Platform')
  )
  check('workspace folder created on disk', fs.existsSync(path.join(dataRoot, 'Hellorix-Platform')))
  check(
    'workspace.json written',
    fs.existsSync(path.join(dataRoot, 'Hellorix-Platform', 'workspace.json'))
  )
  await shot(page, 'workspace-created')

  console.log('\ncreate diagram')
  await page.evaluate(() => {
    const plus = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '+')
    plus[1]?.click()
  })
  await until('diagram prompt', () => page.evaluate(() => !!document.querySelector('input')))
  await page.locator('input').fill('Billing Schema')
  await clickText(page, 'Create')

  await until('editor opened', () =>
    page.evaluate(() => !!document.querySelector('[data-testid="source-editor"] .view-lines'))
  )
  const docPath = path.join(dataRoot, 'Hellorix-Platform', 'Billing-Schema.dgm')
  check('document file created', fs.existsSync(docPath))
  check(
    'starter DSL loaded into the editor',
    (await editorText(page)).includes('orders.user_id > users.id')
  )
  check(
    'source is syntax highlighted',
    // Monaco paints each token class as mtk<n>; more than one class in play
    // means the grammar actually ran, rather than everything falling back to
    // the default colour.
    await page.evaluate(() => {
      const spans = document.querySelectorAll('[data-testid="source-editor"] .view-lines span[class^="mtk"]')
      return new Set([...spans].map((s) => s.className)).size > 1
    })
  )
  check('canvas counted the starter tables', await bodyHas(page, '2 tables'))
  check('canvas counted the relationship', await bodyHas(page, '1 link'))
  check('canvas listed a parsed column', await bodyHas(page, 'created_at'))
  check(
    'both tables were drawn',
    await until('nodes on the canvas', () =>
      page.evaluate(() => document.querySelectorAll('.react-flow__node').length === 2)
    )
  )
  check(
    'the relationship was drawn',
    await page.evaluate(() => !!document.querySelector('.react-flow__edge-path'))
  )
  // Nodes mount at the origin and stay hidden until elk answers, so this is a
  // poll rather than a snap judgement.
  check(
    'auto layout separated the tables',
    await until('elk to place the tables', () =>
      page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.react-flow__node')].map((n) =>
          n.getBoundingClientRect()
        )
        return (
          boxes.length === 2 && (boxes[0].right < boxes[1].left || boxes[1].right < boxes[0].left)
        )
      })
    )
  )
  check('starter schema parses without complaint', !(await bodyHas(page, 'warning')))
  check('tab shows the title', await bodyHas(page, 'Billing Schema'))
  await shot(page, 'diagram-open')

  // Hovering a name asks the parser what it knows about that table.
  await page
    .locator('[data-testid="source-editor"] .view-lines span')
    .filter({ hasText: /^users$/ })
    .first()
    .hover()
  check(
    'hovering a table explains it',
    await until('hover widget', () =>
      page.evaluate(() => document.querySelector('.monaco-hover')?.innerText.includes('4 columns'))
    )
  )
  await shot(page, 'hover')
  await page.mouse.move(0, 0)

  console.log('\nedit and autosave')
  await focusEditor(page)
  await page.keyboard.press('Control+End')
  // No closing brace typed: the language configuration should supply it.
  await page.keyboard.type('\ninvoices {\n  id string pk', { delay: 10 })
  check('typing a block auto-closed it', (await editorText(page)).includes('}'))

  check(
    'dirty state shown while typing',
    await bodyHas(page, 'Unsaved')
  )
  await shot(page, 'editing-dirty')

  // Autosave debounce is 800ms; give it room, then confirm the file changed.
  const saved = await until(
    'autosave to reach disk',
    () => fs.readFileSync(docPath, 'utf8').includes('invoices'),
    10_000
  )
  check('autosave persisted the edit', saved)
  check(
    'status returned to Saved',
    await until('saved status', () =>
      bodyHas(page, 'Saved')
    )
  )
  check('canvas recounted tables after the edit', await bodyHas(page, '3 tables'))
  check(
    'spaces reached the editor',
    (await editorText(page)).includes('id string pk'),
    'the canvas must not claim the space key'
  )

  const onDisk = JSON.parse(fs.readFileSync(docPath, 'utf8'))
  check('source persisted', typeof onDisk.source === 'string' && onDisk.source.includes('invoices'))
  check('layout stayed empty (no canvas drags yet)', Object.keys(onDisk.layout).length === 0)
  check('envelope version stamped', onDisk.version === 1)
  check(
    'history snapshot written',
    fs.existsSync(path.join(dataRoot, 'Hellorix-Platform', '.history')) &&
      fs.readdirSync(path.join(dataRoot, 'Hellorix-Platform', '.history')).length > 0
  )
  await shot(page, 'saved')

  console.log('\ndragging a node')
  const layoutOf = () => JSON.parse(fs.readFileSync(docPath, 'utf8')).layout
  const usersNode = page.locator('.react-flow__node[data-id="users"]')
  const box = await usersNode.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 140, { steps: 12 })
  await page.mouse.up()

  check(
    'the drag reached the document',
    await until('a saved position', () => Boolean(layoutOf().users), 10_000)
  )
  const moved = layoutOf().users
  check(
    'the position is a real point',
    typeof moved?.x === 'number' && typeof moved?.y === 'number',
    JSON.stringify(moved)
  )
  check(
    'only the dragged node was recorded',
    Object.keys(layoutOf()).length === 1,
    Object.keys(layoutOf()).join(',')
  )
  check(
    'the source was left alone',
    JSON.parse(fs.readFileSync(docPath, 'utf8')).source.includes('orders.user_id > users.id')
  )
  await shot(page, 'dragged')

  check('a hand-placed node offers auto layout', await bodyHas(page, 'Auto layout'))
  await clickText(page, 'Auto layout')
  check(
    'auto layout hands the positions back to elk',
    await until('an empty layout', () => Object.keys(layoutOf()).length === 0, 10_000)
  )
  await shot(page, 'auto-layout')

  console.log('\nreopen after close')
  // Target the tab's own close button. A bare '×' text match also hits the
  // sidebar's delete button, which deleted the document on an earlier run.
  await page.evaluate(() => document.querySelector('[data-testid="tab-close"]')?.click())
  await until('tab closed', () =>
    bodyHas(page, 'No diagram open')
  )
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Billing Schema')
    )
    el?.click()
  })
  await until('reopened', () =>
    page.evaluate(() => !!document.querySelector('[data-testid="source-editor"] .view-lines'))
  )
  check('edit survived the round trip', (await editorText(page)).includes('invoices'))
  await shot(page, 'reopened')

  console.log('\ndelete guard')
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.startsWith('Delete ')
    )
    el?.click()
  })
  check('delete asks for confirmation', await bodyHas(page, 'Delete diagram?'))
  check('confirmation names the recycle bin', await bodyHas(page, 'Recycle Bin'))
  await shot(page, 'delete-confirm')
  await clickText(page, 'Cancel')
  check('cancelling keeps the file', fs.existsSync(docPath))
  check(
    'cancelling keeps the sidebar entry',
    await bodyHas(page, 'Billing Schema')
  )

  console.log('\nlanguage services')
  await focusEditor(page)
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\norders.user_id > ghosts.id', { delay: 10 })
  check(
    'a relationship to an unknown table is reported',
    await until('warning count', () => bodyHas(page, '1 warning'))
  )
  check(
    'the offending span is underlined',
    await page.evaluate(() => !!document.querySelector('.squiggly-warning'))
  )
  await shot(page, 'diagnostics')

  await page.keyboard.press('Enter')
  await page.keyboard.type('us', { delay: 10 })
  await page.keyboard.press('Control+Space')
  check(
    'completion offers the tables in this document',
    await until('suggest widget', () =>
      page.evaluate(() => {
        const widget = document.querySelector('.suggest-widget')
        return !!widget && widget.classList.contains('visible') && widget.innerText.includes('users')
      })
    )
  )
  await shot(page, 'completions')
  await page.keyboard.press('Escape')

  console.log('\ntwo-way editing')
  const sourceOnDisk = () => JSON.parse(fs.readFileSync(docPath, 'utf8')).source
  const nodeAt = (id) => page.locator(`.react-flow__node[data-id="${id}"]`)
  const isSelected = (id) =>
    page.evaluate(
      (nodeId) =>
        document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)?.classList.contains('selected') ??
        false,
      id
    )

  // Editor to canvas: put the caret in a declaration, the node lights up.
  await page
    .locator('[data-testid="source-editor"] .view-lines span')
    .filter({ hasText: /^orders$/ })
    .first()
    .click()
  check('the caret selects the node it sits in', await until('orders selected', () => isSelected('orders')))

  // Canvas to editor: click a node, the editor goes to its declaration.
  await nodeAt('users').click()
  check(
    'clicking a node takes the caret to its declaration',
    // `users {` is line 2 of the starter schema, and Monaco marks the line the
    // caret is on in the gutter.
    await until('the caret to move', () =>
      page.evaluate(() => document.querySelector('.active-line-number')?.textContent?.trim() === '2')
    )
  )
  check('and the node itself is selected', await isSelected('users'))
  await shot(page, 'selection-synced')

  // F2 opens the same field the pencil does.
  await page.keyboard.press('F2')
  check(
    'F2 renames the selected node',
    await until('the rename field', () =>
      page.evaluate(() => !!document.querySelector('[data-testid="rename-field"]'))
    )
  )
  await page.keyboard.press('Escape')

  // Rename on the canvas, rewritten in the source.
  await nodeAt('users').hover()
  await page.locator('[aria-label="Rename users"]').click()
  await until('the rename field', () =>
    page.evaluate(() => !!document.querySelector('[data-testid="rename-field"]'))
  )
  await page.keyboard.type('people', { delay: 20 })
  await page.keyboard.press('Enter')

  check(
    'renaming a node rewrites its declaration',
    await until('the rename to reach disk', () => sourceOnDisk().includes('people {'), 10_000)
  )
  check('and every reference to it', sourceOnDisk().includes('> people.id'))
  check('and nothing else', sourceOnDisk().includes('orders {'))
  check('the canvas shows the new name', await bodyHas(page, 'people'))
  await shot(page, 'renamed')

  // One undo stack: Ctrl+Z on the canvas undoes what the canvas did.
  await nodeAt('orders').click()
  await page.keyboard.press('Control+z')
  check(
    'undo on the canvas takes the rename back',
    await until('the undo to reach disk', () => sourceOnDisk().includes('users {'), 10_000)
  )
  check('including the references', sourceOnDisk().includes('> users.id'))

  // Draw a relationship by dragging between two nodes.
  const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const from = centre(await nodeAt('invoices').locator('.react-flow__handle.source').boundingBox())
  const to = centre(await nodeAt('orders').locator('.react-flow__handle.target').boundingBox())
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
  check(
    'dragging between two nodes writes a relationship',
    await until('the new relationship', () => sourceOnDisk().includes('invoices > orders'), 10_000)
  )
  await shot(page, 'connected')

  // Delete a node from the canvas, and take it back.
  await nodeAt('invoices').click()
  await page.keyboard.press('Delete')
  check(
    'deleting a node removes its block',
    await until('the delete to reach disk', () => !sourceOnDisk().includes('invoices {'), 10_000)
  )
  check('and the relationships it was in', !sourceOnDisk().includes('invoices > orders'))
  check('and leaves the rest of the document parsing', !(await bodyHas(page, 'error')))
  await shot(page, 'deleted')

  await page.locator('.react-flow__pane').click()
  await page.keyboard.press('Control+z')
  check(
    'undo brings the deleted node back',
    await until('the undo to reach disk', () => sourceOnDisk().includes('invoices {'), 10_000)
  )

  // Dragging is on the same stack, ahead of the text.
  const before = await nodeAt('orders').boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + 12)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 80, before.y + 120, { steps: 12 })
  await page.mouse.up()
  check(
    'the drag was recorded',
    await until('a saved position', () => Boolean(layoutOf().orders), 10_000)
  )
  await page.keyboard.press('Control+z')
  check(
    'undo on the canvas takes the drag back before the text',
    await until('the position to be dropped', () => !layoutOf().orders, 10_000)
  )
  check('and leaves the source untouched', sourceOnDisk().includes('invoices {'))

  console.log('\narchitecture diagram')
  await page.evaluate(() => {
    const plus = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '+')
    plus[1]?.click()
  })
  await until('diagram prompt', () => page.evaluate(() => !!document.querySelector('input')))
  await page.locator('input').fill('Platform')
  await clickText(page, 'Architecture')
  await shot(page, 'new-diagram-kind')
  await clickText(page, 'Create')

  check(
    'the group and its three services were drawn',
    await until('the arch canvas', () =>
      page.evaluate(() => document.querySelectorAll('.react-flow__node').length === 4)
    )
  )
  // Before elk answers, every node sits at the origin and a member is trivially
  // "inside" its group, so this waits for the members to be spread out too.
  check(
    'members are laid out inside the group box',
    await until('nesting', () =>
      page.evaluate(() => {
        const box = (id) =>
          document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
        const [group, alb, api] = ['vpc', 'alb', 'api'].map(box)
        if (!group || !alb || !api) return false
        const inside =
          api.left >= group.left &&
          api.right <= group.right &&
          api.top >= group.top &&
          api.bottom <= group.bottom
        return inside && alb.right <= api.left
      })
    )
  )
  check(
    'the architecture document records its kind',
    JSON.parse(
      fs.readFileSync(path.join(dataRoot, 'Hellorix-Platform', 'Platform.dgm'), 'utf8')
    ).type === 'arch'
  )
  await shot(page, 'architecture')

  check('nothing threw in the renderer', consoleErrors.length === 0, consoleErrors.join(' | '))

  const errors = await page.evaluate(() =>
    document.body.innerText.includes('Error') || document.body.innerText.includes('failed')
  )
  check('no error banner surfaced', !errors)

  await app.close()

  if (process.argv.includes('--clean')) {
    fs.rmSync(sandbox, { recursive: true, force: true })
  } else {
    console.log(`\nsandbox kept at ${sandbox}`)
  }

  console.log(failures === 0 ? '\nall UI checks passed\n' : `\n${failures} UI check(s) failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('driver crashed:', err)
  process.exit(1)
})
