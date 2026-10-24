// The DICTIONARY seam: both stores move together.
//
// Two lists are involved, and they do different jobs:
//
//   * the plugin's own list (`ctx.storage['customWords']`) is the source of
//     truth — it drives the Custom Words page and the plugin's recognition
//   * the app's spell-check dictionary is Chromium's, and it is the only thing
//     that clears the red squiggle
//
// Adding used to reach Chromium through the private
// `window.hermesDesktop.contextMenuSpellcheck` bridge; removing touched our
// list and nothing else, so a deleted word kept being accepted by the app.
//
// This suite drives the real surfaces — the context-menu contribution's
// "Add to dictionary" row, and the Custom Words page's trash button, rendered
// out of the real component — and asserts that
//
//   1. add   -> host.spellcheck.addWord(word)   AND the word is in storage
//   2. remove-> host.spellcheck.removeWord(word) AND it is gone from storage
//   3. a word added is no longer flagged, and one removed is again
//   4. a shell with no spellcheck host still records the word (no throw, no
//      lost data) — the app dictionary is best-effort

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

// --- the host, with both dictionary calls recorded -------------------------
const calls = { add: [], remove: [], notify: [] }

const hostApi = {
  notify: msg => calls.notify.push(msg),
  navigate() {},
  spellcheck: {
    addWord: w => { calls.add.push(w); return Promise.resolve(true) },
    removeWord: w => { calls.remove.push(w); return Promise.resolve(true) }
  },
  composer: {
    getDraft: () => Promise.resolve(null),
    setDraft: () => Promise.resolve(false)
  }
}

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
  COMPOSER_AREAS: { contextMenu: 'composer.contextMenu' },
  EmptyState: 'EmptyState',
  Input: 'Input',
  ListRow: 'ListRow',
  Switch: 'Switch',
  ToggleRow: 'ToggleRow',
  SearchField: 'SearchField',
  host: hostApi,
  pluginSettingsHref: () => '/settings',
  useValue: a => a.get(),
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav'
}

const fakeDocument = {
  documentElement: { lang: 'en' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, style: {} }),
  createTreeWalker: () => ({ nextNode: () => null }),
  createDocumentFragment: () => ({ append() {} }),
  createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
  addEventListener() {},
  body: { dispatchEvent() {} }
}

const sandbox = {
  console,
  __SDK__: SDK,
  __REACT__: { useState: v => [v, () => {}] },
  __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
  document: fakeDocument,
  window: { addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'en' },
  NodeFilter: { SHOW_TEXT: 4 },
  HTMLElement: function HTMLElement() {},
  Element: function Element() {},
  MutationObserver: function MutationObserver() {},
  setTimeout,
  clearTimeout,
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

const pluginSource = source
  .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, n) => `const {${n}} = __SDK__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, n) => `const {${n}} = __REACT__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, n) => `const {${n}} = __JSX__;`)
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

const context = vm.createContext(sandbox)
vm.runInContext(pluginSource + `
  globalThis.__allowed = allowed;
  globalThis.__isKnown = isKnown;
  globalThis.__rankFor = rankFor;
  globalThis.__addCustomWord = addCustomWord;
  globalThis.__removeCustomWord = removeCustomWord;
`, context, { filename: 'plugin.js' })

const plugin = sandbox.__PLUGIN__

function makeCtx() {
  const registered = []

  return {
    registered,
    storage: {
      _data: {},
      get(key, fallback) { return key in this._data ? this._data[key] : fallback },
      set(key, value) { this._data[key] = value }
    },
    register(c) {
      registered.push(c)
      return () => {
        const i = registered.indexOf(c)
        if (i >= 0) registered.splice(i, 1)
      }
    },
    registerMany(cs) { cs.forEach(c => this.register(c)); return () => {} },
    registerSettingsPage(page) {
      registered.push({ area: 'settings.plugins', _page: page })
      return () => {}
    },
    onDispose() {},
    addEventListener() {},
    setTimeout() {},
    setInterval() {}
  }
}

const ctx = makeCtx()
plugin.register(ctx)

const contribution = ctx.registered.filter(c => c.area === SDK.COMPOSER_AREAS.contextMenu)[0]
const rowsFor = word => contribution.data.items({ word, selection: word })
const customWords = () => ctx.storage.get('customWords', {}) || {}
const storedList = () => customWords().en || []

/**
 * Walk a rendered element tree (jsx returns `{ t, p }`) and collect every
 * node. The Custom Words page is a real component, so this reaches the same
 * button the user clicks.
 */
