// The Custom Words page must list, add and remove for the locale the app is
// actually running in — and must never hide a word it could not reach.
//
// History, because it explains the shape of the rule:
//
//   pageLocale() used to return "whichever locale has the most words" whenever
//   the configured locale had none. With storage { en: ['aaa'], de: ['bbb',
//   'ccc'] } and Language set to en, the page showed de: the word added from
//   the English composer ('aaa') was invisible there and could not be deleted
//   from it. The header said "· de", so it was recoverable, but the menu and
//   the page disagreed about which dictionary a word belongs to.
//
//   The fix then was "the configured Language, else the composer the user is
//   in". That composer branch is GONE: the composer element carries no `lang`
//   attribute at all, so `el.lang` was always '' and the branch was dead
//   weight that looked like it did something. pageLocale() now uses the SAME
//   resolution activeLocale() uses — `<html lang>` (which the app's i18n
//   provider keeps current), then `navigator.language` — and only when the
//   environment offers no locale at all does it fall back to the locale with
//   the most words.
//
// The property this suite protects is unchanged: no word is ever invisible AND
// undeletable. The page renders EVERY locale's words, each row carrying its
// own locale, and the delete button acts on that row's locale.
//
// The component is mounted with a stateful useState stub, so the real Add
// field and the real Remove buttons are exercised, not re-implemented.

const { load, makeCtx, textOf, findByType } = require('./harness.cjs')
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

const { sandbox, plugin, source } = load()

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

/**
 * Set the environment the plugin resolves `auto` from.
 *
 * `html` is `<html lang>`, which the app's i18n provider writes;
 * `navigatorLanguage` is the browser's; `composer` is a DECOY element that a
 * stale build might have found — the plugin must never consult it, and
 * `queried` records every `document.querySelector` selector so a re-added
 * composer read fails here.
 */
function environment(html, navigatorLanguage, composer) {
  const saved = {
    html: sandbox.document.documentElement.lang,
    nav: sandbox.navigator.language,
    query: sandbox.document.querySelector
  }
  const queried = []

  sandbox.document.documentElement.lang = html
  sandbox.navigator.language = navigatorLanguage
  sandbox.document.querySelector = (selector) => {
    queried.push(String(selector))

    return composer || null
  }

  return {
    queried,
    restore() {
      sandbox.document.documentElement.lang = saved.html
      sandbox.navigator.language = saved.nav
      sandbox.document.querySelector = saved.query
    }
  }
}

