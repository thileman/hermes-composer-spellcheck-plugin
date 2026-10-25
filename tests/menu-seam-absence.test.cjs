// The CONTEXT-MENU seam is FEATURE-DETECTED, so the plugin degrades instead of
// filing a contribution into an area the app never resolves.
//
// `COMPOSER_AREAS.contextMenu` is NEW. The `COMPOSER_AREAS` export has carried
// ten keys (top, bottom, underside, leading, actions, middleware, attachments,
// microActions, atCompletions, modelPill) since long before this plugin's floor,
// and an older shell reaches `register()` with `contextMenu` absent — so the
// area is `undefined`. Registering against it is the one seam this plugin used
// to use UNGUARDED, and the failure is silent: the app never asks the
// contribution for rows, the menu simply has no suggestions, and everything
// looks like a broken ranker.
//
// The other two seams are detected the same way and are asserted here beside
// it, because all three have to answer the same question — "is this capability
// in the shell I am running on?" — and none of them may answer it by comparing
// VERSION NUMBERS. A dev build can carry the seam without a matching release.
//
// The suite loads the REAL module twice, in two separate sandboxes built by the
// same factory, and the only difference is whether `COMPOSER_AREAS` carries the
// `contextMenu` key:
//
//   1. seam PRESENT  -> exactly one composer.contextMenu registration, with
//                       working items()
//   2. seam ABSENT   -> NO menu registration (and none with an `undefined`
//                       area), register() does not throw, ONE info notice
//                       naming the minimum version, and the rest of the plugin
//                       still registers and still works
//   3. a shell with no notify at all still loads
//   4. the source detects the SEAM, not the version

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

/**
 * `COMPOSER_AREAS` as the released shell exports it — every key EXCEPT
 * `contextMenu`.
 *
 * The seam-less shell is simulated by leaving the key OFF this object, which is
 * exactly what an older `@hermes/plugin-sdk` hands the plugin. Nothing else
 * about the stub changes between the two scenarios.
 */
const RELEASED_AREAS = {
  top: 'composer.top',
  bottom: 'composer.bottom',
  underside: 'composer.underside',
  leading: 'composer.leading',
  actions: 'composer.actions',
  middleware: 'composer.middleware',
  attachments: 'composer.attachments',
  microActions: 'composer.microActions',
  atCompletions: 'composer.atCompletions',
  modelPill: 'composer.modelPill'
}

const SEAMED_AREA = 'composer.contextMenu'

/**
 * Load the real plugin into a fresh sandbox.
 *
 * @param {object} opts
 * @param {boolean} opts.contextMenu  does COMPOSER_AREAS carry the seam?
 * @param {boolean} opts.notify       does the host have `notify` at all?
 */
function load({ contextMenu = true, notify = true } = {}) {
  const hostCalls = { notify: [], setSpellcheck: [], add: [], remove: [], navigate: [] }

  const areas = { ...RELEASED_AREAS }

  if (contextMenu) {
    areas.contextMenu = SEAMED_AREA
  }

  const hostApi = {
    navigate: (to) => hostCalls.navigate.push(to),
    spellcheck: {
      addWord: (w) => { hostCalls.add.push(w); return Promise.resolve(true) },
      removeWord: (w) => { hostCalls.remove.push(w); return Promise.resolve(true) }
    },
    composer: {
      getDraft: () => Promise.resolve(null),
      setDraft: () => Promise.resolve(false),
      setSpellcheck: (sid, on) => { hostCalls.setSpellcheck.push([sid, on]); return Promise.resolve(true) }
    }
  }

  if (notify) {
    hostApi.notify = (msg) => hostCalls.notify.push(msg)
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
    COMPOSER_AREAS: areas,
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

  // No composer and no selection in this sandbox: the plugin resolves its
  // locale from `documentElement.lang`, so nothing here hides the rows under
  // test.
  const fakeDocument = {
    documentElement: { lang: 'en' },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, style: {} }),
    createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => ({ append() {} }),
    createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
    getSelection: () => null,
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

  vm.runInContext(pluginSource + `
    globalThis.__suggestionItems = suggestionItems;
    globalThis.__composerMenuArea = composerMenuArea;
  `, vm.createContext(sandbox), { filename: 'plugin.js' })

  let registrations = 0
  let settingsPages = 0

  function ctxFor() {
    const registered = []
    const pages = []

    const ctx = {
      registered,
      pages,
      storage: {
        _data: {},
        get(key, fallback) { return key in this._data ? this._data[key] : fallback },
        set(key, value) { this._data[key] = value }
      },
      register(c) {
        registrations++
        registered.push(c)
        return () => {
          const i = registered.indexOf(c)
          if (i >= 0) registered.splice(i, 1)
        }
      },
      registerMany(cs) { cs.forEach(c => this.register(c)); return () => {} },
      registerSettingsPage(page) {
        settingsPages++
        pages.push(page)
        return () => {}
      },
      onDispose() {},
      addEventListener() {},
      setTimeout() {},
      setInterval() {}
    }

    return ctx
  }

  return {
    plugin: sandbox.__PLUGIN__,
    sandbox,
    hostCalls,
    areas,
    ctxFor,
    counts: () => ({ registrations, settingsPages })
  }
}

