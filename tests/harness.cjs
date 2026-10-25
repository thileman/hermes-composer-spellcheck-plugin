// Shared loader for the suites added with the doc-truth and locale fixes.
//
// It is deliberately the same shape as the loader in menu-case.test.cjs: the
// real desktop/plugin.js is read, its three imports are wired to stubs, and
// the module is run in a vm context so the suites exercise the shipped code
// rather than a copy of it. The extra bit here is the CONTROLS a test needs:
//
//   setFetch(fn)      the fetch the dictionary loader sees
//   notifyCalls       every host.notify(), in order
//   fetchCalls        every URL the loader asked for
//   __useState        swapped for a stateful hook by the page tests
//   load({ composerAreas })  extra COMPOSER_AREAS keys the SDK stub exports, so
//                     a suite can simulate a shell that carries a seam the
//                     released one does not (e.g. `nonProse`) — or, by leaving
//                     one out, a shell that predates it
//
// This file is not named *.test.cjs, so scripts/run-tests.cjs does not run it
// as a suite of its own.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')

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

function load(opts = {}) {
  const source = fs.readFileSync(PLUGIN, 'utf8')

  const notifyCalls = []
  const fetchCalls = []
  const addWordCalls = []
  const removeWordCalls = []

  const document = {
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
    COMPOSER_AREAS: { contextMenu: 'composer.contextMenu', ...(opts.composerAreas || {}) },
    EmptyState: 'EmptyState',
    Input: 'Input',
    ListRow: 'ListRow',
    Switch: 'Switch',
    ToggleRow: 'ToggleRow',
    SearchField: 'SearchField',
    host: {
      notify: msg => notifyCalls.push(msg),
      navigate() {},
      spellcheck: {
        addWord: w => { addWordCalls.push(w); return Promise.resolve(true) },
        removeWord: w => { removeWordCalls.push(w); return Promise.resolve(true) }
      },
      composer: {}
    },
    pluginSettingsHref: () => '/settings',
    // useValue is not a hook: it is the SDK's subscription helper, which is
    // why swapping useState below cannot disturb it.
    useValue: a => a.get(),
    ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebar-nav'
  }

  const sandbox = {
    console,
    __SDK__: SDK,
    __REACT__: { useState: v => sandbox.__useState(v) },
    __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
    document,
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
    TextEncoder,
    TextDecoder,
    Uint8Array,
    // The default hook is inert, as in the other suites; the page test swaps
    // in a stateful one so a setter actually re-renders the component.
    __useState: (initial) => [initial, () => {}],
    __fetch: async () => ({ ok: false, status: 404, text: async () => '' })
  }

  sandbox.fetch = (...a) => {
    fetchCalls.push(a[0])
    return sandbox.__fetch(...a)
  }

  sandbox.globalThis = sandbox

  const pluginSource = source
    .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, n) => `const {${n}} = __SDK__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, n) => `const {${n}} = __REACT__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, n) => `const {${n}} = __JSX__;`)
    .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

  const context = vm.createContext(sandbox)

  // Exported for the suites. Guarded: a helper that does not exist yet (the
  // state before a fix) must make the suite fail on its assertions, not on a
  // ReferenceError at load time.
  vm.runInContext(pluginSource + `
    const __g = (name) => (typeof globalThis[name] === 'undefined' ? null : globalThis[name]);
    globalThis.__activeLocale = __g('activeLocale');
    globalThis.__pageLocale = __g('pageLocale');
    globalThis.__customWordKey = __g('customWordKey');
    globalThis.__dictionaryPage = __g('DictionaryPage');
    globalThis.__ensureLocale = __g('ensureLocale');
    globalThis.__resolveLocale = __g('resolveLocale');
    globalThis.__rankFor = __g('rankFor');
  `, context, { filename: 'plugin.js' })

  const plugin = sandbox.__PLUGIN__

  if (!plugin || typeof plugin.register !== 'function') {
    console.error('the plugin did not export a register()')
    process.exit(1)
  }

  return {
    sandbox,
    plugin,
    source,
    document,
    notifyCalls,
    fetchCalls,
    addWordCalls,
    removeWordCalls,
    setFetch: (fn) => { sandbox.__fetch = fn }
  }
}

/** A stub ctx with a real storage map, and the list of registrations made. */
function makeCtx(storageData) {
  const registered = []

  return {
    registered,
    storage: {
      _data: storageData || {},
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

/** Walk a jsx() tree: every node and every primitive child. */
function walk(node, visit) {
  if (node == null) {
    return
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visit)
    }

    return
  }

  if (typeof node !== 'object') {
    visit(node)
    return
  }

  visit(node)

  const props = node.p || {}

  if ('children' in props) {
    walk(props.children, visit)
  }
}

/** Every string a tree renders. */
function textOf(tree) {
  const out = []

  walk(tree, (n) => {
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n))
    }
  })

  return out.join(' ')
}

/** Every node whose type is `t` and whose props match `props`. */
function findByType(tree, t, props) {
  const out = []

  walk(tree, (n) => {
    if (n && typeof n === 'object' && n.t === t) {
      const p = n.p || {}
      const ok = Object.entries(props || {}).every(([k, v]) => p[k] === v)

      if (ok) {
        out.push(n)
      }
    }
  })

  return out
}

module.exports = { load, makeCtx, walk, textOf, findByType, resolveDep }
