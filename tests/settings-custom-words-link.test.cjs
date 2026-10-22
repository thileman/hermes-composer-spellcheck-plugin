// Test that the settings page's "Custom Words" link opens the Custom Words
// page INSIDE Settings, instead of navigating out to the top-level
// /spellcheck-dictionary route and closing the overlay.
//
// The plugin registers its contributions through ctx.register, so this drives
// the real plugin with a stub ctx and reads back what the registry received.
//
// The module is evaluated whole (not a hand-copied register body) so the test
// cannot pass while the shipped code is broken.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

// --- a stub ctx ------------------------------------------------------------
function makeCtx() {
  const registered = []

  return {
    registered,
    navigations: [],
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

// --- stubs for the modules the plugin imports ------------------------------
// `pluginSettingsHref` mirrors the SDK's real implementation, so the test
// asserts against the same route shape the app builds.
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
  host: {
    notify() {},
    navigate(path) {
      // Record what the plugin asked the app to navigate to.
      navigations.push(path)
    }
  },
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

const REACT = { useState: v => [v, () => {}] }
const JSX = { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' }

// The host's navigate stub records into this list.
const navigations = []

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

console.log('=== 1. the settings page has a Custom Words sub-page ===')
check('one settings page', settingsPages().length, 1)
const page = settingsPages()[0]._page
check('the sub-page is the words page', page.children[0].id, 'words')
check('the sub-page is titled Custom Words', page.children[0].title, 'Custom Words')

console.log('\n=== 2. the settings page has a Custom Words row ===')
// Walk the rendered tree for the row and its clickable target.
function findByText(node, text) {
  if (!node || typeof node !== 'object') return null
  const children = node.p && node.p.children
  const list = Array.isArray(children) ? children : children ? [children] : []
  // A button whose text contains the label is the row.
  if (node.t === 'button') {
    const flat = JSON.stringify(node.p)
    if (flat.includes(text)) return node
  }
  for (const c of list) {
    const hit = findByText(c, text)
    if (hit) return hit
  }
  return null
}

const pageElement = page.render().t()
const wordsRow = findByText(pageElement, 'Custom Words')
check('the Custom Words row exists', !!wordsRow, true)
check('the WHOLE row is the button', wordsRow && wordsRow.t, 'button')
check('it has a chevron affordance', JSON.stringify(wordsRow.p).includes('chevron-right'), true)
check('there is no separate Open Custom Words link', JSON.stringify(pageElement).includes('Open Custom Words'), false)

console.log('\n=== 3. clicking it navigates to the SETTINGS sub-page ===')
navigations.length = 0
if (wordsRow) wordsRow.p.onClick()

check('exactly one navigation', navigations.length, 1)
const target = navigations[0] || ''

// The route must be the SETTINGS route (so the overlay stays open and the
// content pane swaps), not the top-level plugin route (which closes it).
check('it targets the settings route', target.startsWith('/settings?'), true)
check('it does NOT target the top-level route', target.includes('/spellcheck-dictionary'), false)

const params = new URLSearchParams(target.split('?')[1] || '')
check('the tab is plugins', params.get('tab'), 'plugins')
check('it names the plugin', params.get('plugin'), 'hermes-composer-spellcheck-plugin')
check('it names the sub-page', params.get('ppage'), 'words')

console.log('\n=== 4. the top-level route still exists as its own entry point ===')
check('the route is registered', routes().length, 1)
check('same path', routes()[0] && routes()[0].data.path, '/spellcheck-dictionary')

console.log('\n=== 5. the sidebar row is unaffected ===')
check('one sidebar row', navRows().length, 1)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
