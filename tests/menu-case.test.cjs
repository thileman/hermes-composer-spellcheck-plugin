// The RIGHT-CLICK path, end to end — through the SDK contribution.
//
// The plugin used to inject its own rows into the app's Radix menu: query the
// menu, clone a row's class name, insert <button>s, capture keydown, write
// `data-highlighted`, dispatch a synthetic `pointerdown`. All of that is gone —
// the maintainer asked for it, and every step was a bet on the app's private
// markup.
//
// What is left is a `composer.contextMenu` contribution. The app renders the
// rows in its own section of its own menu, caps them, closes the menu and
// returns the caret to the composer BEFORE calling our onSelect, and offers
// `action.replaceWord()` for the edit.
//
// So this suite drives the real thing: `register()` on a stub ctx, then
// `data.items({ word, selection })` on the registration the plugin actually
// made. It asserts:
//
//   1. the dictionary's capitalisation survives to the ROW LABEL —
//      "english" -> "English", "monday" -> "Monday" — which is the whole point
//      of the case work the dictionary suite covers
//   2. a correctly spelled word contributes NO rows
//   3. the row list fits the app's 6-row cap, with Add to dictionary last
//   4. choosing a row calls `action.replaceWord` with that row's own text
//   5. the old injection path, the private bridge and the DOM edit are gone
//   6. a right-click inside one of the plugin's OWN masked code spans
//      (`code[data-sp-mask]`) contributes NO rows, while a right-click in
//      prose still does — and every unusable selection falls through to
//      "offer the rows", never to a silently empty menu
//
// None of this needs Chromium's spell checker: the plugin ranks its own
// suggestions from its own dictionary.

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

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

const { JSDOM } = require(resolveDep('jsdom'))

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

// --- stubs -----------------------------------------------------------------
/** Every host call the plugin makes is recorded, so the seam is observable. */
const hostCalls = { add: [], remove: [], notify: [], setSpellcheck: [], getDraft: [], setDraft: [] }

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
  host: {
    notify: msg => hostCalls.notify.push(msg),
    navigate() {},
    spellcheck: {
      addWord: w => { hostCalls.add.push(w); return Promise.resolve(true) },
      removeWord: w => { hostCalls.remove.push(w); return Promise.resolve(true) }
    },
    composer: {
      getDraft: sid => { hostCalls.getDraft.push(sid); return Promise.resolve(null) },
      setDraft: (sid, text) => { hostCalls.setDraft.push([sid, text]); return Promise.resolve(false) }
    }
  },
  pluginSettingsHref: () => '/settings',
  useValue: a => a.get(),
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar-nav'
}

// A REAL selection from jsdom, wired in below. The plugin reads
// `document.getSelection()` at call time, so a live delegate to jsdom's
// Selection is enough to exercise the code-span guard against actual DOM
// containment and a real `closest()` — no hand-rolled stand-in for the
// behaviour under test.
const selectionDom = new JSDOM(
  '<!doctype html><html><body>' +
    '<div role="textbox" contenteditable="true" id="editor">hello <code data-sp-mask="1">speling.ts</code> world</div>' +
    '<p id="outside">the <code data-sp-mask="1">speling.ts</code> elsewhere</p>' +
    '<div role="textbox" contenteditable="true" id="editor2">another speling here</div>' +
    '</body></html>',
  { pretendToBeVisual: true }
)
const selectionWindow = selectionDom.window
const selectionDocument = selectionWindow.document

// Just enough document for register() and for activeLocale(): nothing here
// queries or mutates the composer's markup.
const fakeDocument = {
  documentElement: { lang: 'en' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, style: {} }),
  createTreeWalker: () => ({ nextNode: () => null }),
  createDocumentFragment: () => ({ append() {} }),
  createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
  addEventListener() {},
  body: { dispatchEvent() {} },
  // The caret the guard asks for.
  getSelection: () => selectionWindow.getSelection()
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
  globalThis.__suggest = suggest;
  globalThis.__lookup = lookup;
  globalThis.__w = EMBEDDED_WORDS;
  globalThis.__c = EMBEDDED_CANDS;
  globalThis.__m = EMBEDDED_MIXED;