function walk(node, out = []) {
  if (!node || typeof node !== 'object') {
    return out
  }

  out.push(node)

  const kids = node.p && node.p.children;

  for (const child of Array.isArray(kids) ? kids : kids ? [kids] : []) {
    walk(child, out)
  }

  return out
}

function renderWordsPage() {
  const registration = ctx.registered.filter(c => c.area === 'settings.plugins')[0]
  const subPage = registration._page.children.find(c => c.id === 'words')
  const element = subPage.render()

  // jsx(DictionaryPage, props) -> { t: DictionaryPage, p: props }
  return walk(element.t(element.p))
}

const findRemoveButton = word =>
  renderWordsPage().find(n => n.p && n.p['aria-label'] === `Remove ${word}`)

async function main() {
  console.log('=== 1. nothing is stored to begin with ===')
  check('storage has no customWords', ctx.storage.get('customWords', {}), {})
  check('"english" is not in the plugin list', sandbox.__allowed.has('en'), false)

  console.log('\n=== 2. Add to dictionary -> addWord + storage, together ===')
  {
    const rows = rowsFor('english')
    const addRow = rows.find(r => r.label === 'Add to dictionary')

    check('the Add row exists for a misspelling', !!addRow, true)

    const before = calls.add.length
    addRow.onSelect({ replaceWord: () => true, selection: 'english', word: 'english' })
    await new Promise(r => setTimeout(r, 0))

    check('host.spellcheck.addWord was called', calls.add.length, before + 1)
    check('with the lowercased word', calls.add[calls.add.length - 1], 'english')
    check('the plugin list holds it', [...(sandbox.__allowed.get('en') || [])], ['english'])
    check('storage holds it', storedList(), ['english'])
    check('the app was told exactly once', calls.add.filter(w => w === 'english').length, 1)
  }

  console.log('\n=== 3. a word in our list stops being flagged ===')
  {
    const entry = sandbox.__rankFor('en')
    check('"english" now counts as known', sandbox.__isKnown(entry, 'english', 'en'), true)
    check('the contribution stops offering it', rowsFor('english').length, 0)
  }

  console.log('\n=== 4. adding a word twice teaches the app once ===')
  {
    const before = calls.add.length

    check('a new word is added', sandbox.__addCustomWord('en', 'hermas', ctx.storage), true)
    await new Promise(r => setTimeout(r, 0))
    check('and handed to the app', calls.add[calls.add.length - 1], 'hermas')

    check('a repeat reports false', sandbox.__addCustomWord('en', 'hermas', ctx.storage), false)
    await new Promise(r => setTimeout(r, 0))
    check('and does not call the app again', calls.add.length, before + 1)
    check('storage still holds both words, sorted', storedList(), ['english', 'hermas'])
  }

  console.log('\n=== 5. Remove -> removeWord + storage, together ===')
  {
    const button = findRemoveButton('english')

    check('the Custom Words page renders a Remove button', !!button, true)
    check('its label names the word', button && button.p['aria-label'], 'Remove english')

    const before = calls.remove.length
    button.p.onClick()
    await new Promise(r => setTimeout(r, 0))

    check('host.spellcheck.removeWord was called', calls.remove.length, before + 1)
    check('with the word', calls.remove[calls.remove.length - 1], 'english')
    check('it is gone from the plugin list', [...(sandbox.__allowed.get('en') || [])], ['hermas'])
    check('it is gone from storage', storedList(), ['hermas'])
    check('the row disappears from the page', !!findRemoveButton('english'), false)
  }

  console.log('\n=== 6. a removed word is flagged again — the two stores agree ===')
  {
    const entry = sandbox.__rankFor('en')
    check('"english" is unknown again', sandbox.__isKnown(entry, 'english', 'en'), false)
    check('the contribution offers it again', rowsFor('english').length > 0, true)
  }

  console.log('\n=== 7. a shell with no spellcheck host still records the word ===')
  {
    const spellcheck = hostApi.spellcheck
    delete hostApi.spellcheck

    const rows = rowsFor('speling')
    const addRow = rows.find(r => r.label === 'Add to dictionary')
    let threw = null

    try {
      addRow.onSelect({ replaceWord: () => true, selection: 'speling', word: 'speling' })
      await new Promise(r => setTimeout(r, 0))
    } catch (e) {
      threw = e
    }

    hostApi.spellcheck = spellcheck

    check('no exception escaped', threw, null)
    check('the word is still recorded in storage', (customWords().en || []).includes('speling'), true)
    check('the notify still fired', calls.notify.length > 0, true)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
