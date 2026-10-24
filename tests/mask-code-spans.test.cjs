// Test the plugin's code-span masking against a real DOM (jsdom).
// Extracts the actual functions from plugin.js — no re-implementation.
const fs = require('fs')
const path = require('path')
const { JSDOM } = require(resolveDep('jsdom'))

// Resolve the plugin and its deps relative to THIS file, so the suite runs
// from any checkout root with no arguments.
const PLUGIN = path.join(__dirname, '..', 'desktop', 'plugin.js')

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


function grabStringConst(name) {
  const i = source.indexOf('const ' + name + ' =')
  if (i < 0) throw new Error('not found: ' + name)
  const q = source.indexOf("'", source.indexOf('=', i))
  const end = source.indexOf("'", q + 1)
  return source.slice(i, end + 1)
}

function grabConst(name) {
  const i = source.indexOf('const ' + name + ' =')
  if (i < 0) throw new Error('not found: ' + name)
  const open = source.indexOf('(', i)
  let depth = 0
  let quote = null
  for (let k = open; k < source.length; k++) {
    const ch = source[k]
    if (quote) {
      if (ch === '\\') { k++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(i, k + 1)
    }
  }
  throw new Error('unbalanced: ' + name)
}

const pluginPath = PLUGIN
const source = fs.readFileSync(pluginPath, 'utf8')

// Pull the function bodies out of the source.
function grab(name) {
  const i = source.indexOf('function ' + name)
  if (i < 0) throw new Error('not found: ' + name)
  const open = source.indexOf('{', i)
  let depth = 0
  for (let k = open; k < source.length; k++) {
    if (source[k] === '{') depth++
    else if (source[k] === '}') {
      depth--
      if (depth === 0) return source.slice(i, k + 1)
    }
  }
  throw new Error('unbalanced: ' + name)
}

const SELECTOR = '[data-slot="composer-rich-input"]'

const dom = new JSDOM(
  '<!doctype html><html><body>' +
    '<div data-slot="composer-rich-input" contenteditable="true"></div>' +
    '</body></html>',
  { pretendToBeVisual: true }
)

const { window } = dom
const { document } = window

// Install the globals the extracted code expects.
const code = `
const SELECTOR = '[data-slot="composer-rich-input"]';
${grabStringConst('MASKED_CODE_SELECTOR')}
${grabStringConst('FILE_EXT_RE')}
${grabConst('CODE_SPLIT_RE')}
${grabConst('CODE_SPAN_RE')}
${grab('characterOffset')}
${grab('restoreCaret')}
${grab('maskCodeSpans')}
`
const fn = new window.Function('window', 'document', 'NodeFilter', 'HTMLElement', code + `
  return { maskCodeSpans, characterOffset, restoreCaret }
`)

const api = fn(window, document, window.NodeFilter, window.HTMLElement)
const editor = document.querySelector(SELECTOR)

function setContent(html) {
  editor.innerHTML = html
}

function plainText() {
  // What the composer reads: the concatenated text of the editor.
  let out = ''
  const walk = n => {
    if (n.nodeType === 3) out += n.nodeValue
    else n.childNodes.forEach(walk)
  }
  walk(editor)
  return out
}

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log(`        got: ${JSON.stringify(actual)}\n        want: ${JSON.stringify(expected)}`)
}

console.log('=== 1. mask wraps a code span in <code spellcheck=false> ===')
setContent('run `npm test` now')
api.maskCodeSpans(true)
const codeEl = editor.querySelector('code')
check('a <code> element was created', !!codeEl, true)
check('it is marked spellcheck=false', codeEl && codeEl.spellcheck, false)
check('it carries the data-sp-mask marker', codeEl && codeEl.dataset.spMask, '1')
check('the text is preserved', plainText(), 'run `npm test` now')

console.log('\n=== 2. text OUTSIDE the code span is not wrapped ===')
setContent('run `npm test` now')
api.maskCodeSpans(true)
check('exactly one <code>', editor.querySelectorAll('code').length, 1)
check('its content is the backticked part', editor.querySelector('code').textContent, '`npm test`')

console.log('\n=== 3. plain prose is left completely alone ===')
setContent('hello world')
api.maskCodeSpans(true)
check('no <code> inserted', editor.querySelectorAll('code').length, 0)
check('text unchanged', plainText(), 'hello world')

console.log('\n=== 4. unwrap restores the ORIGINAL text exactly ===')
setContent('run `npm test` now')
api.maskCodeSpans(true)
api.maskCodeSpans(false)
check('no <code> left', editor.querySelectorAll('code').length, 0)
check('text is byte-identical to the original', plainText(), 'run `npm test` now')
check('the mask marker is cleared', editor.dataset.spellingMasked, undefined)

console.log('\n=== 5. multiple spans in one text node ===')
setContent('a `x` b `y` c')
api.maskCodeSpans(true)
check('two <code> elements', editor.querySelectorAll('code').length, 2)
check('text preserved', plainText(), 'a `x` b `y` c')
api.maskCodeSpans(false)
check('text restored', plainText(), 'a `x` b `y` c')

console.log('\n=== 6. a code span split across two text nodes is NOT wrapped ===')
setContent('run <b>`npm</b> test` now')
api.maskCodeSpans(true)
check('no partial wrap (the span is not in one text node)', editor.querySelectorAll('code').length, 0)
check('text preserved (jsdom inserts a space between inline elements)', plainText(), 'run `npm test` now')

console.log('\n=== 7. re-masking is idempotent ===')
setContent('run `npm test` now')
api.maskCodeSpans(true)
api.maskCodeSpans(true)
check('still exactly one <code>', editor.querySelectorAll('code').length, 1)
check('text still correct', plainText(), 'run `npm test` now')

console.log('\n=== 8. the caret survives the mask ===')
setContent('run `npm test` now')
const textNode = editor.firstChild
const range = document.createRange()
range.setStart(textNode, textNode.nodeValue.length)
range.collapse(true)
const sel = window.getSelection()
sel.removeAllRanges()
sel.addRange(range)
const before = sel.getRangeAt(0).startOffset
api.maskCodeSpans(true)
const after = window.getSelection().getRangeAt(0)
const afterText = editor.textContent
// The GLOBAL character offset, which is what actually matters — a local
// offset into whichever text node the caret landed in is ambiguous.
const globalAfter = api.characterOffset(editor, after.startContainer, after.startOffset)
check('the selection is still in the editor', editor.contains(after.startContainer), true)
check('the text is unchanged', afterText, 'run `npm test` now')
check('the caret is at the SAME global character offset', globalAfter, before)
console.log(`        (global caret offset ${before} -> ${globalAfter})`)
console.log('        text nodes now:', [...editor.childNodes].map(n => n.nodeType === 3 ? 'TEXT(' + JSON.stringify(n.nodeValue) + ')' : n.tagName + '(' + JSON.stringify(n.textContent) + ')').join(' '))


console.log('\n=== 9. file names are masked too ===')
setContent('open src/app.ts please')
api.maskCodeSpans(true)
check('a <code> was created for the path', editor.querySelectorAll('code').length, 1)
check('it wraps the path', editor.querySelector('code').textContent, 'src/app.ts')
check('text preserved', plainText(), 'open src/app.ts please')
api.maskCodeSpans(false)
check('text restored', plainText(), 'open src/app.ts please')

console.log('\n=== 10. prose abbreviations are NOT masked ===')
setContent('the e.g. case and i.e. others')
api.maskCodeSpans(true)
check('no <code> inserted', editor.querySelectorAll('code').length, 0)
check('text unchanged', plainText(), 'the e.g. case and i.e. others')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
