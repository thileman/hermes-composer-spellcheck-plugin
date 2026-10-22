
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
  globalThis.__c = EMBEDDED_CANDS; globalThis.__w = EMBEDDED_WORDS;
  globalThis.__ed = editDistance;
`, ctx, { filename: 'plugin.js' })

const c = ctx.__c
const target = 'english'
const canonical = c.get(target)
console.log('  canonical for ' + JSON.stringify(target) + ':', JSON.stringify(canonical))
console.log('  canonical.toLowerCase() === target ?', canonical.toLowerCase() === target)
console.log('  -> so the candidate IS skipped. But it should NOT be:')
console.log('     the user typed "english", the dictionary spells it "English".')
console.log()
console.log('  mask for "english":', ctx.__w.get('english'), '  (6 = TITLE|UPPER)')
console.log('  is "english" a legal spelling of it?  LOWERCASE bit set?', (ctx.__w.get('english') & 1) !== 0)
console.log()
console.log('  The skip is right for a word the user spelled correctly, but WRONG')
console.log('  when the user spelled it in a form the dictionary does not allow.')
console.log()
console.log('  The right test: is the TARGET a legal spelling of THIS word?')
console.log('  english is NOT legal (no LOWERCASE bit) -> keep the candidate.')
console.log()
const mask = ctx.__w.get(target)
console.log('  verify: maskAllows-equivalent for "english" against mask', mask, '->', (mask & 1) !== 0 ? 'legal' : 'NOT legal')
