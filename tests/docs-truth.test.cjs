// The README and the in-app description must describe the switch the code
// actually implements.
//
// Two claims were false:
//
//   1. `| Check spelling | turns the squiggles on and off |`. It also gates the
//      right-click suggestions (`items: (menu) => prefs.get().enabled ? ... :
//      []`), and on every released build — where host.composer.setSpellcheck
//      does not exist — turning it off is the ONLY thing the switch visibly
//      does, because there are no squiggles to turn off. The "What it does"
//      bullet said the suggestions "work either way", which read as "the
//      switch does not affect them".
//
//   2. "The squiggle goes away immediately and the word is saved." On a
//      released build there is no squiggle at all, so the first half cannot
//      happen.
//
// The decision taken (see the commit message) was to keep the behaviour — the
// switch is the plugin's master switch — and make the prose match it, rather
// than leaving a menu that keeps writing to the composer after the user turned
// spelling off. This suite pins all three surfaces to that decision: the
// settings table, the "What it does" list, the in-app description, and the
// gate in the real contribution.

const fs = require('fs')
const path = require('path')
const { load, makeCtx, findByType } = require('./harness.cjs')

const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
const flat = README.replace(/\s+/g, ' ')

const { sandbox, plugin } = load()

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
function match(label, re, text) {
  const ok = re.test(text)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (looking for ${re})`)
}
function noMatch(label, re, text) {
  const ok = !re.test(text)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (must NOT match ${re})`)
}

function section(start, end) {
  const i = README.indexOf(start)
  const j = README.indexOf(end, i + start.length)

  if (i < 0 || j < 0) {
    return ''
  }

  return README.slice(i, j).replace(/\s+/g, ' ')
}

console.log('=== 1. the settings table says what the switch gates ===')
{
  const row = README.split('\n').find(l => l.startsWith('| Check spelling |')) || ''

  match('the row names the squiggles', /squiggle/i, row)
  match('the row names the suggestions', /suggestion/i, row)
  match('the row says it turns them off together', /on and off/i, row)
  noMatch('the row no longer claims squiggles only', /turns the squiggles on and off \|$/, row.trim())
}

console.log('\n=== 2. the "What it does" bullet agrees ===')
{
  const what = section('## What it does', '## Install')

  match('the bullet names the switch', /\*\*Check spelling\*\*/, what)
  match('it says the switch covers the suggestions', /right-click suggestions on and off together/, what)
  match('it still explains the setSpellcheck seam', /setSpellcheck/, what)
  noMatch('it no longer says the suggestions work "either way"', /work either way/, what)
}

console.log('\n=== 3. "Add a word for good" is true without a squiggle seam ===')
{
  const add = section('**Add a word for good.**', '**Manage your words.**')

  noMatch('the unconditional promise is gone', /squiggle goes away immediately and the word is saved/, add)
  match('it says the plugin stops flagging the word', /stops flagging it immediately/, add)
  match('the squiggle is now conditional on the seam', /setSpellcheck/, add)
}

console.log('\n=== 4. the in-app description agrees ===')
{
  const ctx = makeCtx()
  plugin.register(ctx)

  const settingsPage = ctx.registered.find(c => c.area === 'settings.plugins')._page
  const rendered = settingsPage.render()
  const tree = rendered.t(rendered.p)
  const row = findByType(tree, 'ToggleRow', { label: 'Check spelling' })[0]
  const description = row ? String(row.p.description || '') : ''

  check('the Check spelling row renders', !!row, true)
  match('its description names the suggestions', /suggestion/i, description)
  match('and says turning it off stops them', /(turning it off|off).*(both|stops)/i, description)
}

console.log('\n=== 5. the code still gates exactly what the docs now say ===')
{
  // ON: the contribution offers rows.
  const on = makeCtx()
  plugin.register(on)
  const onReg = on.registered.filter(c => c.area === 'composer.contextMenu')[0]
  check('enabled -> suggestion rows', onReg.data.items({ word: 'Speling', selection: 'Speling' }).length > 0, true)

  // OFF: no squiggle request can succeed on a released build, and the rows go.
  const off = makeCtx({ prefs: { enabled: false } })
  plugin.register(off)
  const offReg = off.registered.filter(c => c.area === 'composer.contextMenu')[0]
  check('disabled -> NO suggestion rows', offReg.data.items({ word: 'Speling', selection: 'Speling' }).length, 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
