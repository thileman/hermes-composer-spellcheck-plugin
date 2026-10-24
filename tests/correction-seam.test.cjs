// The CORRECTION seam: a chosen suggestion is applied through the composer
// host, never by editing the DOM.
//
// The plugin used to apply a correction with
// `document.execCommand('insertText')` and, when that failed,
// `range.insertNode()`. Both write into the editor's DOM behind the
// composer's own reconciler, which rewrites that DOM on the next keystroke —
// so a correction was sometimes lost, sometimes doubled, and the caret ended
// up wherever the browser left it.
//
// The SDK offers two seams, and this suite drives both:
//
//   1. `action.replaceWord(text)` — the app's word-anchored replace. It knows
//      WHERE the word was and refuses when the composer has moved on. Used
//      first, whenever the action provides it.
//   2. `host.composer.getDraft()` / `setDraft()` — read the live draft, replace
//      the word in the TEXT, write the whole draft back. The app hydrates
//      @-refs and /-commands into chips itself.
//
// It also asserts the negative: no execCommand, no insertNode, and no write
// when the match is ambiguous (rewriting the wrong occurrence of a word is
// worse than doing nothing).

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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

// --- the composer host, as the plugin sees it ------------------------------
let draft = ''
let draftResult = null
let setDraftResult = true
const reads = []   // sessionId per getDraft call
const writes = []  // [sessionId, text] per setDraft call

const hostApi = {
  notify() {},
  navigate() {},
  spellcheck: {
    addWord: () => Promise.resolve(true),
    removeWord: () => Promise.resolve(true)
  },
  composer: {
    getDraft(sessionId) {
      reads.push(sessionId)
      return Promise.resolve(draftResult === undefined ? draft : draftResult)
    },
    setDraft(sessionId, text) {
      writes.push([sessionId, text])
      if (setDraftResult) draft = text
      return Promise.resolve(setDraftResult)
    }
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
  globalThis.__applyCorrection = applyCorrection;
  globalThis.__replaceWholeWord = replaceWholeWord;
  globalThis.__suggestionItems = suggestionItems;
`, context, { filename: 'plugin.js' })

const applyCorrection = sandbox.__applyCorrection
const replaceWholeWord = sandbox.__replaceWholeWord

function reset(nextDraft) {
  draft = nextDraft
  draftResult = undefined
  setDraftResult = true
  reads.length = 0
  writes.length = 0
}

async function main() {
  console.log('=== 1. the word-anchored seam is used first ===')
  {
    reset('teh cat')
    const calls = []
    const action = { selection: 'teh', word: 'teh', replaceWord(t) { calls.push(t); return true } }

    const ok = await applyCorrection(action, 'teh', 'the')

    check('replaceWord was called with the correction', calls, ['the'])
    check('it reports success', ok, true)
    check('the draft was never read', reads.length, 0)
    check('the draft was never written', writes.length, 0)
  }

  console.log('\n=== 2. no action -> read the draft, replace the word, write it back ===')
  {
    reset('teh cat')
    const ok = await applyCorrection(null, 'teh', 'the')

    check('getDraft was called once', reads.length, 1)
    check('for the ACTIVE composer (null session)', reads[0], null)
    check('setDraft was called once', writes.length, 1)
    check('for the active composer, with the corrected draft', writes[0], [null, 'the cat'])
    check('the correction reports success', ok, true)
  }

  console.log('\n=== 3. a refused replaceWord falls through to the draft seam ===')
  {
    reset('teh cat')
    const action = { selection: 'teh', word: 'teh', replaceWord: () => false }

    const ok = await applyCorrection(action, 'teh', 'the')

    check('getDraft was used instead', reads.length, 1)
    check('and the draft was corrected', writes[0], [null, 'the cat'])
    check('it reports success', ok, true)
  }

  console.log('\n=== 4. the rest of the draft survives, @-refs included ===')
  {
    reset('hi @file.ts and teh end\nsecond line')
    const ok = await applyCorrection(null, 'teh', 'the')

    check('every other character is untouched', writes[0], [null, 'hi @file.ts and the end\nsecond line'])
    check('it reports success', ok, true)
  }

  console.log('\n=== 5. an AMBIGUOUS word is left alone rather than mis-edited ===')
  {
    reset('teh cat and teh dog')
    const ok = await applyCorrection(null, 'teh', 'the')

    check('the draft was read', reads.length, 1)
    check('nothing was written', writes.length, 0)
    check('the correction reports failure', ok, false)
  }

  console.log('\n=== 6. a word that is not in the draft is left alone ===')
  {
    reset('a different sentence')
    check('replaceWholeWord returns null', replaceWholeWord('a different sentence', 'teh', 'the'), null)
    check('the correction reports failure', await applyCorrection(null, 'teh', 'the'), false)
    check('nothing was written', writes.length, 0)
  }

  console.log('\n=== 7. whole words only ===')
  {
    check('does not match inside a longer word', replaceWholeWord('tehx plain', 'teh', 'the'), null)
    check('matches at the start', replaceWholeWord('teh cat', 'teh', 'the'), 'the cat')
    check('matches at the end', replaceWholeWord('cat teh', 'teh', 'the'), 'cat the')
    check('matches with punctuation after it', replaceWholeWord('teh, cat', 'teh', 'the'), 'the, cat')
    check('leaves a capitalised form replaceable', replaceWholeWord('Teh cat', 'Teh', 'The'), 'The cat')
  }

  console.log('\n=== 8. a host that cannot answer is not an error ===')
  {
    reset('teh cat')
    draftResult = null
    check('a null draft reports failure', await applyCorrection(null, 'teh', 'the'), false)
    check('and nothing is written', writes.length, 0)

    reset('teh cat')
    draftResult = undefined
    setDraftResult = false
    check('a refused setDraft reports failure', await applyCorrection(null, 'teh', 'the'), false)
    check('the write was attempted once', writes.length, 1)
  }

  console.log('\n=== 9. the suggestion rows route through this seam ===')
  {
    reset('teh cat')
    const rows = sandbox.__suggestionItems('teh', 'en', { get() {}, set() {} })
    const first = rows[0]

    check('"teh" offers "the" first', first.label, 'the')

    // An action WITHOUT replaceWord: the row must still correct the draft
    // through the host rather than giving up.
    const ok = await first.onSelect({ selection: '', word: 'teh' })

    check('the row corrected the draft', writes[0], [null, 'the cat'])
    check('it reports success', ok, true)
  }

  console.log('\n=== 10. no DOM edit survives in the source ===')
  {
    const code = stripLiteralsAndComments(source)

    // createTextNode/getSelection still exist in maskCodeSpans, which edits
    // the editor on purpose; the correction path must not use them.
    for (const construct of ['execCommand', 'insertNode', 'deleteContents', 'collapseToEnd']) {
      check(`"${construct}" is gone`, code.includes(construct), false)
    }
    check('applyCorrection is defined', code.includes('applyCorrection'), true)
    check('the draft seam is called', /host\.composer/.test(code) || /composer\.getDraft/.test(code), true)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
