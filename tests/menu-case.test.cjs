
// The RIGHT-CLICK path, end to end: the plugin's own suggestion ranker and
// its own menu injection, against a DOM that stands in for the app's Radix
// menu. Both halves used to be broken at once, so both are asserted here.
//
//   1. a lowercase proper noun ("english") must be flagged, and the
//      suggestion must be the CAPITALISED form -- the one Chromium accepts
//   2. the menu must actually contain that row, and clicking it must pass
//      the capitalised word to the replace handler
//   3. an ordinary typo must still be corrected to the ordinary word
//
// The fake DOM must make its elements REAL `HTMLElement` instances: the
// plugin guards on `menu instanceof HTMLElement`, and a fake that is not one
// is rejected -- which is how this harness first reported a false failure.
const fs = require('fs'), vm = require('vm')
const path = require('path')
const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

const SDK = { atom: i => ({ get: () => i, set: () => {}, listen: () => () => {} }), host: { notify(){}, navigate(){} },
  useValue: a => a.get(), Button:'B', Codicon:'C', EmptyState:'E', Input:'I', ListRow:'L', Switch:'S',
  ToggleRow:'T', SearchField:'S', pluginSettingsHref: () => '/settings', ROUTES_AREA:'r', SIDEBAR_NAV_AREA:'s' }

// A DOM just rich enough for the injection path: a menu element with a
// menuitem child, and a document that can find them.
function mkEl(tag) {
  const el = {
    tagName: (tag||'div').toUpperCase(), dataset:{}, style:{cssText:''}, children:[],
    className:'', textContent:'', attrs:{},
    focus(){}, append(...c){ this.children.push(...c); }, remove(){ this.removed = true; },
    setAttribute(k,v){ this.attrs[k]=v; }, getAttribute(k){ return this.attrs[k]; },
    removeAttribute(k){ delete this.attrs[k]; },
    listeners: {},
    addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(){}, dispatchEvent(){ return true; },
    click(){ for (const fn of (this.listeners.click || [])) fn({ preventDefault(){}, stopPropagation(){} }); },
    insertBefore(node){ this.children.unshift(node); }, closest(){ return null; },
    querySelector(sel){ return this._q(sel); }, querySelectorAll(sel){ return this._qa(sel); },
    _q(sel){
      for (const c of this.children) {
        if (sel === '[role="menuitem"]' && c.attrs && c.attrs.role === 'menuitem') return c;
        if (sel.includes('menuitem') && c.attrs && c.attrs.role === 'menuitem') return c;
        const hit = c._q ? c._q(sel) : null;
        if (hit) return hit;
      }
      return null;
    },
    _qa(sel){
      const out = [];
      for (const c of this.children) {
        if (sel.includes('menuitem') && c.attrs && c.attrs.role === 'menuitem') out.push(c);
        if (c._qa) out.push(...c._qa(sel));
      }
      return out;
    },
    getBoundingClientRect(){ return {top:0,left:0,right:10,bottom:10,width:10,height:10}; }
  };
  return el;
}

const menuItem = mkEl('div')
menuItem.attrs.role = 'menuitem'
menuItem.className = 'app-menu-item'
const menu = mkEl('div')
menu.attrs.role = 'menu'
menu.children.push(menuItem)

