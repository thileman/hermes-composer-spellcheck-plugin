
const fs = require('fs'), vm = require('vm')
const src = fs.readFileSync(process.env.SC_PLUGIN, 'utf8')
const SDK = { atom: i => ({ get: () => i, set: () => {}, listen: () => () => {} }), host: { notify(){}, navigate(){} },
  useValue: a => a.get(), Button:'B', Codicon:'C', EmptyState:'E', Input:'I', ListRow:'L', Switch:'S',
  ToggleRow:'T', SearchField:'S', pluginSettingsHref: () => '/settings', ROUTES_AREA:'r', SIDEBAR_NAV_AREA:'s' }
const el = () => ({ dataset:{}, spellcheck:false, style:{cssText:''}, focus(){}, append(){}, setAttribute(){}, remove(){}, closest:()=>null })
const sandbox = { console, __SDK__:SDK, __REACT__:{ useState: v => [v, ()=>{}] },
  __JSX__:{ jsx:(t,p)=>({t,p}), jsxs:(t,p)=>({t,p}), Fragment:'f' },
  document:{ documentElement:{lang:'en'}, querySelector:()=>null, querySelectorAll:()=>[], createElement:el,
    createTreeWalker:()=>({nextNode:()=>null}), createDocumentFragment:()=>({append(){}}),
    createRange:()=>({setStart(){},setEnd(){},selectNodeContents(){},toString:()=>''}),
    addEventListener(){}, body:{dispatchEvent(){}} },
  window:{addEventListener(){},removeEventListener(){}}, navigator:{language:'en'},
  NodeFilter:{SHOW_TEXT:4}, HTMLElement:function(){}, Element:function(){}, MutationObserver:function(){},
  setTimeout:()=>0, clearTimeout:()=>0, setInterval:()=>0, clearInterval:()=>{},
  requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{}, URL, Blob:function(){},
  fetch: async () => ({ ok:false, status:404, text: async () => '' }),
  TextEncoder, TextDecoder, Uint8Array }
sandbox.globalThis = sandbox
const ps = src
  .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/, (_, n) => `const {${n}} = __SDK__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/, (_, n) => `const {${n}} = __REACT__;`)
  .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/, (_, n) => `const {${n}} = __JSX__;`)
  .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {')
const ctx = vm.createContext(sandbox)
vm.runInContext(ps + `
  globalThis.__w = EMBEDDED_WORDS; globalThis.__c = EMBEDDED_CANDS; globalThis.__m = EMBEDDED_MIXED;
  globalThis.__stems = parseStems(EMBEDDED_DIC);
`, ctx, { filename: 'plugin.js' })

const w = ctx.__w, c = ctx.__c
console.log('--- masks and canonical spellings ---')
for (const k of ['english','monday','hermes','spelling','cat','march','london']) {
  console.log('  ' + k.padEnd(9), 'mask=' + String(w.get(k)).padEnd(3), 'canonical=' + JSON.stringify(c.get(k)))
}
console.log()
console.log('--- is the key even present? ---')
for (const k of ['english','monday','hermes','spelling']) {
  console.log('  ' + k.padEnd(9), 'in words:', w.has(k), ' in cands:', c.has(k))
}
console.log()
console.log('--- what does the upstream stem look like? ---')
const stems = ctx.__stems
for (const k of ['English','Monday','Hermes','spelling']) {
  console.log('  ' + k.padEnd(9), 'flags=' + JSON.stringify(stems.get(k)))
}
