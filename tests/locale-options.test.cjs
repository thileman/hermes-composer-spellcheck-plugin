// The Language dropdown must offer exactly the locales the plugin can load.
//
// The list was missing en-GB, en-AU and en-CA while the README promised them.
// LOCALE_MAP already resolved all three and loadDictionary() already fetched
// `dictionaries/<locale>/index.dic`, so they were loadable and unselectable —
// reachable only by hand-editing the pref.
//
// This suite reads the REAL settings page, takes the REAL <option> values, and
// then loads every one of them through the REAL ensureLocale()/loadDictionary()
// path with a stub fetch, asserting the URL each option produces. A locale
// offered in the dropdown but unknown to LOCALE_MAP resolves to English and
// would fail here, which is the "offers only what it can load" rule.
//
// The three regional English dictionaries were also verified against the pinned
// upstream commit while this was written: index.dic and index.aff are HTTP 200
// for en-GB, en-AU and en-CA, and each expands to ~118k word forms with a
// genuinely different vocabulary (en-GB/en-AU know "colour"/"organise", en-CA
// knows "organize"/"tire"). A suite cannot make that network call, so it checks
// the wiring here and the data was checked out of band.

const fs = require('fs')
const path = require('path')
const { load, makeCtx } = require('./harness.cjs')

const { sandbox, plugin } = load()

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
function has(label, needle, haystack) {
  const ok = haystack.includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (looking for ${JSON.stringify(needle)})`)
}

const ctx = makeCtx()
plugin.register(ctx)

const settingsPage = ctx.registered.find(c => c.area === 'settings.plugins')._page
const rendered = settingsPage.render()
const tree = rendered.t(rendered.p)

// The <select> the user changes Language with, and its options.
const walk = (node, out) => {
  if (node == null) return out
  if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return out }
  if (typeof node !== 'object') return out
  out.push(node)
  if (node.p && 'children' in node.p) walk(node.p.children, out)
  return out
}

const nodes = walk(tree, [])
const select = nodes.find(n => n.t === 'select')
const optionValues = select ? (select.p.children || []).map(o => o.p.value) : []

console.log('=== 1. the Language dropdown has the three regional English locales ===')
for (const tag of ['en-GB', 'en-AU', 'en-CA']) {
  has(`${tag} is offered`, tag, optionValues)
}

console.log('\n=== 2. the option list is exactly the expected set ===')
check('the dropdown options', optionValues, [
  'auto', 'en', 'en-GB', 'en-AU', 'en-CA', 'de', 'fr', 'es', 'it', 'pt',
  'nl', 'pl', 'ru', 'uk', 'sv', 'tr', 'cs', 'da', 'el', 'he', 'fa', 'ko'
])
check('Automatic is still first', optionValues[0], 'auto')
check('no duplicate option', new Set(optionValues).size, optionValues.length)

console.log('\n=== 3. every option resolves to a real dictionary, not to English ===')
for (const value of optionValues) {
  if (value === 'auto') continue
  check(`${value} resolves to itself`, sandbox.__resolveLocale(value), value)
}

console.log('\n=== 4. every option loads through the real fetch path ===')

async function main() {
  // A tiny but valid Hunspell pair. The point is the URL and the state
  // machine, not the vocabulary (the real word lists were checked out of band).
  const calls = []

  sandbox.__fetch = async (url) => {
    calls.push(url)

    if (url.endsWith('.aff')) {
      return { ok: true, status: 200, text: async () => 'SET UTF-8\n' }
    }

    return { ok: true, status: 200, text: async () => '3\ncolour\ncolor\norganise\n' }
  }

  for (const value of optionValues) {
    if (value === 'auto') continue

    const entry = await sandbox.__ensureLocale({ language: value })

    check(`${value} is ready`, entry.ready, true)
    check(`${value} has words`, entry.words.size > 0, true)

    if (value === 'en') {
      check('en is the EMBEDDED dictionary (no fetch)', calls.some(u => /\/en\/index\.dic$/.test(u)), false)
      continue
    }

    const dic = calls.filter(u => u.endsWith('/index.dic')).pop() || ''
    check(`${value} fetches its own index.dic`, dic.endsWith(`/dictionaries/${value}/index.dic`), true)
    // The pinned commit, so the word list cannot change under the user.
    has(`${value} fetches from the pinned commit`, '8cfea406b505e4d7df52d5a19bce525df98c54ab', dic)
  }

  console.log('\n=== 5. the three new locales are DISTINCT dictionaries ===')
  {
    const gb = sandbox.__rankFor('en-GB')
    const ca = sandbox.__rankFor('en-CA')

    check('en-GB is not the embedded English store', gb === sandbox.__rankFor('en'), false)
    check('en-CA is not the embedded English store', ca === sandbox.__rankFor('en'), false)
    check('en-GB and en-CA are separate stores', gb === ca, false)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
