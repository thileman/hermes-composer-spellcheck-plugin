// The plugin must not reach into the app's DOM at all.
//
// It USED to: the code-span mask injected <code> wrappers into the composer
// and moved the caret, and the locale lookup read `lang` off the composer
// element. Both are gone (the maintainer asked for the first; the second was
// always dead, because the composer sets no `lang`).
//
// So the selector that served them is gone too, and this suite is what keeps
// it gone. It also pins the app's REAL markup shape, because the moment a
// core-owned seam (composer.nonProse) needs the editor element, the selector
// has to be right the first time — see the `composer.nonProse` request
// upstream, #144007.

const fs = require('fs')
const path = require('path')
const { JSDOM } = require(resolveDep('jsdom'))

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

const pluginSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'plugin.js'), 'utf8')

let fails = 0
const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${actual}, want ${expected})`)
}

console.log('=== the plugin queries NO element ===')
check('no querySelector', /querySelector(All)?\(/.test(pluginSource), false)
check('no getElementById', /getElementById\(/.test(pluginSource), false)
check('no createElement', /createElement\(/.test(pluginSource), false)
check('no createTreeWalker', /createTreeWalker\(/.test(pluginSource), false)
check('no createDocumentFragment', /createDocumentFragment\(/.test(pluginSource), false)
check('no getSelection', /getSelection\(/.test(pluginSource), false)
check('no editor selector constant', /EDITOR_SELECTOR/.test(pluginSource), false)
check('no "SELECTOR = " alias', /const SELECTOR\s*=/.test(pluginSource), false)
check('no quick-entry selector', /QUICK_ENTRY_SELECTOR/.test(pluginSource), false)

console.log('\n=== the app\'s REAL composer markup is still what the plugin targets ===')
// The app's composer is a contenteditable div with role="textbox" and an
// aria-label — public accessibility attributes, not private data-slot names.
// This is the shape the composer.nonProse request will need.
const html = `<!doctype html><html><body>
  <div aria-disabled="false" aria-label="Message" autoCapitalize="off"
       autoCorrect="off" class="min-h-[1.625rem]" contenteditable="true"
       data-placeholder="Ask Hermes" data-slot="composer-rich-input" dir="ltr"
       role="textbox" spellcheck="false" tabindex="0"></div>
  <div contenteditable="true" role="textbox" spellcheck="false"
       aria-label="Message" data-slot="composer-rich-input"></div>
  <input type="text" placeholder="Ask Hermes" />
  <div role="textbox" data-testid="not-a-composer"></div>
</body></html>`

const dom = new JSDOM(html, { pretendToBeVisual: true })
const doc = dom.window.document
const editor = '[role="textbox"][contenteditable="true"], [role="textbox"][contenteditable=""]'

const editors = doc.querySelectorAll(editor)
check('the composer + message editor are found', editors.length, 2)
check('a role=textbox without contentEditable is NOT', [...editors].some(e => e.getAttribute('data-testid')), false)
check('the quick-entry input is NOT reached', doc.querySelectorAll('input').length, 1)

console.log('\n=== the plugin writes no spellcheck/lang attributes onto app elements ===')
check('no "el.spellcheck =" write', /el\.spellcheck\s*=/.test(pluginSource), false)
check('no "el.lang =" write', /el\.lang\s*=/.test(pluginSource), false)
check('the host seam is called instead', pluginSource.includes('setSpellcheck'), true)

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)