`, context, { filename: 'plugin.js' })

const plugin = sandbox.__PLUGIN__
if (!plugin || typeof plugin.register !== 'function') {
  console.error('the plugin did not export a register()')
  process.exit(1)
}

const dict = { words: sandbox.__w, cands: sandbox.__c, mixed: sandbox.__m }

// --- a stub ctx, and the REAL registration the plugin makes ----------------
function makeCtx(prefs) {
  const registered = []

  return {
    registered,
    storage: {
      _data: prefs ? { prefs } : {},
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

const menuRegistrations = () => ctx.registered.filter(c => c.area === SDK.COMPOSER_AREAS.contextMenu)
const contribution = menuRegistrations()[0]

/** The rows the app would render for this word. */
const rowsFor = word => contribution.data.items({ word, selection: word })

/** Put the collapsed caret at (node, offset), the way a right-click leaves it. */
function caretAt(node, offset) {
  const range = selectionDocument.createRange()

  range.setStart(node, offset)
  range.collapse(true)

  const selection = selectionWindow.getSelection()

  selection.removeAllRanges()
  selection.addRange(range)
}

/** A stand-in for the action object the app hands to onSelect. */
function makeAction(word) {
  const calls = []
  return {
    selection: word || '',
    word: word || null,
    replaceWord(text) { calls.push(text); return true },
    calls
  }
}

async function main() {
  console.log('=== 1. the plugin contributes to the composer context menu ===')
  check('exactly one composer.contextMenu registration', menuRegistrations().length, 1)
  check('its id', contribution && contribution.id, 'spellcheck-suggestions')
  check('its area', contribution && contribution.area, 'composer.contextMenu')
  check('it exposes items()', typeof (contribution && contribution.data && contribution.data.items), 'function')
  check('it renders no menu of its own', contribution && contribution.render, undefined)

  console.log('\n=== 2. "english" offers the CAPITALISED spelling, as a row label ===')
  const englishRows = rowsFor('english')
  const englishLabels = englishRows.map(r => r.label)

  check('"English" is the first row', englishLabels[0], 'English')
  check('the lowercase form is NOT offered', englishLabels.includes('english'), false)
  check('a suggestion row carries onSelect', typeof englishRows[0].onSelect, 'function')
  check('suggest() still ranks it first', sandbox.__suggest(dict, 'english')[0], 'English')
  check('the lowercase form is still NOT a word', sandbox.__lookup(dict, 'english'), false)

  console.log('\n=== 3. the same for another proper noun ===')
  for (const [typed, want] of [['monday', 'Monday'], ['london', 'London'], ['german', 'German']]) {
    const labels = rowsFor(typed).map(r => r.label)
    check(`"${typed}" -> first row "${want}"`, labels[0], want)
    check(`"${typed}" never offers the lowercase form`, labels.includes(typed), false)
  }

  console.log('\n=== 4. a correctly spelled word contributes nothing ===')
  for (const word of ['spelling', 'composer', 'Hermes']) {
    check(`"${word}" -> no rows`, rowsFor(word).length, 0)
  }
  check('no word under the cursor -> no rows', contribution.data.items({ word: null, selection: '' }).length, 0)

  console.log("\n=== 5. the row list fits the app's 6-row cap, and adds the word ===")
  const typoRows = rowsFor('speling')
  check('"speling" suggests "spelling" first', typoRows[0].label, 'spelling')
  check('at most 6 rows', typoRows.length <= 6, true)
  check('the last row is Add to dictionary', typoRows[typoRows.length - 1].label, 'Add to dictionary')
  check('every suggestion row before it has a label and onSelect',
    typoRows.slice(0, -1).every(r => typeof r.label === 'string' && r.label && typeof r.onSelect === 'function'), true)

  console.log("\n=== 6. choosing a row calls action.replaceWord with THAT row's text ===")
  {
    const rows = rowsFor('english')
    const action = makeAction('english')
    const ok = await rows[0].onSelect(action)

    check('replaceWord was called once', action.calls.length, 1)
    check('with the capitalised row text', action.calls[0], 'English')
    check('the correction reports success', ok, true)
  }
  {
    const rows = rowsFor('speling')
    const action = makeAction('speling')
    await rows[0].onSelect(action)
    check('"speling" -> replaceWord("spelling")', action.calls[0], 'spelling')
  }

  console.log('\n=== 7. Add to dictionary is a row, and it records the word ===')
  {
    const rows = rowsFor('hermas')
    const addRow = rows.find(r => r.label === 'Add to dictionary')
    check('the row exists', !!addRow, true)

    const before = hostCalls.add.length
    await addRow.onSelect(makeAction('hermas'))
    await new Promise(r => setTimeout(r, 0))

    check('host.spellcheck.addWord was called', hostCalls.add.length, before + 1)
    check('with the lowercased word', hostCalls.add[hostCalls.add.length - 1], 'hermas')
    check('it was recorded in storage', (ctx.storage.get('customWords', {}).en || []).includes('hermas'), true)
  }

  console.log('\n=== 8. the Check spelling switch gates the contribution ===')
  {
    const off = makeCtx({ enabled: false })
    plugin.register(off)
    const reg = off.registered.filter(c => c.area === SDK.COMPOSER_AREAS.contextMenu)[0]
    check('a disabled plugin contributes no rows', reg.data.items({ word: 'english', selection: 'english' }).length, 0)
  }

  console.log('\n=== 9. right-clicking inside a MASKED CODE SPAN contributes nothing ===')
  {
    // The old DOM handler asked the pointer event: `target.closest('code')`.
    // The SDK's menu context is frozen to { selection, word }, so the guard
    // asks the CARET instead — and jsdom here supplies a real selection and a
    // real `closest()`, not a stub that re-implements the check.
    const codeEl = selectionDocument.querySelector('#editor code[data-sp-mask]')

    caretAt(codeEl.firstChild, 2)
    check('the caret really is inside the masked span',
      selectionWindow.getSelection().anchorNode.parentElement.closest('code[data-sp-mask]') === codeEl, true)
    check('a misspelled word inside CODE -> no rows', rowsFor('speling').length, 0)

    caretAt(codeEl, 0)
    check('caret anchored on the <code> element itself -> no rows', rowsFor('speling').length, 0)

    // The other direction, same word: ordinary prose must still be offered.
    caretAt(selectionDocument.querySelector('#editor').firstChild, 2)
    check('the same misspelled word in PROSE -> rows', rowsFor('speling').length > 0, true)
    check('and they are the usual rows', rowsFor('speling')[0].label, 'spelling')

    caretAt(selectionDocument.querySelector('#editor2').firstChild, 3)
    check('prose in a second composer -> rows', rowsFor('speling').length > 0, true)

    // Fallback 1: nothing selected at all.
    selectionWindow.getSelection().removeAllRanges()
    check('no selection -> rows are still offered', rowsFor('speling').length > 0, true)

    // Fallback 2: the caret is in a masked span, but NOT in the composer.
    caretAt(selectionDocument.querySelector('#outside code').firstChild, 2)
    check('a masked span outside the composer -> rows are still offered', rowsFor('speling').length > 0, true)

    // Fallback 3: no selection API at all (SSR, or a bare sandbox).
    const liveGetSelection = fakeDocument.getSelection

    delete fakeDocument.getSelection
    check('no getSelection() -> rows are still offered', rowsFor('speling').length > 0, true)
    fakeDocument.getSelection = liveGetSelection
  }

  console.log('\n=== 10. the old injection path, the bridge and the DOM edit are GONE ===')
  // Scan CODE, not prose: the comments above name these constructs on purpose.
  const code = stripLiteralsAndComments(source)
  for (const symbol of ['injectSuggestions', 'wireKeyboard', 'whenMenuOpen', 'closeAppMenu', 'clearInjected', 'wordAtCaret', 'replaceRange', 'teachChromosphere', 'injected']) {
    check(`"${symbol}" is not defined or called`, new RegExp(`\\b${symbol}\\b`).test(code), false)
  }
  for (const construct of ['execCommand', 'insertNode', 'data-highlighted', 'data-radix-collection-item', 'radix-menu-content', 'contextMenuSpellcheck', 'QUICK_ENTRY_SELECTOR', 'PointerEvent', 'getComputedStyle']) {
    check(`"${construct}" no longer appears in the code`, code.includes(construct), false)
  }
  check('no window.hermesDesktop reach', code.includes('hermesDesktop'), false)

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
