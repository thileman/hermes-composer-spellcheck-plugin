// Evaluate the plugin's REAL code-span/file-name pattern (read from the
// source, not re-derived) and check what it matches.
const fs = require('fs')
const path = require('path')

// Resolve the plugin and its deps relative to THIS file, so the suite runs
// from any checkout root with no arguments.
const PLUGIN = path.join(__dirname, '..', 'desktop', 'plugin.js')

function resolveDep(name) {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', name),
    path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'node_modules', name)
  ]

  for (const c of candidates) {
    try {
      require.resolve(c)
      return c
    } catch {
      /* try the next one */
    }
  }

  return name
}


const source = fs.readFileSync(PLUGIN, 'utf8')

// Rebuild CODE_SPLIT_RE exactly as the source does, then verify the
// reconstructed source equals what the file actually contains.
const expected = `new RegExp(
  '(\`[^\`\\\\n]+\`|(?:[A-Za-z]:)?(?:[\\\\w.-]+[\\\\\\\\/])+[\\\\w.-]+|\\\\b[\\\\w-]+\\\\.' + FILE_EXT_RE + '\\\\b)',
  'g'
)`

if (!source.includes(expected)) {
  console.log('!! the reconstruction does not match the file — check the source')
}

// Evaluate the ACTUAL constants out of the file, so this test can never
// drift from the plugin.
const extSrc = source.match(/const FILE_EXT_RE = '([^']*)'/)
if (!extSrc) throw new Error('FILE_EXT_RE not found')
const FILE_EXT_RE = extSrc[1]

// The pattern is built from a JS string literal in the source; take the
// whole `new RegExp(...)` call and evaluate it with FILE_EXT_RE in scope.
const callSrc = source.match(/const CODE_SPLIT_RE = new RegExp\(([\s\S]*?)\n\)/)
if (!callSrc) throw new Error('CODE_SPLIT_RE not found')
const CODE_SPLIT_RE = new Function('FILE_EXT_RE', 'return new RegExp(' + callSrc[1] + ')')(FILE_EXT_RE)

const cases = [
  ['run `npm test` now', true],
  ['open src/app.ts please', true],
  ['see C:/Users/foo/bar.txt', true],
  ['edit ./relative/path/file.py', true],
  ['the config.json file', true],
  ['e.g. this is fine', false],
  ['i.e. that is fine', false],
  ['etc. and so on', false],
  ['hello world', false],
  ['call foo() then bar()', false],
  ['Mr. Smith arrived', false],
  ['version 1.2.3 shipped', false],
  ['a.b.c notation', false],
  ['the e.g. case', false],
  ['see file.ts now', true],
  ['a single .c file', false]
]

let fails = 0
for (const [text, should] of cases) {
  CODE_SPLIT_RE.lastIndex = 0
  const hits = CODE_SPLIT_RE.exec(text)
  const got = !!hits
  const ok = got === should
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(text).padEnd(40)} matched=${hits ? JSON.stringify(hits[1]) : '[]'}`)
}

console.log(`\nfailures: ${fails}`)
process.exit(fails ? 1 : 0)
