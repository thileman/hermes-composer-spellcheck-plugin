// Test the dictionary's CASE handling.
//
// Upstream SCOWL spells proper nouns with an initial capital and marks them
// with the M flag ("may only be capitalized"):
//
//     Hermes/M
//
// Two things follow from that, and both used to be broken:
//
//   1. "Hermes" is a word; "hermes" (lowercase) is NOT — Chromium underlines
//      it, correctly.
//   2. "hermes" must not be suggested as a correction, because applying it
//      would leave the word underlined.
//
// The plugin lowercased every stem while parsing, which threw the case away:
// "Hermes/M" became "hermes", and the bare stem was added to the word set
// unconditionally. So the plugin believed lowercase "hermes" was correct,
// suggested it, and the user was left with a red squiggle under the
// suggestion they had just accepted.
//
// This suite evaluates the REAL plugin and reaches into its dictionary
// machinery — it does not re-implement any of it.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

// --- the same stubs the other suites use ---------------------------------
const fakeElement = () => ({
  dataset: {}, spellcheck: false, style: { cssText: '' }, focus() {}, append() {},
  setAttribute() {}, remove() {}, closest: () => null
})

const SDK = {
  atom: initial => {
    let v = initial
    const subs = new Set()
    return {
      get: () => v,
      set: n => { v = n; subs.forEach(f => f()) },
      listen: f => { subs.add(f); return () => subs.delete(f) }
    }
  },
  Button: 'Button',
  Codicon: 'Codicon',
  EmptyState: 'EmptyState',
  Input: 'Input',
  ListRow: 'ListRow',
  Switch: 'Switch',
  ToggleRow: 'ToggleRow',
  SearchField: 'SearchField',
  host: { notify() {}, navigate() {} },
  pluginSettingsHref: (plugin, page) => {
    const params = new URLSearchParams({ tab: 'plugins' })
    params.set('plugin', plugin)
    if (page) params.set('ppage', page)
    return `/settings?${params}`
  },
  useValue: a => a.get(),
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav'
}

const sandbox = {
  console, __SDK__: SDK,
  __REACT__: { useState: v => [v, () => {}] },
  __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
  document: {
    documentElement: { lang: 'en' }, querySelector: () => null, querySelectorAll: () => [],
    createElement: fakeElement, createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => ({ append() {} }),
    createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
    addEventListener() {}, body: { dispatchEvent() {} }
  },
  window: { addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'en' },
  NodeFilter: { SHOW_TEXT: 4 },
  HTMLElement: function HTMLElement() {}, Element: function Element() {},
  MutationObserver: function MutationObserver() {},
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  URL, Blob: function Blob() {},
  fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
  TextEncoder, TextDecoder, Uint8Array
}
sandbox.globalThis = sandbox

// --- turn the plugin into a script that exposes its dictionary ------------
const pluginSource = source
  .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, names) => `const {${names}} = __SDK__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, names) => `const {${names}} = __REACT__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, names) => `const {${names}} = __JSX__;`)
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

// The dictionary machinery is module-scope, so it is reachable by name once
// the module body is a plain script.
const EXPORT = `
globalThis.__dict = {
  EMBEDDED_WORDS,
  EMBEDDED_CANDS,
  EMBEDDED_MIXED,
  SPELL_LOWER,
  SPELL_TITLE,
  SPELL_UPPER,
  isSpelled,
  suggest,
  parseStems,
  parseAff,
  expandForms,
  lookup
};
`

const context = vm.createContext(sandbox)
vm.runInContext(pluginSource + EXPORT, context, { filename: 'plugin.js' })

const dict = sandbox.__dict
if (!dict || !dict.EMBEDDED_WORDS) {
  console.error('the plugin did not expose its dictionary')
  process.exit(1)
}

const forms = dict.EMBEDDED_WORDS
const cands = dict.EMBEDDED_CANDS

// The word set is a map of lowercase key -> bit mask of the legal
// capitalisations, so "is this spelling legal" is a mask test.
const L = dict.SPELL_LOWER
const T = dict.SPELL_TITLE
const U = dict.SPELL_UPPER
const spelled = (w) => dict.isSpelled({ words: forms, mixed: dict.EMBEDDED_MIXED }, w)

console.log('=== 1. the dictionary was built ===')
check('the word set is populated', forms.size > 100000, true)

console.log('\n=== 2. "Hermes" is a word ===')
check('"Hermes" is spelled correctly', spelled('Hermes'), true)
check('"HERMES" is spelled correctly', spelled('HERMES'), true)

console.log('\n=== 3. lowercase "hermes" is NOT a word ===')
// This is the bug: Chromium underlines lowercase "hermes", so the plugin must
// not treat it as correct, and must not suggest it.
check('"hermes" is NOT spelled correctly', spelled('hermes'), false)

console.log('\n=== 4. the same holds for other proper nouns ===')
for (const proper of ['London', 'Germany', 'Monday', 'Paris', 'Rome']) {
  check(`"${proper}" is spelled correctly`, spelled(proper), true)
  check(`"${proper.toLowerCase()}" is NOT`, spelled(proper.toLowerCase()), false)
}

console.log('\n=== 5. ordinary lowercase words are unaffected ===')
for (const word of ['spell', 'dictionary', 'composer', 'suggestion', 'misspelling']) {
  check(`"${word}" is spelled correctly`, spelled(word), true)
}

console.log('\n=== 6. ordinary lowercase words are valid in every case ===')
// A lowercase stem is a word in any capitalisation a reader types.
for (const word of ['cat', 'dog', 'house', 'computer']) {
  check(`"${word}" is spelled correctly`, spelled(word), true)
  check(`"${word[0].toUpperCase()}${word.slice(1)}" is spelled correctly`, spelled(word[0].toUpperCase() + word.slice(1)), true)
  check(`"${word.toUpperCase()}" is spelled correctly`, spelled(word.toUpperCase()), true)
}

console.log('\n=== 7. the M flag still produces its own suffix form ===')
// "Hermes/M" with SFX M ('s) yields "Hermes's" — the M-flagged stem's
// possessive, still capitalized, and NOT the lowercase "hermes's".
check('"Hermes\'s" is spelled correctly', spelled("Hermes's"), true)
check('"hermes\'s" is NOT', spelled("hermes's"), false)

console.log('\n=== 8. the suggestion for "hermas" is "Hermes", not "hermes" ===')
// This is the user's report: typing "hermas" offered "hermes", and
// "hermes" was still underlined because Chromium only knows "Hermes".
const list = dict.suggest({ words: forms, cands, mixed: dict.EMBEDDED_MIXED }, 'hermas')
check('"Hermes" is offered', list.includes('Hermes'), true)
check('"hermes" is NOT offered', list.includes('hermes'), false)
check('nothing offered is an uncapitalised proper noun', list.every(w => !['hermes','london','german'].includes(w.toLowerCase()) || w[0] === w[0].toUpperCase()), true)

console.log('\n=== 9. an ordinary typo still suggests the lowercase word ===')
const plain = dict.suggest({ words: forms, cands, mixed: dict.EMBEDDED_MIXED }, 'speling')
check('"speling" suggests "spelling"', plain.includes('spelling'), true)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