const sandbox = { console, __SDK__:SDK, __REACT__:{ useState: v => [v, ()=>{}] },
  __JSX__:{ jsx:(t,p)=>({t,p}), jsxs:(t,p)=>({t,p}), Fragment:'f' },
  document:{ documentElement:{lang:'en'},
    querySelector: sel => (sel.includes('menu') ? menu : null),
    querySelectorAll: () => [], createElement: mkEl,
    createTreeWalker:()=>({nextNode:()=>null}), createDocumentFragment:()=>({append(){}}),
    createRange:()=>({setStart(){},setEnd(){},selectNodeContents(){},toString:()=>''}),
    addEventListener(){}, body:{dispatchEvent(){}} },
  window:{addEventListener(){},removeEventListener(){}}, navigator:{language:'en'},
  NodeFilter:{SHOW_TEXT:4}, HTMLElement: function(){}, Element: function(){},
  MutationObserver: function(){},
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, URL, Blob: function(){},
  fetch: async () => ({ ok:false, status:404, text: async () => '' }),
  TextEncoder, TextDecoder, Uint8Array,
  getComputedStyle: () => ({ paddingTop:'4px', paddingRight:'8px', paddingBottom:'4px', paddingLeft:'8px',
                            borderTopLeftRadius:'5px', fontSize:'13px', fontFamily:'inherit', color:'inherit' })
}
sandbox.globalThis = sandbox
// The plugin does `menu instanceof HTMLElement`; make the fake elements
// genuine instances so the guard behaves as it does in the app.
function FakeHTMLElement() {}
sandbox.HTMLElement = FakeHTMLElement
for (const e of [menu, menuItem]) Object.setPrototypeOf(e, FakeHTMLElement.prototype)
for (const e of [menu, menuItem]) {
  const proto = FakeHTMLElement.prototype
  for (const k of Object.keys(e)) if (!(k in proto)) proto[k] = e[k]
}

const ps = source
  .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, n) => `const {${n}} = __SDK__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, n) => `const {${n}} = __REACT__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, n) => `const {${n}} = __JSX__;`)
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')

const ctx = vm.createContext(sandbox)
vm.runInContext(ps + `
  globalThis.__inject = injectSuggestions;
  globalThis.__suggest = suggest;
  globalThis.__lookup = lookup;
  globalThis.__w = EMBEDDED_WORDS;
  globalThis.__c = EMBEDDED_CANDS;
  globalThis.__m = EMBEDDED_MIXED;
`, ctx, { filename: 'plugin.js' })

const entry = { words: ctx.__w, cands: ctx.__c, mixed: ctx.__m }

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------
let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

const dict = { words: ctx.__w, cands: ctx.__c, mixed: ctx.__m }

console.log('=== 1. a lowercase proper noun is flagged, and offered capitalised ===')
check('"english" is NOT correctly spelled', ctx.__lookup(dict, 'english'), false)
check('"English" IS correctly spelled', ctx.__lookup(dict, 'English'), true)
check('"english" is not a known word', ctx.__lookup(dict, 'english'), false)

const englishList = ctx.__suggest(dict, 'english')
check('"English" is offered first', englishList[0], 'English')
check('the lowercase form is NOT offered', englishList.includes('english'), false)

console.log('\n=== 2. the same for other proper nouns ===')
for (const [typed, want] of [['monday', 'Monday'], ['london', 'London'], ['german', 'German']]) {
  const list = ctx.__suggest(dict, typed)
  check(`"${typed}" offers "${want}" first`, list[0], want)
}

console.log('\n=== 3. an ordinary typo is still corrected to the ordinary word ===')
check('"speling" offers "spelling" first', ctx.__suggest(dict, 'speling')[0], 'spelling')
check('"hermas" offers a capitalised proper noun', /^[A-Z]/.test(ctx.__suggest(dict, 'hermas')[0]), true)
check('"hermes" is never offered', ctx.__suggest(dict, 'hermas').includes('hermes'), false)

console.log('\n=== 4. the menu really contains the row, and clicking it works ===')
for (const [typed, want] of [['english', 'English'], ['monday', 'Monday']]) {
  const list = ctx.__suggest(dict, typed)
  let picked = null
  const ok = ctx.__inject(typed, list, (w) => { picked = w }, () => {})
  const host = menu.children[0]
  const rows = (host && host.children) ? host.children.filter(c => c.attrs && c.attrs.role === 'menuitem') : []
  const labels = rows.map(r => r.textContent)

  check(`"${typed}" injected rows`, ok, true)
  check(`"${want}" is the first row`, labels[0], want)
  check(`"${want}" is in the menu`, labels.includes(want), true)

  // Click it: the row's handler must hand the CAPITALISED word back.
  if (rows[0] && rows[0].click) {
    rows[0].click()
  } else if (rows[0] && rows[0].listeners) {
    for (const fn of rows[0].listeners.click || []) fn({ preventDefault(){}, stopPropagation(){} })
  }
  check(`clicking it replaces the word with "${want}"`, picked, want)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
