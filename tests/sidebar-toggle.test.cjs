// Test the sidebar-row toggle: the row is registered and unregistered as the
// pref flips, and the Custom Words page stays reachable from the settings
// either way.
//
// This evaluates the REAL plugin source with the SDK and React stubbed, then
// calls the real register() with a stub ctx and reads back what the registry
// received — so the test cannot pass while the shipped code is broken.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

// --- a stub ctx ------------------------------------------------------------
function makeCtx() {
  const registered = []

  return {
    registered,
    storage: {
      _data: {},
      get(key, fallback) {
        return key in this._data ? this._data[key] : fallback
      },
      set(key, value) {
        this._data[key] = value
      }
    },
    register(c) {
      registered.push(c)
      return () => {
        const i = registered.indexOf(c)
        if (i >= 0) registered.splice(i, 1)
      }
    },
    registerMany(cs) {
      cs.forEach(c => this.register(c))
      return () => cs.forEach(c => {
        const i = registered.indexOf(c)
        if (i >= 0) registered.splice(i, 1)
      })
    },
    registerSettingsPage(page) {
      const entry = { area: 'settings.plugins', _page: page }
      registered.push(entry)
      return () => {
        const i = registered.indexOf(entry)
        if (i >= 0) registered.splice(i, 1)
      }
    },
    onDispose() {},
    addEventListener() {},
    setTimeout() {},
    setInterval() {}
  }
}

// --- the DOM the plugin touches at register time ---------------------------
const fakeElement = () => ({
  dataset: {},
  spellcheck: false,
  style: { cssText: '' },
  focus() {},
  append() {},
  setAttribute() {},
  remove() {},
  closest: () => null
})

const fakeDocument = {
  documentElement: { lang: 'en' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: fakeElement,
  createTreeWalker: () => ({ nextNode: () => null }),
  createDocumentFragment: () => ({ append() {} }),
  createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
  addEventListener() {},
  body: { dispatchEvent() {} }
}

// --- stubs for the two modules the plugin imports --------------------------
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
  useValue: a => a.get(),
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav'
}

const REACT = { useState: v => [v, () => {}] }
const JSX = { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' }

// --- turn the plugin's ESM into a script the sandbox can run --------------
let pluginSource = source
  .replace(
    /import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/,
    (_, names) => `const {${names}} = __SDK__;`
  )
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, names) => `const {${names}} = __REACT__;`)
  .replace(
    /import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/,
    (_, names) => `const {${names}} = __JSX__;`
  )
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

if (/^\s*export\s/m.test(pluginSource)) {
  console.error('the source still has an export statement the transform missed')
  process.exit(1)
}

const sandbox = {
  console,
  __SDK__: SDK,
  __REACT__: REACT,
  __JSX__: JSX,
  document: fakeDocument,
  window: { addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'en' },
  NodeFilter: { SHOW_TEXT: 4 },
  HTMLElement: function HTMLElement() {},
  Element: function Element() {},
  MutationObserver: function MutationObserver() {},
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  URL,
  Blob: function Blob() {},
  fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
  TextEncoder,
  TextDecoder,
  Uint8Array
}
sandbox.globalThis = sandbox

const context = vm.createContext(sandbox)
vm.runInContext(pluginSource, context, { filename: 'plugin.js' })

const plugin = sandbox.__PLUGIN__
if (!plugin || typeof plugin.register !== 'function') {
  console.error('the plugin did not export a register()')
  process.exit(1)
}

// --- drive it --------------------------------------------------------------
const ctx = makeCtx()
plugin.register(ctx)

const navRows = () => ctx.registered.filter(c => c.area === SDK.SIDEBAR_NAV_AREA)
const routes = () => ctx.registered.filter(c => c.area === SDK.ROUTES_AREA)
const settingsPages = () => ctx.registered.filter(c => c.area === 'settings.plugins')

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

console.log('=== 1. the sidebar row is registered by default ===')
check('one sidebar row', navRows().length, 1)
check('it points at the words page', navRows()[0] && navRows()[0].data.path, '/spellcheck-dictionary')
check('it is labelled Spellcheck', navRows()[0] && navRows()[0].data.label, 'Spellcheck')

console.log('\n=== 2. the route is always registered, row or no row ===')
check('the route exists', routes().length, 1)
check('same path', routes()[0] && routes()[0].data.path, '/spellcheck-dictionary')

console.log('\n=== 3. the settings page has a Custom Words sub-page ===')
check('one settings page', settingsPages().length, 1)
const page = settingsPages()[0]._page
check('it has a sub-page', page.children && page.children.length, 1)
check('the sub-page is the words page', page.children[0].id, 'words')
check('the settings page renders', typeof page.render, 'function')

console.log('\n=== 4. the pref defaults to showing the row ===')
check('showSidebarTab defaults on', ctx.storage.get('prefs', {}).showSidebarTab !== false, true)

console.log('\n=== 5. flipping the switch removes the row, and the page stays ===')
// Drive the REAL user path: the settings page's Switch -> onCheckedChange ->
// set() -> prefs.set + syncNavRow(). The element tree is walked out of the
// page's own render, so this is the same code path the user's click takes.
function findToggle(node, title) {
  if (!node || typeof node !== 'object') return null
  if (node.p && node.p.title === title) return node
  const children = node.p && node.p.children
  const list = Array.isArray(children) ? children : children ? [children] : []
  for (const c of list) {
    const hit = findToggle(c, title)
    if (hit) return hit
  }
  return null
}

const settingsElement = page.render()
const PageComponent = settingsElement.t
const pageElement = PageComponent()
const toggleRow = findToggle(pageElement, 'Show in the sidebar')

check('the settings page has a Show in the sidebar row', !!toggleRow, true)

if (toggleRow) {
  const sw = toggleRow.p.action
  sw.p.onCheckedChange(false)

  check('the row is gone after the switch is flipped off', navRows().length, 0)
  check('the route is STILL registered', routes().length, 1)
  check('the settings page is STILL registered', settingsPages().length, 1)
  check('the pref was persisted', ctx.storage.get('prefs', {}).showSidebarTab, false)

  sw.p.onCheckedChange(true)
  check('the row comes back', navRows().length, 1)
  check('the pref was persisted again', ctx.storage.get('prefs', {}).showSidebarTab, true)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