async function main() {
  console.log('=== 1. seam PRESENT: the menu contribution is registered ===')
  {
    const t = load({ contextMenu: true })
    const ctx = t.ctxFor()
    t.plugin.register(ctx)

    const menu = ctx.registered.filter(c => c.area === SEAMED_AREA)
    check('exactly one composer.contextMenu registration', menu.length, 1)
    check('its id', menu[0] && menu[0].id, 'spellcheck-suggestions')
    check('its area is the SDK export, not a literal', menu[0] && menu[0].area, t.areas.contextMenu)
    check('it exposes items()', typeof (menu[0] && menu[0].data && menu[0].data.items), 'function')

    const rows = menu[0].data.items({ word: 'speling', selection: 'speling' })
    check('items() ranks the typo', rows[0] && rows[0].label, 'spelling')
    check('and appends Add to dictionary', rows[rows.length - 1].label, 'Add to dictionary')

    check('no degradation notice is shown', t.hostCalls.notify.length, 0)
    check('composerMenuArea() reports the seam', t.sandbox.__composerMenuArea(), SEAMED_AREA)
  }

  console.log('\n=== 2. seam ABSENT: NO menu registration, and no throw ===')
  const absent = load({ contextMenu: false })
  {
    check('the stub really has no contextMenu key', 'contextMenu' in absent.areas, false)
    check('composerMenuArea() reports nothing', absent.sandbox.__composerMenuArea(), null)

    const ctx = absent.ctxFor()

    let threw = null
    try {
      absent.plugin.register(ctx)
    } catch (err) {
      threw = err && err.message
    }

    check('register() did not throw', threw, null)
    check('NO contribution was filed for the menu area', ctx.registered.filter(c => c.area === SEAMED_AREA).length, 0)
    check('NO contribution was filed for an UNDEFINED area',
      ctx.registered.filter(c => c.area === undefined).length, 0)
    check('nothing even mentions the menu id', ctx.registered.filter(c => c.id === 'spellcheck-suggestions').length, 0)
  }

  console.log('\n=== 3. seam ABSENT: the user is told ONCE, naming the version ===')
  {
    // register() is called again on a fresh ctx — a reload, or a second
    // registration pass. The notice must not repeat.
    const ctx = absent.ctxFor()
    let threw = null
    try {
      absent.plugin.register(ctx)
    } catch (err) {
      threw = err && err.message
    }

    check('the second register() did not throw', threw, null)
    check('still no menu contribution', ctx.registered.filter(c => c.area === SEAMED_AREA).length, 0)
    check('exactly ONE notice across both registrations', absent.hostCalls.notify.length, 1)

    const notice = absent.hostCalls.notify[0] || {}
    check('it is an info notice', notice.kind, 'info')
    check('it names the minimum version', /0\.22\.6/.test(String(notice.message)), true)
    check('it says the app is too old', /too old/i.test(String(notice.message)), true)
    check('it says the suggestions are what is unavailable', /right-click suggestions/i.test(String(notice.message)), true)
    check('it does not claim the whole plugin is broken', /Custom Words/.test(String(notice.message)), true)
  }

  console.log('\n=== 4. seam ABSENT: the REST of the plugin still registers ===')
  {
    const ctx = absent.ctxFor()

    // registered by the first two register() calls; take a fresh module view
    // of the registrations the plugin made on load.
    const fresh = load({ contextMenu: false })
    const c = fresh.ctxFor()
    fresh.plugin.register(c)

    const route = c.registered.find(r => r.area === 'routes')
    const nav = c.registered.find(r => r.area === 'sidebar-nav')

    check('the Custom Words route still registers', !!route, true)
    check('its path', route && route.data && route.data.path, '/spellcheck-dictionary')
    check('it still renders a page component', typeof (route && route.render), 'function')
    check('the sidebar row still registers', !!nav, true)
    check('the sidebar row still points at the page', nav && nav.data && nav.data.path, '/spellcheck-dictionary')

    const page = c.pages.find(p => p.id === 'settings')
    check('the settings page still registers', !!page, true)
    check('with the Custom Words sub-page', page && page.children && page.children[0] && page.children[0].id, 'words')
    check('the sub-page still renders', typeof (page && page.children && page.children[0] && page.children[0].render), 'function')

    // applySpellcheck still runs: the spellcheck seam is detected separately
    // and is PRESENT in this host.
    check('host.composer.setSpellcheck was asked to turn spelling on',
      fresh.hostCalls.setSpellcheck.length > 0 && fresh.hostCalls.setSpellcheck[0][1], true)

    // ... and the dictionary/ranker is unaffected: same rows, same storage write.
    const rows = fresh.sandbox.__suggestionItems('speling', 'en', c.storage)
    check('the dictionary still ranks a typo', rows[0] && rows[0].label, 'spelling')

    const addRow = rows.find(r => r.label === 'Add to dictionary')
    check('the Add to dictionary row is still there', !!addRow, true)
    addRow.onSelect({})

    check('the word still reaches storage',
      (c.storage.get('customWords', {}).en || []).includes('speling'), true)
    check('the add still reports success',
      fresh.hostCalls.notify.some(n => n.kind === 'success' && /speling/.test(n.message)), true)
  }

  console.log('\n=== 5. a shell with NO notify still loads ===')
  {
    const bare = load({ contextMenu: false, notify: false })
    const ctx = bare.ctxFor()

    let threw = null
    try {
      bare.plugin.register(ctx)
    } catch (err) {
      threw = err && err.message
    }

    check('register() did not throw without host.notify', threw, null)
    check('the menu is still skipped', ctx.registered.filter(c => c.area === SEAMED_AREA).length, 0)
    check('the route still registers', ctx.registered.filter(r => r.area === 'routes').length, 1)
  }

  console.log('\n=== 6. the source detects the SEAM, never the VERSION ===')
  {
    const code = stripLiteralsAndComments(source)

    check('composerMenuArea() is defined', /function\s+composerMenuArea\s*\(/.test(code), true)
    check('it tests the contextMenu key', /COMPOSER_AREAS\.contextMenu/.test(code), true)
    check('the registration goes through it', /area\s*:\s*menuArea/.test(code), true)
    check('nothing registers against COMPOSER_AREAS.contextMenu directly',
      /area\s*:\s*COMPOSER_AREAS\.contextMenu/.test(code), false)

    // A version comparison in the guard would be the wrong question: the seam
    // is a property of the export, not of the release string.
    for (const probe of ['ctx.version', 'host.version', 'appVersion', 'getVersion', 'requires_hermes']) {
      check(`the guard does not consult ${probe}`, code.includes(probe), false)
    }

    check('the notice is behind the missing-seam branch', /noticeMenuSeamMissing\s*\(/.test(code), true)
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