/** Register the plugin in the environment set up by environment(), then mount the real page. */
function openPage(storageData, prefs, env) {
  const ctx = makeCtx(storageData)

  plugin.register(ctx)

  const page = mount({ prefs, storage: ctx.storage })

  return { ctx, page, restore: env.restore }
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

// A FRESH store per section: makeCtx() keeps the object it is given, so a
// shared literal would leak one section's deletes into the next.
const words = () => ({ customWords: { en: ['aaa'], de: ['bbb', 'ccc'] } })

console.log('=== 1. pageLocale agrees with the menu ===')
{
  // The "most words" fallback reads the words the plugin loaded, so the
  // multi-locale store has to be in place before the environment is varied.
  plugin.register(makeCtx(words()))

  // Explicit Language wins over everything...
  let env = environment('de', 'de')
  check('Language "en" -> page adds to en', sandbox.__pageLocale({ language: 'en' }), 'en')
  env.restore()

  // ... then the app's own locale, from <html lang>.
  env = environment('en', 'en')
  check('Automatic + <html lang=en> -> en', sandbox.__pageLocale({ language: 'auto' }), 'en')
  env.restore()

  env = environment('de', 'en')
  check('Automatic + <html lang=de> -> de', sandbox.__pageLocale({ language: 'auto' }), 'de')
  env.restore()

  // <html lang> missing: the browser's language, the same resolution's second
  // step.
  env = environment('', 'de')
  check('Automatic + no <html lang>, navigator de -> de', sandbox.__pageLocale({ language: 'auto' }), 'de')
  env.restore()

  // THE REGRESSION THIS FIXES: a composer element claiming a language of its
  // own is not consulted. It has no `lang` in the real app, so reading it was
  // always empty — this pins that it is not read at all.
  env = environment('en', 'en', { lang: 'de' })
  check('a composer claiming de does NOT move the page', sandbox.__pageLocale({ language: 'auto' }), 'en')
  check('the composer element was never queried',
    env.queried.filter(s => /textbox|contenteditable/.test(s)), [])
  check('no selector was queried at all', env.queried, [])
  env.restore()

  // No locale anywhere: keep the words visible rather than showing an empty
  // list, exactly as it did before.
  env = environment('', '')
  check('no locale anywhere + words in de -> de', sandbox.__pageLocale({ language: 'auto' }), 'de')
  env.restore()

  // ... and no words either: the hard default, not a crash.
  env = environment('', '')
  plugin.register(makeCtx({}))
  check('no locale and no words -> en', sandbox.__pageLocale({ language: 'auto' }), 'en')
  env.restore()

  // Put the multi-locale store back for the sections below.
  plugin.register(makeCtx(words()))
}

console.log('\n=== 2. the English word is listed on an English page ===')
{
  // The reported reproduction: storage { en: ['aaa'], de: ['bbb', 'ccc'] },
  // Language Automatic, app language en. pageLocale() once answered "de"
  // (whichever list is longer), so 'aaa' was invisible here and could not be
  // deleted from this page.
  const env = environment('en', 'en')
  const { ctx, page, restore } = openPage(words(), { language: 'auto' }, env)
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
  check('the plugin never asked for the composer',
    env.queried.filter(s => /textbox|contenteditable/.test(s)), [])
  restore()
}

console.log('\n=== 3. adding uses the ACTIVE locale, not the biggest list ===')
{
  const env = environment('en', 'en')
  const { ctx, page, restore } = openPage(words(), { language: 'auto' }, env)

  check('the page adds to en', sandbox.__pageLocale({ language: 'auto' }), 'en')
  check('the add path ran', typeAndAdd(page, 'newword'), true)

  check('the word landed in en', (stored(ctx).en || []).includes('newword'), true)
  check('it did NOT land in de', (stored(ctx).de || []).includes('newword'), false)
  has('and the page shows it', 'newword', textOf(page.tree()))
  restore()
}

console.log('\n=== 4. the same page still reaches a word from another locale ===')
{
  const env = environment('de', 'de')
  const { ctx, page, restore } = openPage(words(), { language: 'auto' }, env)

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
  const env = environment('', '')
  const { page, restore } = openPage({}, { language: 'auto' }, env)
  const empty = findByType(page.tree(), 'EmptyState')[0]

  check('the empty state is there', empty && empty.p.title, 'No custom words yet')
  check('no rows', findByType(page.tree(), 'button').filter(b => String(b.p['aria-label'] || '').startsWith('Remove ')).length, 0)
  restore()
}

console.log('\n=== 6. the locale is never read off the composer element ===')
{
  // Structural, over the code (comments and literals stripped): no `el.lang`
  // read is left anywhere, and neither resolver queries a selector.
  const code = stripLiteralsAndComments(source)
  const withoutDocumentLang = code.replace(/document\s*\.\s*documentElement\s*\.\s*lang/g, '')

  check('no ".lang" property read is left', /\.lang\b/.test(withoutDocumentLang), false)
  check('the shared helper reads documentElement.lang, then navigator.language',
    /document\s*\.\s*documentElement\s*\.\s*lang\s*\|\|\s*navigator\s*\.\s*language/.test(source), true)
  check('activeLocale does not query a selector',
    /function activeLocale[\s\S]{0,400}?querySelector/.test(source), false)
  check('pageLocale does not query a selector',
    /function pageLocale[\s\S]{0,900}?querySelector/.test(source), false)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
