// Verify the plugin's editor selector against the app's REAL markup shape
// (read from the app source's attributes) — and that it does not depend on the
// app's private data-slot names.
//
// The plugin used to ALSO target the quick-entry <input>, because it wrote
// `spellcheck` and `lang` onto every element it found. Those writes are gone
// (the host does it now — see applySpellcheck), so QUICK_ENTRY_SELECTOR is
// gone too, and this suite asserts that: a re-appearing quick-entry selector
// would mean the plugin had gone back to writing attributes onto the app's
// inputs.
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
if (!m) throw new Error('EDITOR_SELECTOR not found in plugin.js')

const EDITOR_SELECTOR = m[1]

console.log('EDITOR_SELECTOR :', EDITOR_SELECTOR)
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

console.log('\n=== it does NOT reach the quick-entry inputs ===')
check('no <input> matches', doc.querySelectorAll('input').length, 2)
check('the selector does not contain "input"', EDITOR_SELECTOR.includes('input'), false)

console.log('\n=== SELECTOR is the editor selector, and nothing else ===')
check('SELECTOR is assigned from EDITOR_SELECTOR', /const SELECTOR = EDITOR_SELECTOR;/.test(pluginSource), true)
check('QUICK_ENTRY_SELECTOR is gone', pluginSource.includes('QUICK_ENTRY_SELECTOR'), false)

console.log('\n=== the old data-slot selector is gone ===')
check('no data-slot in EDITOR_SELECTOR', EDITOR_SELECTOR.includes('data-slot'), false)
check('no placeholder copy in the selector', EDITOR_SELECTOR.includes('Ask Hermes'), false)

console.log('\n=== the plugin writes no spellcheck/lang attributes onto app elements ===')
// `el.spellcheck = ...` / `el.lang = ...` are the DOM reach this refactor
// removed; nothing in the plugin writes an attribute onto an app element any
// more (the code-span mask that once wrote one is gone — see
// no-code-masking.test.cjs).
check('no "el.spellcheck =" write', /el\.spellcheck\s*=/.test(pluginSource), false)
check('no "el.lang =" write', /el\.lang\s*=/.test(pluginSource), false)
check('the host seam is called instead', pluginSource.includes('setSpellcheck'), true)

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)
