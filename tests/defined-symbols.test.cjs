// Every function the plugin CALLS must also be DEFINED.
//
// Three separate helpers were lost during large edits -- clearInjected,
// wordAtCaret and isKnown -- and every one of them broke a feature at
// RUNTIME while the file still parsed and the other tests still passed.
// A missing function is invisible to `node --check`: a call to an
// undefined name is a runtime ReferenceError, not a syntax error.
//
// This suite compares the CURRENT file against the commit that introduced
// the plugin (1731454). Any function that existed then, is called now, and
// is not defined now, is a bug.
//
// The earlier hand-rolled scan MISSED isKnown because its filter list
// contained a name that shadowed the real one. The filter is now derived
// from the file's own imports, so it cannot shadow a local definition.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const PLUGIN = process.env.SC_PLUGIN || path.join(ROOT, 'desktop', 'plugin.js')
const BASE_COMMIT = '1731454'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

const source = fs.readFileSync(PLUGIN, 'utf8')

function originalSource() {
  try {
    return execFileSync('git', ['show', `${BASE_COMMIT}:desktop/plugin.js`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

// Strip strings, template literals, regexes and comments so the scan sees
// only CODE. A chain of regex replacements cannot do this -- stripping
// strings before comments turns the apostrophe in "the app's own menu" into
// a string delimiter that swallows hundreds of lines of real code, and
// reports functions that are plainly defined as missing. The scanner walks
// the source once and preserves length.
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

function scrub(text) {
  return stripLiteralsAndComments(text)
}

const FUNCTION_DEF = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
const ARROW_DEF = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*\([^)]*\)|\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g

function definitions(text) {
  const out = new Set()
  const body = scrub(text)
  for (const m of body.matchAll(FUNCTION_DEF)) {
    out.add(m[1])
  }
  for (const m of body.matchAll(ARROW_DEF)) {
    out.add(m[1])
  }
  return out
}

// Names bound by an import are provided by the module, not the file.
function importedNames(text) {
  const out = new Set()
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) out.add(name.trim())
    }
  }
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) {
    out.add(m[1])
  }
  return out
}

const CALL = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g

function calls(text) {
  const out = new Set()
  const body = scrub(text)
  for (const m of body.matchAll(CALL)) {
    out.add(m[1])
  }
  return out
}

// Names the language provides. Derived from a list of globals rather than
// guessed, so it cannot shadow a plugin function.
const JS_GLOBALS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await', 'new', 'class',
  'super', 'import', 'export', 'do', 'else', 'try', 'throw', 'delete', 'void', 'yield', 'async',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone', 'fetch', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'TextEncoder', 'TextDecoder',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'Proxy', 'Reflect', 'WeakRef',
  'FinalizationRegistry', 'queueMicrotask', 'Intl', 'Node', 'Element', 'HTMLElement', 'Document',
  'Window', 'navigator', 'console', 'globalThis', 'arguments', 'undefined', 'NaN', 'Infinity',
  'escape', 'unescape', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'atob', 'btoa', 'eval', 'Function', 'WeakRef', 'AggregateError', 'SuppressedError',
])

console.log('=== the plugin parses as an ES module ===')
{
  const tmp = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'spellcheck-esm-check.mjs')
  fs.writeFileSync(tmp, source)
  let ok = true
  let detail = ''
  try {
    execFileSync(process.execPath, ['--check', tmp], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    ok = false
    detail = String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')
  }
  check('parses as ESM', ok, true)
  if (!ok) console.log('      ' + detail)
}

console.log('\n=== every called function is defined ===')
const original = originalSource()

if (!original) {
  console.log('  SKIP  could not read ' + BASE_COMMIT + ' (shallow clone?) -- definitions check needs history')
} else {
  const nowDefs = definitions(source)
  const origDefs = definitions(original)
  const imports = importedNames(source)
  const nowCalls = calls(source)

  // A name is available if it is defined here, imported here, or a JS global.
  const available = new Set([...nowDefs, ...imports, ...JS_GLOBALS])

  // Every function that the ORIGINAL defined and that is still CALLED must
  // still be defined. This is the check that caught clearInjected,
  // wordAtCaret and isKnown.
  const candidates = [...nowCalls].filter((n) => origDefs.has(n))
  const missing = candidates.filter((n) => !available.has(n)).sort()

  check('no called function lost from the original commit', missing, [])
  if (missing.length) {
    for (const n of missing) console.log('      MISSING: ' + n)
  }

  // The three that were actually lost, named explicitly so a regression
  // cannot hide behind a rename.
  for (const name of ['clearInjected', 'wordAtCaret', 'isKnown']) {
    check('"' + name + '" is defined', nowDefs.has(name), true)
  }

  // The imports the SDK provides must still be imported the same way, or
  // the file parses but the plugin gets undefined values at runtime.
  const sdkNow = importedNames(source)
  check('"pluginSettingsHref" is imported from the SDK', sdkNow.has('pluginSettingsHref'), true)
  check('"host" is imported from the SDK', sdkNow.has('host'), true)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
