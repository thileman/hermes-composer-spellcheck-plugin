
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
  globalThis.__c = EMBEDDED_CANDS;
  globalThis.__w = EMBEDDED_WORDS;
`, ctx, { filename: 'plugin.js' })

const c = ctx.__c
console.log('--- every cands key that starts with "eng" ---')
for (const [k, v] of c) {
  if (k.startsWith('eng')) console.log('   ', JSON.stringify(k), '->', JSON.stringify(v))
}
console.log()
console.log('--- every cands key that starts with "mond" ---')
for (const [k, v] of c) {
  if (k.startsWith('mond')) console.log('   ', JSON.stringify(k), '->', JSON.stringify(v))
}
