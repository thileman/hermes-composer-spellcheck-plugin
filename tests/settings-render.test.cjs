// Render the plugin's SETTINGS page in a real React DOM and assert on the
// actual HTML the user sees.
//
// The other suites assert on the element TREE (what the plugin handed to
// React). This one renders it, so it catches a row that React refuses to
// render, a child passed in the wrong slot, a missing key, and the like —
// the failures that only show up once React is involved.
//
// Run from the desktop app checkout, which has react + react-dom:
//   node tests/settings-render.test.cjs

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const APP = process.env.HERMES_APP || 'C:/Users/thileman/AppData/Local/hermes/hermes-agent/apps/desktop'
const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

// React from the app checkout, so the render uses the same React the app does.
// The desktop app's deps live in the hermes-agent repo root, not in apps/desktop.
// HERMES_APP points at that checkout; in CI the workflow installs react +
// react-dom into this repo's own node_modules, so fall back to that.
function loadReact() {
  const candidates = [
    path.join(path.resolve(APP, '..', '..'), 'node_modules'),
    path.join(__dirname, '..', 'node_modules'),
    path.join(__dirname, '..', '..', 'node_modules')
  ]

  for (const base of candidates) {
    try {
      return {
        React: require(path.join(base, 'react')),
        ReactDOMServer: require(path.join(base, 'react-dom', 'server'))
      }
    } catch {
      // try the next candidate
    }
  }

  return null
}

const loaded = loadReact()

if (!loaded) {
  console.log('SKIP — react/react-dom are not available here.')
  console.log('       (the render suite needs the app checkout or `npm i react react-dom`)')
  process.exit(0)
}

const { React, ReactDOMServer } = loaded

// --- stubs for the modules the plugin imports ------------------------------
// ListRow / Codicon are stubbed with the REAL app implementations' shape:
// ListRow renders a title, an optional description and an optional action;
// Codicon renders an <i> with a codicon class.
const SDK = {
  atom: initial => {
    let v = initial
    return { get: () => v, set: n => { v = n }, listen: () => () => {} }
  },
  Button: props => React.createElement('button', { 'data-variant': props.variant }, props.children),
  Codicon: props => React.createElement('i', { className: `codicon codicon-${props.name} ${props.className || ''}` }),
  EmptyState: props => React.createElement('div', { 'data-empty': '1' }, props.title),
  Input: props => React.createElement('input', { 'data-input': '1', defaultValue: props.value }),
  ListRow: props => React.createElement(
    'div',
    { 'data-listrow': '1', className: props.className || '' },
    React.createElement('span', { 'data-row-title': '1' }, props.title),
    props.description ? React.createElement('div', { 'data-row-desc': '1' }, props.description) : null,
    props.hint ? React.createElement('div', { 'data-row-hint': '1' }, props.hint) : null,
    props.below ? React.createElement('div', { 'data-row-below': '1' }, props.below) : null,
    props.action ? React.createElement('div', { 'data-row-action': '1' }, props.action) : null
  ),
  Switch: props => React.createElement('input', { type: 'checkbox', 'data-switch': '1', checked: props.checked }),
  ToggleRow: props => React.createElement(
    'div',
    { 'data-togglerow': '1' },
    React.createElement('span', null, props.label),
    props.description ? React.createElement('div', null, props.description) : null
  ),
  SearchField: props => React.createElement('input', { 'data-search': '1', defaultValue: props.value }),
  host: {
    notify() {},
    navigate(path) {
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
  // The composer context-menu area id, as the SDK exports it.
  COMPOSER_AREAS: { contextMenu: 'composer.contextMenu' },
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav'
}

const navigations = []
const REACT = { useState: v => [v, () => {}] }
const JSX = { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment }

// --- turn the plugin's ESM into a script the sandbox can run --------------
let pluginSource = source
  .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, names) => `const {${names}} = __SDK__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, names) => `const {${names}} = __REACT__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, names) => `const {${names}} = __JSX__;`)
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

const fakeElement = () => ({
  dataset: {}, spellcheck: false, style: { cssText: '' }, focus() {}, append() {},
  setAttribute() {}, remove() {}, closest: () => null
})

const sandbox = {
  console, __SDK__: SDK, __REACT__: REACT, __JSX__: JSX,
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

const context = vm.createContext(sandbox)
vm.runInContext(pluginSource, context, { filename: 'plugin.js' })

const plugin = sandbox.__PLUGIN__
if (!plugin || typeof plugin.register !== 'function') {
  console.error('the plugin did not export a register()')
  process.exit(1)
}

// --- register, then render the settings page ------------------------------
const registered = []
const ctx = {
  storage: {
    _data: {},
    get(k, f) { return k in this._data ? this._data[k] : f },
    set(k, v) { this._data[k] = v }
  },
  register: c => { registered.push(c); return () => {} },
  registerMany: cs => { cs.forEach(c => registered.push(c)); return () => {} },
  registerSettingsPage: p => { registered.push({ area: 'settings.plugins', _page: p }); return () => {} },
  onDispose() {}, addEventListener() {}, setTimeout() {}, setInterval() {}
}

plugin.register(ctx)

const page = registered.find(c => c.area === 'settings.plugins')._page

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
function has(label, needle, haystack = html) {
  const ok = haystack.includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (looking for ${JSON.stringify(needle)})`)
}

const html = ReactDOMServer.renderToStaticMarkup(React.createElement(page.render))

console.log('=== the settings page renders ===')
check('it produced HTML', html.length > 0, true)
has('the Check spelling row is there', 'Check spelling')
has('the Show in the sidebar toggle is there', 'Show in the sidebar')

console.log('\n=== the Custom Words row renders as one click target ===')
has('its title is Custom Words', '>Custom Words<')
has('it has a description', 'Search, add and remove the words the spell checker always accepts.')
has('the chevron is the codicon', 'codicon-chevron-right')
// The link text must be GONE from the page entirely.
check('there is NO separate Open Custom Words link', html.includes('Open Custom Words'), false)

// The whole row must be the button: one <button> whose text is the title.
const buttons = html.match(/<button[\s\S]*?<\/button>/g) || []
const rowButton = buttons.find(b => b.includes('Custom Words'))
check('the row is a button', !!rowButton, true)
check('the button carries the title', !!rowButton && rowButton.includes('>Custom Words<'), true)
check('the button carries the description', !!rowButton && rowButton.includes('Search, add and remove'), true)
check('the button carries the chevron', !!rowButton && rowButton.includes('codicon-chevron-right'), true)

console.log('\n=== the plugin page itself is untouched ===')
const sub = page.children[0]
check('the sub-page is still there', sub.id, 'words')
const subHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(sub.render))
check('the word list rendered', subHtml.length > 0, true)
has('the word list has a search field', 'data-search', subHtml)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
