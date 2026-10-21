// Verify the plugin's editor selectors against the app's REAL markup shape
// (read from the app source's attributes) — and that they no longer depend
// on the app's private data-slot names.
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


const pluginSource = fs.readFileSync(PLUGIN, 'utf8')

const m = pluginSource.match(/const EDITOR_SELECTOR = '([^']*)'/)
const q = pluginSource.match(/const QUICK_ENTRY_SELECTOR = '([^']*)'/)
if (!m || !q) throw new Error('selectors not found in plugin.js')

const EDITOR_SELECTOR = m[1]
const QUICK_ENTRY_SELECTOR = q[1]
const SELECTOR = `${EDITOR_SELECTOR}, ${QUICK_ENTRY_SELECTOR}`

console.log('EDITOR_SELECTOR      :', EDITOR_SELECTOR)
console.log('QUICK_ENTRY_SELECTOR :', QUICK_ENTRY_SELECTOR)
console.log()

// The app's real markup, per apps/desktop/src/app/chat/composer/index.tsx
// (aria-label, autoCapitalize, contentEditable, data-slot, dir, role,
//  spellCheck) and user-edit-composer.tsx.
const html = `<!doctype html><html><body>
  <div class="relative">
    <div aria-disabled="false" aria-label="Message" autoCapitalize="off"
         autoCorrect="off" class="min-h-[1.625rem]" contenteditable="true"
         data-placeholder="Ask Hermes" data-slot="composer-rich-input" dir="ltr"
         role="textbox" spellcheck="false" tabindex="0"></div>
  </div>
  <div contenteditable="true" role="textbox" spellcheck="false"
       aria-label="Message" data-slot="composer-rich-input"></div>
  <input type="text" placeholder="Ask Hermes" />
  <input placeholder="Ask Hermes" />
  <div role="textbox" data-testid="not-a-composer"></div>
</body></html>`

const dom = new JSDOM(html, { pretendToBeVisual: true })
const doc = dom.window.document

const editors = doc.querySelectorAll(EDITOR_SELECTOR)
const quick = doc.querySelectorAll(QUICK_ENTRY_SELECTOR)
const all = doc.querySelectorAll(SELECTOR)

let fails = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${actual}, want ${expected})`)
}

console.log('=== the editor selector finds the contentEditable composer divs ===')
check('both contentEditable role=textbox divs', editors.length, 2)
check('they are the composer + message editor', [...editors].every(e => e.getAttribute('contenteditable') === 'true'), true)
check('it does NOT match a role=textbox without contentEditable', [...editors].some(e => e.getAttribute('data-testid')), false)

console.log('\n=== the quick-entry selector finds the inputs ===')
check('both inputs', quick.length, 2)

console.log('\n=== the combined selector ===')
check('4 elements total', all.length, 4)

console.log('\n=== the old data-slot selector is gone ===')
check('no data-slot in EDITOR_SELECTOR', EDITOR_SELECTOR.includes('data-slot'), false)
check('no data-slot in QUICK_ENTRY_SELECTOR', QUICK_ENTRY_SELECTOR.includes('data-slot'), false)
check('no placeholder copy in the selectors', QUICK_ENTRY_SELECTOR.includes('Ask Hermes'), false)

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)
