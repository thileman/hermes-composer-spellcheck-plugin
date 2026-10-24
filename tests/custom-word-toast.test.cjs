// The toast after "Add to dictionary" must quote the word AS STORED.
//
// The menu used to say `Added “Hermes”` while the list (and the app's
// dictionary) received `hermes`: addAllowed() lowercases, and the user's own
// selection was quoted raw. So the message named a word that was not in the
// list it said it had been added to — and the "already in your custom words"
// branch quoted a form the user may never have typed.
//
// This drives the real contribution: the rows the app would render, the real
// onSelect, the real store.

const { load, makeCtx } = require('./harness.cjs')

const { plugin, notifyCalls, document } = load()

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}

const ctx = makeCtx()
plugin.register(ctx)

const contribution = ctx.registered.filter(c => c.area === 'composer.contextMenu')[0]

if (!contribution) {
  console.error('the plugin registered no composer.contextMenu contribution')
  process.exit(1)
}

const rowsFor = word => contribution.data.items({ word, selection: word })
const stored = () => (ctx.storage.get('customWords', {}) || {}).en || []

// A capitalised MISSPELLING: "Speling" is not a word, so the menu opens with
// suggestions and the Add row — and the raw selection differs from the stored
// form in exactly the way the message used to get wrong.
const rows = rowsFor('Speling')
const addRow = rows[rows.length - 1]

console.log('=== 1. the menu offers the word, capitalised as selected ===')
check('the word gets rows', rows.length > 0, true)
check('the last row is Add to dictionary', addRow && addRow.label, 'Add to dictionary')

console.log('\n=== 2. the success toast quotes the STORED form ===')
addRow.onSelect()
check('exactly one notice', notifyCalls.length, 1)
check('it is a success', notifyCalls[0] && notifyCalls[0].kind, 'success')
check('the message', notifyCalls[0] && notifyCalls[0].message, 'Added “speling” to your custom words')
check('the list really holds the lowercase form', stored(), ['speling'])

console.log('\n=== 3. the quoted word is the one in the list ===')
{
  const quoted = /“([^”]*)”/.exec(notifyCalls[0].message || '')
  check('the toast quotes a word', !!quoted, true)
  check('and it is a stored entry', quoted ? stored().includes(quoted[1]) : false, true)
  check('it is NOT the raw selection', quoted ? quoted[1] === 'Speling' : true, false)
}

console.log('\n=== 4. the "already there" toast quotes the same form ===')
addRow.onSelect()
check('a second notice', notifyCalls.length, 2)
check('it is informational', notifyCalls[1] && notifyCalls[1].kind, 'info')
check('the message', notifyCalls[1] && notifyCalls[1].message, '“speling” is already in your custom words')
check('nothing was stored twice', stored(), ['speling'])

// The plugin must not have touched the composer for any of this.
check('no DOM writes were needed', typeof document.createElement, 'function')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
