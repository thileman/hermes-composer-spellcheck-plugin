// The code-span MASKING is GONE, and must stay gone.
//
// The maintainer's review removed the feature for this listing: it inserted
// the plugin's own <code> nodes into the composer's DOM and moved the caret,
// which a Desktop plugin may not do — off by default and disclosed or not.
//
// It came back the only way it legitimately could: as a DECLARATION through the
// `composer.nonProse` seam (upstream #144007), where the plugin hands over
// offsets into the draft and the app renders and owns the wrapper. So the
// detection constants (`FILE_EXT_RE`, `CODE_SPAN_RE`) and the
// `excludeCodeSpans` preference are legitimately present again — that half is
// driven and pinned by tests/code-span-ranges.test.cjs.
//
// What THIS suite asserts is the half that must never return: the DOM surgery.
// A re-added maskCodeSpans, a re-added `data-sp-mask` write, a re-added
// characterOffset/restoreCaret caret dance, a re-added input/focusout listener
// that rewrites the composer, or any createElement/createTreeWalker/
// createDocumentFragment/getSelection call fails here. That is the point: the
// previous suite drove the feature and would have kept passing while the plugin
// did something the surface forbids.
//
// It also keeps the positive half honest: with no masking there is nothing for
// the suggestion path to suppress, so the menu still offers rows.

const fs = require('fs')
const path = require('path')
const { load, makeCtx, findByType, textOf } = require('./harness.cjs')
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

const { sandbox, plugin, source } = load()
const code = stripLiteralsAndComments(source)

let failures = 0
function absent(label, needle) {
  const ok = !source.includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (must NOT contain ${JSON.stringify(needle)})`)
}
function absentInCode(label, needle) {
  const ok = !code.includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (must NOT contain ${JSON.stringify(needle)} in code)`)
}
function presentInCode(label, needle) {
  const ok = code.includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (must contain ${JSON.stringify(needle)} in code)`)
}
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

console.log('=== 1. the DOM-mask functions and constants are gone ===')
// CODE_SPLIT_RE stays on this list although the detection is back: it was the
// CAPTURING copy used to `split()` a text node losslessly around the plugin's
// own wrappers. Nothing splits a node any more, so it must not come back.
for (const symbol of ['maskCodeSpans', 'caretInMaskedCode', 'MASKED_CODE_SELECTOR', 'characterOffset', 'restoreCaret', 'CODE_SPLIT_RE']) {
  absent(`"${symbol}" is gone`, symbol)
}

console.log('\n=== 2. the wrapper marker is gone; the feature is DATA now ===')
absent('no data-sp-mask marker', 'data-sp-mask')
absentInCode('no dataset.spMask write', 'spMask')
// The replacement, as the maintainer asked for it: a declared provider. The
// behaviour is driven by tests/code-span-ranges.test.cjs; here it is only the
// contract that it cannot turn back into node surgery.
check('the non-prose provider registers and exposes ranges()',
  /id:\s*'code-spans'/.test(source) && /ranges:\s*\(\{\s*text\s*\}\s*=\s*\{\}\)\s*=>/.test(source), true)
presentInCode('the ranges are computed from a string', 'codeSpanRanges(text)')

console.log('\n=== 3. nothing rewrites the composer on input or focusout ===')
// The mask was re-applied on these two events, because the composer's
// reconciler strips foreign nodes on every keystroke. With the mask gone there
// is no reason for the plugin to listen to either, and a listener that fires
// maskCodeSpans() again would show up here first.
absent("no 'input' listener", "addEventListener(document, 'input'")
absent("no 'focusout' listener", "addEventListener(document, 'focusout'")
check('the focusin re-assert is still registered', source.includes("addEventListener(document, 'focusin'"), true)

console.log('\n=== 4. the plugin injects no nodes and reads no caret ===')
absentInCode('no createElement', 'createElement')
absentInCode('no dataset write', 'dataset')
absent('no selection read', 'getSelection')
absentInCode('no tree walker', 'createTreeWalker')
absentInCode('no document fragment', 'createDocumentFragment')
absent('no <code> selector anywhere', 'code[')

console.log('\n=== 5. the masking suite itself is gone ===')
check('tests/mask-code-spans.test.cjs is deleted',
  fs.existsSync(path.join(__dirname, 'mask-code-spans.test.cjs')), false)

console.log('\n=== 6. on a shell with NO seam, the settings page has no code-span row ===')
// The harness's SDK carries `contextMenu` only — no `composer.nonProse` — which
// is every released shell. There the row is hidden: a switch that cannot do
// anything is not offered. tests/code-span-ranges.test.cjs asserts the other
// half, that the row IS there (between Language and the sidebar toggle) on a
// shell that has the seam.
{
  const ctx = makeCtx()
  plugin.register(ctx)

  const settingsPage = ctx.registered.find(c => c.area === 'settings.plugins')._page
  const rendered = settingsPage.render()
  const tree = rendered.t(rendered.p)

  const titles = ['Ignore code spans', 'Code spans', 'Ignore code']
  check('no row titled for code spans', titles.filter(t => findByType(tree, 'ListRow', { title: t }).length), [])

  const rows = findByType(tree, 'ListRow').map(r => r.p.title)
  check('the remaining rows are the documented ones', rows, ['Language', 'Show in the sidebar'])

  const text = textOf(tree)
  check('the page never mentions code spans', /code span/i.test(text), false)
  check('the page never mentions backticks', /backtick/i.test(text), false)
}

console.log('\n=== 7. the suggestion path is not gated on code any more ===')
{
  const ctx = makeCtx()
  plugin.register(ctx)

  const reg = ctx.registered.filter(c => c.area === 'composer.contextMenu')[0]
  check('the menu still registers', !!reg, true)

  const rows = reg.data.items({ word: 'speling', selection: 'speling' })
  check('a misspelling in plain prose still gets rows', rows.length > 0, true)
  check('the first row is the ranked correction', rows[0].label, 'spelling')

  // Nothing consults the caret, so a bare sandbox with no selection API — the
  // state that used to mean "cannot tell, offer the rows" — behaves the same.
  check('no selection API is needed', typeof sandbox.document.getSelection, 'function')
  check('and it returns nothing to read', sandbox.document.getSelection(), null)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
