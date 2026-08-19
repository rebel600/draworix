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

let failures = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}`)
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

  await fs.rm(root, { recursive: true, force: true })

  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
