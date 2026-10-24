// A dictionary that FAILED TO LOAD degrades to the embedded English list.
//
// README, Disclosures: "**If a fetch fails** the plugin logs it and keeps
// running on the embedded English dictionary: suggestions are still offered
// and applied, ranked in English." And plugin.js's own ensureReady() catch
// returns rankFor('en') for exactly that reason.
//
// It did not: `suggestionItems()` reads rankFor(activeLocale) and bails on
// `!entry.ready`, so on a machine whose app/OS language is German (or any
// locale whose .dic fetch fails — offline, a 404, a proxy that blocks
// raw.githubusercontent.com) the right-click menu contributed NOTHING. The
// English fallback existed only in the warm-up's return value, which nothing
// consumes.
//
// This suite drives the real registration with a failing fetch and asserts:
//
//   1. a failed non-English fetch still yields suggestion rows, in English
//   2. those rows are the embedded list's rows, not something invented
//   3. the user's custom words for THAT locale still silence a word
//   4. a locale that DID load is never overridden by the English fallback
//
// Nothing here needs Chromium's spell checker.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

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
      /* next */
    }
  }

  return name
}

const { JSDOM } = require(resolveDep('jsdom'))

/**
 * Load the plugin with one document language and one fetch behaviour, register
 * it, and hand back the real context-menu registration.
 */
async function boot(langTag, fetchImpl) {
  const dom = new JSDOM(
    `<!doctype html><html lang="${langTag}"><body>` +
      `<div role="textbox" contenteditable="true" lang="${langTag}">hi speling</div>` +
      `</body></html>`
  )
  const W = dom.window
  const D = W.document

  const hostCalls = { add: [], remove: [], notify: [] }
  const SDK = {
    atom: initial => {
      let v = initial
      const subs = new Set()
      return { get: () => v, set: n => { v = n; subs.forEach(f => f()) }, listen: f => { subs.add(f); return () => subs.delete(f) } }
    },
    Button: 'Button',
    Codicon: 'Codicon',
    COMPOSER_AREAS: { contextMenu: 'composer.contextMenu' },
    EmptyState: 'EmptyState',
    Input: 'Input',
    ListRow: 'ListRow',
    Switch: 'Switch',
    ToggleRow: 'ToggleRow',
    SearchField: 'SearchField',
    host: {
      notify: m => hostCalls.notify.push(m),
      navigate() {},
      spellcheck: {
        addWord: w => { hostCalls.add.push(w); return Promise.resolve(true) },
        removeWord: w => { hostCalls.remove.push(w); return Promise.resolve(true) }
      },
      composer: { getDraft: () => Promise.resolve(null), setDraft: () => Promise.resolve(false) }
    },
    pluginSettingsHref: () => '/settings',
    useValue: a => a.get(),
    ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebar-nav'
  }

  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    __SDK__: SDK,
    __REACT__: { useState: v => [v, () => {}] },
    __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
    document: D,
    window: W,
    navigator: { language: langTag },
    NodeFilter: W.NodeFilter,
    HTMLElement: W.HTMLElement,
    Element: W.Element,
    MutationObserver: W.MutationObserver,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    URL,
    Blob: W.Blob,
    fetch: fetchImpl,
    TextEncoder,
    TextDecoder,
    Uint8Array
  }
  sandbox.globalThis = sandbox

  const code = source
    .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, n) => `const {${n}} = __SDK__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, n) => `const {${n}} = __REACT__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, n) => `const {${n}} = __JSX__;`)
    .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

  const context = vm.createContext(sandbox)
  vm.runInContext(code + 'globalThis.__x = { rankFor, addCustomWord, activeLocale };', context, { filename: 'plugin.js' })

  const registered = []
  const ctx = {
    registered,
    storage: { _d: {}, get(k, f) { return k in this._d ? this._d[k] : f }, set(k, v) { this._d[k] = v } },
    register(c) { registered.push(c); return () => {} },
    registerMany() {},
    registerSettingsPage() { return () => {} },
    onDispose() {},
    addEventListener() {},
    setTimeout() {},
    setInterval() {}
  }

  sandbox.__PLUGIN__.register(ctx)
  await new Promise(r => setTimeout(r, 300)) // let the warm-up settle

  const menu = registered.filter(c => c.area === 'composer.contextMenu')[0]

  return { x: sandbox.__x, ctx, menu, rowsFor: w => menu.data.items({ word: w, selection: w }) }
}

const fail = { ok: false, status: 404, text: async () => '' }
const dic = (text) => async url => ({
  ok: !String(url).endsWith('.aff'),
  status: String(url).endsWith('.aff') ? 404 : 200,
  text: async () => text
})

async function main() {
  console.log('=== 1. a FAILED non-English fetch still offers English rows ===')
  {
    const app = await boot('de-DE', async () => fail)
    check('the German dictionary did not load', app.x.rankFor('de').ready, false)

    const rows = app.rowsFor('speling')
    const last = rows.length ? rows[rows.length - 1].label : null
    check('rows are contributed anyway', rows.length > 1, true)
    check('the English suggestion is there', rows[0] && rows[0].label, 'spelling')
    check('the last row is still Add to dictionary', last, 'Add to dictionary')
    check('no more than the app cap', rows.length <= 6, true)
  }

  console.log('\n=== 2. a loaded locale is NOT overridden by the fallback ===')
  {
    // The fetched German list has no 'spelling', so a fallback would show the
    // English six rows and a correct implementation shows "Add to dictionary"
    // alone (nothing to suggest).
    const app = await boot('de-DE', dic('3\nhaus/S\nhund/S\ntisch/S\n'))
    check('the German dictionary loaded', app.x.rankFor('de').ready, true)

    const rows = app.rowsFor('speling')
    check('the English list was not substituted', rows.map(r => r.label), ['Add to dictionary'])
  }

  console.log('\n=== 3. the custom words belong to the ACTIVE locale, not the fallback ===')
  {
    const app = await boot('de-DE', async () => fail)
    app.x.addCustomWord('de', 'speling', app.ctx.storage)
    check('the German custom word silenced the word', app.rowsFor('speling').length, 0)
    check('another misspelling still gets rows', app.rowsFor('recieve').length > 1, true)
  }

  console.log('\n=== 4. English is unaffected ===')
  {
    const app = await boot('en-US', async () => fail)
    const rows = app.rowsFor('recieve')
    check('English rows', rows[0].label, 'receive')
    check('English rows fit the cap', rows.length, 6)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
