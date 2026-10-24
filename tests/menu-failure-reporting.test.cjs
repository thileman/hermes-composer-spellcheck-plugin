// What the plugin TELLS THE USER, and what it must stop writing into the DOM.
//
// Three small failures, all of them invisible to the user:
//
//   1. A correction that did not happen was silent. `applyCorrection()` returns
//      false whenever the app's `action.replaceWord()` refuses — the composer
//      changed between opening the menu and choosing a row — or the draft holds
//      the word more than once, so the text path cannot tell WHICH one was
//      right-clicked. The menu closes either way. The user picks "definitely",
//      nothing changes, and no message explains it. It must say so.
//
//   2. `host.notify` was called bare at five sites. A shell without it, or one
//      whose toast surface throws (the Custom Words page calls it from inside a
//      React click handler, where a throw becomes an error boundary), took the
//      whole action down. Every notice now goes through notifyHost(), which is
//      guarded the way `noticeMenuSeamMissing()` always was.
//
//   3. `el.dataset.spellingMasked` was written on every masking pass and deleted
//      on every unmask. Nothing in the plugin, the SDK or the app ever reads it:
//      it was a write into the app's DOM for nothing, and it was not disclosed.
//
//   node tests/menu-failure-reporting.test.cjs

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        got  ${JSON.stringify(actual)}`)
    console.log(`        want ${JSON.stringify(expected)}`)
  }
}

// --- host, mutable so a test can make it misbehave --------------------------
const notified = []
let notifyThrows = false

const hostApi = {
  notify(message) {
    if (notifyThrows) {
      throw new Error('this shell has no toast surface')
    }

    notified.push(message)
  },
  navigate() {},
  spellcheck: {
    addWord: () => Promise.resolve(true),
    removeWord: () => Promise.resolve(true)
  },
  composer: {
    getDraft: () => Promise.resolve(draft),
    setDraft: (id, text) => { writes.push(text); draft = text; return Promise.resolve(true) }
  }
}

let draft = ''
const writes = []

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
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav',
  pluginSettingsHref: () => '/settings',
  useValue: a => a.get(),
  host: hostApi
}

const sandbox = {
  console,
  __SDK__: SDK,
  __REACT__: { useState: v => [v, () => {}] },
  __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
  document: {
    documentElement: { lang: 'en' },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, style: {} }),
    createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => ({ append() {} }),
    createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
    addEventListener() {},
    body: { dispatchEvent() {} },
    getSelection: () => null
  },
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

const EXPORT = `
globalThis.__hooks = {
  suggestionItems,
  applyCorrection,
  // Absent on the pre-fix plugin: keep the suite running so it can REPORT the
  // absence rather than die with a ReferenceError at load.
  notifyHost: typeof notifyHost === 'function' ? notifyHost : undefined,
  addCustomWord
};
`

const context = vm.createContext(sandbox)
vm.runInContext(
  source
    .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/s, (_, n) => `const {${n}} = __SDK__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/s, (_, n) => `const {${n}} = __REACT__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/s, (_, n) => `const {${n}} = __JSX__;`)
    .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {') + EXPORT,
  context,
  { filename: 'plugin.js' }
)

const hooks = sandbox.__hooks
const storage = { _data: {}, get(key, fb) { return key in this._data ? this._data[key] : fb }, set(key, v) { this._data[key] = v } }

main()

async function main() {
  console.log('=== 1. a correction that worked says nothing extra ===')
  {
    notified.length = 0
    draft = 'teh cat'
    writes.length = 0

    const rows = hooks.suggestionItems('teh', 'en', storage)
    const applied = await rows[0].onSelect({ replaceWord: () => true })

    check('the row reports success', applied, true)
    check('no notice was raised', notified.length, 0)
  }

  console.log('\n=== 2. a correction that could NOT be made is reported ===')
  {
    // "teh" twice in the draft, and an action that cannot place the edit: the
    // text path refuses to guess which occurrence was right-clicked.
    notified.length = 0
    draft = 'teh cat teh'
    writes.length = 0

    const rows = hooks.suggestionItems('teh', 'en', storage)
    const target = rows[0]

    check('the first row is a suggestion, not Add to dictionary', target.label !== 'Add to dictionary', true)

    const applied = await target.onSelect({ replaceWord: () => false })

    check('the row reports failure', applied, false)
    check('the draft was left alone', writes.length, 0)
    check('the user was told', notified.length, 1)
    check('it is a warning', notified[0] && notified[0].kind, 'warning')
    check('it names the word that was not replaced', /teh/.test(notified[0] && notified[0].message), true)
    check('it names the suggestion that was not applied',
      new RegExp(target.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(notified[0] && notified[0].message), true)
  }

  console.log('\n=== 3. a refused action that the draft seam rescues is NOT reported ===')
  {
    notified.length = 0
    draft = 'teh cat'
    writes.length = 0

    const rows = hooks.suggestionItems('teh', 'en', storage)
    const applied = await rows[0].onSelect({ replaceWord: () => false })

    check('the draft path corrected it', applied, true)
    check('the draft now reads "the cat"', draft, 'the cat')
    check('and no warning was raised', notified.length, 0)
  }

  console.log('\n=== 4. a throwing notice surface never escapes ===')
  {
    check('the guarded notify helper exists', typeof hooks.notifyHost, 'function')

    notified.length = 0
    notifyThrows = true

    // The failed-correction path.
    draft = 'teh cat teh'
    const rows = hooks.suggestionItems('teh', 'en', storage)
    let threw = null
    let applied = null

    try {
      applied = await rows[0].onSelect({ replaceWord: () => false })
    } catch (error) {
      threw = error
    }

    check('a failed correction does not throw when notify throws', threw, null)
    check('it still reports the failure', applied, false)

    // The Add to dictionary path — the one that runs inside the app's menu.
    const addRow = rows[rows.length - 1]

    check('the last row is Add to dictionary', addRow.label, 'Add to dictionary')

    threw = null

    try {
      addRow.onSelect()
    } catch (error) {
      threw = error
    }

    check('Add to dictionary does not throw when notify throws', threw, null)

    // notifyHost on its own, since the Custom Words page's two add paths and
    // its delete path all route through it.
    threw = null

    try {
      hooks.notifyHost('success', 'Added 2 words')
      hooks.notifyHost('info', 'Those words were already in your dictionary')
      hooks.notifyHost('success', 'Removed “teh”')
    } catch (error) {
      threw = error
    }

    check('notifyHost itself swallows a throwing host.notify', threw, null)

    notifyThrows = false
    notified.length = 0

    if (typeof hooks.notifyHost === 'function') {
      hooks.notifyHost('success', 'Added 2 words')
    }

    check('and forwards the payload when the surface works', notified[0],
      { kind: 'success', message: 'Added 2 words' })

    // A host with no notify at all.
    const saved = hostApi.notify
    delete hostApi.notify
    threw = null

    try {
      hooks.notifyHost('info', 'no surface here')
    } catch (error) {
      threw = error
    }

    hostApi.notify = saved
    check('a host with no notify is not an error either', threw, null)
  }

  console.log('\n=== 5. no bare host.notify survives in the source ===')
  {
    const code = stripLiteralsAndComments(source)
    // String literals are stripped by the time this runs, so the right-hand
    // side of the guard is blank: match the operator only.
    const guard = 'typeof host.notify ==='
    const found = []
    let at = code.indexOf('host.notify(')

    while (at !== -1) {
      const before = code.slice(Math.max(0, at - 600), at)

      found.push({ at, guarded: before.includes(guard) })
      at = code.indexOf('host.notify(', at + 1)
    }

    check('every host.notify call is behind the typeof guard',
      found.filter(f => !f.guarded).length, 0)
    check('there is at least one, so this is looking at real code', found.length > 0, true)
    console.log(`        (${found.length} guarded call(s))`)
  }

  console.log('\n=== 6. the dead DOM write is gone ===')
  {
    check('spellingMasked appears nowhere in the plugin', source.includes('spellingMasked'), false)

    const code = stripLiteralsAndComments(source)

    // Removing the bookkeeping attribute must not have removed the masking it
    // was bookkeeping FOR: the wrapper attribute is still applied.
    check('masking still marks its code spans', code.includes('spMask'), true)
    check('and still writes no other data-* on the editor root',
      /dataset\.(spellingMasked|spellcheckMasked)/.test(code), false)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}
