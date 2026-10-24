// The Custom Words page must list, add and remove for the locale the user is
// actually working in — and must never hide a word it could not reach.
//
// pageLocale() used to return "whichever locale has the most words" whenever
// the configured locale had none. With storage { en: ['aaa'], de: ['bbb',
// 'ccc'] } and Language set to en, the page showed de: the word added from the
// English composer ('aaa') was invisible there and could not be deleted from
// it. The header said "· de", so it was recoverable, but the menu and the page
// disagreed about which dictionary a word belongs to.
//
// The rule now: pageLocale() is the configured Language, or the composer the
// user is in, and only with no composer at all does it fall back to a locale
// that has words. The LIST is every locale's words, each row carrying its own
// locale, so no word can be invisible-and-undeletable.
//
// The component is mounted with a stateful useState stub, so the real Add
// field and the real Remove buttons are exercised, not re-implemented.

const { load, makeCtx, textOf, findByType } = require('./harness.cjs')

const { sandbox, plugin } = load()

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
function has(label, needle, haystack) {
  const ok = String(haystack).includes(needle)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (looking for ${JSON.stringify(needle)})`)
}

// --- a stateful useState, so a setter really re-renders --------------------
let slots = []
let index = 0
let redraw = null

sandbox.__useState = (initial) => {
  const i = index++

  if (!(i in slots)) {
    slots[i] = initial
  }

  return [slots[i], (value) => {
    slots[i] = typeof value === 'function' ? value(slots[i]) : value
    if (redraw) redraw()
  }]
}

function mount(props) {
  slots = []
  index = 0

  let tree

  const draw = () => {
    index = 0
    tree = sandbox.__dictionaryPage(props)

    return tree
  }

  redraw = draw
  draw()

  return {
    tree: () => tree,
    redraw: draw
  }
}

// A benign dictionary fetch, so a locale other than en does not log a failure.
sandbox.__fetch = async (url) => ({
  ok: true,
  status: 200,
  text: async () => (url.endsWith('.aff') ? 'SET UTF-8\n' : '2\nwort\nhaus\n')
})

/** Register the plugin against this storage, then mount the real page. */
function openPage(storageData, prefs, composer) {
  const ctx = makeCtx(storageData)
  plugin.register(ctx)

  const dom = { querySelector: () => composer || null }
  const previous = sandbox.document.querySelector
  sandbox.document.querySelector = dom.querySelector

  const page = mount({ prefs, storage: ctx.storage })

  return { ctx, page, restore: () => { sandbox.document.querySelector = previous } }
}

const stored = (ctx) => ctx.storage.get('customWords', {}) || {}

function removeButton(tree, word) {
  return findByType(tree, 'button', { 'aria-label': `Remove ${word}` })[0]
}

function typeAndAdd(page, word) {
  const field = findByType(page.tree(), 'SearchField')[0]

  if (!field) {
    return false
  }

  field.p.onChange(word)

  const button = findByType(page.tree(), 'Button')[0]

  if (!button) {
    return false
  }

  button.p.onClick()

  return true
}

console.log('=== 1. pageLocale agrees with the menu ===')
{
  // Explicit Language: that dictionary, whether or not it has words yet.
  const a = openPage({ customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } }, { language: 'en' }, null)
  check('Language "en" -> page adds to en', sandbox.__pageLocale({ language: 'en' }), 'en')
  a.restore()

  // Automatic with a mounted composer: the composer's language, like the menu.
  const b = openPage({ customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } }, { language: 'auto' }, { lang: 'en' })
  check('Automatic + an en composer -> en', sandbox.__pageLocale({ language: 'auto' }), 'en')
  b.restore()

  const c = openPage({ customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } }, { language: 'auto' }, { lang: 'de' })
  check('Automatic + a de composer -> de', sandbox.__pageLocale({ language: 'auto' }), 'de')
  c.restore()

  // No composer: keep the words visible rather than showing an empty list.
  const d = openPage({ customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } }, { language: 'auto' }, null)
  check('no composer -> a locale that has words', sandbox.__pageLocale({ language: 'auto' }), 'de')
  d.restore()
}

console.log('\n=== 2. the English word is listed on an English page ===')
{
  // The reported reproduction: storage { en: ['aaa'], de: ['bbb', 'ccc'] },
  // Language Automatic, composer in en. pageLocale() used to answer "de"
  // (whichever list is longer), so 'aaa' was invisible here and could not be
  // deleted from this page.
  const { ctx, page, restore } = openPage(
    { customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } },
    { language: 'auto' },
    { lang: 'en' }
  )
  const text = textOf(page.tree())

  has('the en word is listed', 'aaa', text)
  has('the de words are listed too', 'bbb', text)
  has('and the other de word', 'ccc', text)
  has('the header names both dictionaries', 'de, en', text)
  check('three rows', findByType(page.tree(), 'button').filter(b => String(b.p['aria-label'] || '').startsWith('Remove ')).length, 3)

  console.log('  -- and it can be removed from here --')
  const button = removeButton(page.tree(), 'aaa')

  check('the row has a Remove button', !!button, true)
  if (button) button.p.onClick()

  // The real component re-renders from the $allowedVersion atom that
  // useValue() subscribes to; this stub does not subscribe, so redraw by hand.
  page.redraw()

  check('en loses the word', stored(ctx).en, undefined)
  check('de is untouched', stored(ctx).de, ['bbb', 'ccc'])
  check('the page no longer shows it', textOf(page.tree()).includes('aaa'), false)
  restore()
}

console.log('\n=== 3. adding uses the ACTIVE locale, not the biggest list ===')
{
  const { ctx, page, restore } = openPage(
    { customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } },
    { language: 'auto' },
    { lang: 'en' }
  )

  check('the page adds to en', sandbox.__pageLocale({ language: 'auto' }), 'en')
  check('the add path ran', typeAndAdd(page, 'newword'), true)

  check('the word landed in en', (stored(ctx).en || []).includes('newword'), true)
  check('it did NOT land in de', (stored(ctx).de || []).includes('newword'), false)
  has('and the page shows it', 'newword', textOf(page.tree()))
  restore()
}

console.log('\n=== 4. the same page still reaches a word from another locale ===')
{
  const { ctx, page, restore } = openPage(
    { customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } },
    { language: 'auto' },
    { lang: 'de' }
  )

  check('the page adds to de', sandbox.__pageLocale({ language: 'auto' }), 'de')
  check('the en word is still listed', textOf(page.tree()).includes('aaa'), true)

  const button = removeButton(page.tree(), 'aaa')

  check('its Remove button is there', !!button, true)
  if (button) button.p.onClick()

  check('en is empty afterwards', stored(ctx).en, undefined)
  check('de survives', stored(ctx).de, ['bbb', 'ccc'])

  check('add goes to de', typeAndAdd(page, 'wort'), true)
  check('the word landed in de', (stored(ctx).de || []).includes('wort'), true)
  restore()
}

console.log('\n=== 5. an empty store shows the empty state, not a crash ===')
{
  const { page, restore } = openPage({}, { language: 'auto' }, null)
  const empty = findByType(page.tree(), 'EmptyState')[0]

  check('the empty state is there', empty && empty.p.title, 'No custom words yet')
  check('no rows', findByType(page.tree(), 'button').filter(b => String(b.p['aria-label'] || '').startsWith('Remove ')).length, 0)
  restore()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
