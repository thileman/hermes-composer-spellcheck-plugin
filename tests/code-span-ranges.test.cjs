// "Ignore code spans" is back — as a DECLARATION, not a DOM mask.
//
// The feature was removed because its implementation wrapped spans in
// <code spellcheck="false"> nodes inserted straight into the composer, on every
// keystroke, and moved the caret doing it. The way back is the
// `COMPOSER_AREAS.nonProse` seam (upstream #144007): the plugin DECLARES the
// non-prose ranges of the draft, and the app renders and owns the wrapper.
//
// So everything here is about a FUNCTION OF A STRING:
//
//   ranges({ text, sessionId }) -> [{ start, end, kind }]
//
// Nothing is queried, created or mutated, and the offsets are UTF-16 code-unit
// offsets into the draft exactly as submit would send it. This suite pins:
//
//   1. the provider is REGISTERED when the seam exists, with the SDK's own area
//      id, and not registered at all when it does not;
//   2. the ranges it returns for known drafts are EXACTLY right — offsets and
//      kinds — including the tricky ones (a Windows path, two spans, an astral
//      character before a span, a filename right after a newline);
//   3. the PROSE that must stay prose: `e.g`, `i.e`, `etc`, `Mr`, and a word
//      with a one-letter extension are NOT masked, because hiding them would
//      hide real spelling errors;
//   4. the setting gates the ranges, and flipping the real settings switch
//      changes the answer without re-registering anything;
//   5. the plugin makes NO DOM call of any kind while doing it — counted at
//      runtime, and grepped in the source, so the feature cannot regress into
//      the injection it replaced.

const path = require('path')
const { load, makeCtx, findByType, textOf } = require('./harness.cjs')
const { stripLiteralsAndComments } = require('../scripts/strip-literals.cjs')

// The seam's real value, as the SDK exports it once #144007 lands.
const NONPROSE_AREA = 'composer.nonProse'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`)
}
function ok(label, condition) {
  check(label, Boolean(condition), true)
}

/** Count every DOM API the plugin could reach for, on the document stub. */
function watchDom(doc) {
  const counts = {}
  const names = ['querySelector', 'querySelectorAll', 'getElementById', 'createElement',
    'createTreeWalker', 'createDocumentFragment', 'createRange', 'getSelection']

  for (const name of names) {
    counts[name] = 0
    const original = typeof doc[name] === 'function' ? doc[name].bind(doc) : () => null
    doc[name] = (...args) => { counts[name]++; return original(...args) }
  }

  return counts
}

/** The settings page's element tree, rendered the way the app renders it. */
function settingsTree(ctx) {
  const page = ctx.registered.find(c => c.area === 'settings.plugins')._page
  const rendered = page.render()

  return rendered.t(rendered.p)
}

/** The registered non-prose provider, or undefined. */
function providerIn(ctx) {
  const reg = ctx.registered.find(c => c.area === NONPROSE_AREA)

  return reg && reg.data && reg.data.ranges
}

/**
 * Drafts whose non-prose ranges are known by hand.
 *
 * Each entry is [text, expected ranges, the exact substring each range must
 * cover]. The substring column is the semantic half: an offset table can be
 * "consistent" and still point one character to the left, but a slice cannot.
 *
 * UTF-16 offsets are the point of the astral case: the snake is TWO code units,
 * so the span starts at 3 — a code-point implementation would say 2 and core
 * would wrap the wrong characters.
 */
const POSITIVE = [
  ['`npm run build`', [{ start: 0, end: 15, kind: 'code' }], ['`npm run build`']],
  ['Run `npm run build` first.', [{ start: 4, end: 19, kind: 'code' }], ['`npm run build`']],
  ['src/app/main.ts', [{ start: 0, end: 15, kind: 'path' }], ['src/app/main.ts']],
  ['Edit plugin.js now', [{ start: 5, end: 14, kind: 'path' }], ['plugin.js']],
  ['the config.yaml file', [{ start: 4, end: 15, kind: 'path' }], ['config.yaml']],
  ['Open C:\\Users\\me\\plugin.js now', [{ start: 8, end: 26, kind: 'path' }], ['Users\\me\\plugin.js']],
  ['`a` and `b`',
    [{ start: 0, end: 3, kind: 'code' }, { start: 8, end: 11, kind: 'code' }],
    ['`a`', '`b`']],
  ['line one\n`code` after\nx.md',
    [{ start: 9, end: 15, kind: 'code' }, { start: 22, end: 26, kind: 'path' }],
    ['`code`', 'x.md']],
  // A path INSIDE a backtick span is one span, not two: the backtick arm wins
  // at the backtick and the scan resumes after the closing one.
  ['see `docs/x.md` here', [{ start: 4, end: 15, kind: 'code' }], ['`docs/x.md`']],
  ['\u{1F40D} `x` here', [{ start: 3, end: 6, kind: 'code' }], ['`x`']]
]

/**
 * Prose that must NOT be declared non-prose.
 *
 * `e.g`, `i.e`, `etc` and `Mr` look like `name.ext` to a naive rule, and a word
 * ending in a one-letter "extension" (`foo.x`) or a version number (`1.2`) has
 * no extension this plugin knows. Masking any of them would hide a real
 * misspelling in ordinary prose.
 */
const NEGATIVE = [
  'e.g. this one',
  'i.e. that one',
  'etc. and more',
  'Mr. Smith came',
  'foo.x is not a file',
  'a.b.c here',
  'version 1.2 of it',
  'plain prose with no code in it at all'
]

async function main() {
  console.log('=== 1. seam PRESENT: the provider registers ===')
  {
    const { plugin, sandbox } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const counts = watchDom(sandbox.document)
    const ctx = makeCtx({ prefs: { excludeCodeSpans: true } })

    plugin.register(ctx)

    const regs = ctx.registered.filter(c => c.area === NONPROSE_AREA)
    check('exactly one composer.nonProse registration', regs.length, 1)
    check('its id', regs[0] && regs[0].id, 'code-spans')
    check('its area is the SDK export, not a literal', regs[0] && regs[0].area, NONPROSE_AREA)
    check('it exposes ranges()', typeof (regs[0] && regs[0].data && regs[0].data.ranges), 'function')

    // The seam's contract: one argument, `{ text, sessionId }`.
    const ranges = regs[0].data.ranges({ text: 'a `b` c', sessionId: '' })
    check('ranges() answers the seam contract', ranges, [{ start: 2, end: 5, kind: 'code' }])

    // Let the dictionary warm-up settle: the async work must not touch the DOM
    // either.
    await new Promise(resolve => setTimeout(resolve, 20))
    check('no DOM API was called', counts, {
      querySelector: 0, querySelectorAll: 0, getElementById: 0, createElement: 0,
      createTreeWalker: 0, createDocumentFragment: 0, createRange: 0, getSelection: 0
    })
  }

  console.log('\n=== 2. the ranges are EXACTLY right (offsets, kinds, slices) ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx({ prefs: { excludeCodeSpans: true } })

    plugin.register(ctx)
    const ranges = providerIn(ctx)

    for (const [text, expected, slices] of POSITIVE) {
      const got = ranges({ text, sessionId: '' })
      check(`"${text.replace(/\n/g, '\\n')}"`, got, expected)

      const covered = got.map(r => text.slice(r.start, r.end))
      check(`  ... it covers exactly the span(s)`, covered, slices)
      check(`  ... every offset is an integer inside the text`,
        got.every(r => Number.isInteger(r.start) && Number.isInteger(r.end) &&
          r.start >= 0 && r.end > r.start && r.end <= text.length), true)
      check(`  ... no range crosses a newline`, got.every(r => !text.slice(r.start, r.end).includes('\n')), true)
      check(`  ... kind is only 'code' or 'path'`, got.every(r => r.kind === 'code' || r.kind === 'path'), true)
    }
  }

  console.log('\n=== 3. prose the rule must NOT swallow ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx({ prefs: { excludeCodeSpans: true } })

    plugin.register(ctx)
    const ranges = providerIn(ctx)

    for (const text of NEGATIVE) {
      check(`"${text}" is left alone`, ranges({ text, sessionId: '' }), [])
    }
  }

  console.log('\n=== 4. odd input is answered, not thrown on ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx({ prefs: { excludeCodeSpans: true } })

    plugin.register(ctx)
    const ranges = providerIn(ctx)

    let threw = null
    let empty = null

    try {
      empty = {
        emptyString: ranges({ text: '', sessionId: '' }),
        noText: ranges({ sessionId: '' }),
        noContext: ranges(),
        nullText: ranges({ text: null }),
        numberText: ranges({ text: 42 })
      }
    } catch (err) {
      threw = err && err.message
    }

    check('ranges() never throws', threw, null)
    check('and every degenerate input is []', empty, {
      emptyString: [], noText: [], noContext: [], nullText: [], numberText: []
    })
  }

  console.log('\n=== 5. the SETTING gates the ranges, live ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx()
    const draft = 'run `npm test` then edit plugin.js'

    plugin.register(ctx)

    const ranges = providerIn(ctx)
    ok('the provider is registered even with the setting off', typeof ranges === 'function')
    check('setting off -> NO ranges', ranges({ text: draft, sessionId: '' }), [])

    // Flip the REAL settings switch, not a copy of the preference.
    const tree = settingsTree(ctx)
    const row = findByType(tree, 'ListRow', { title: 'Ignore code spans' })[0]

    ok('the settings row exists', !!row)
    const toggle = row && row.p.action
    check('its action is a Switch', toggle && toggle.t, 'Switch')
    check('the Switch reads the preference', toggle && toggle.p.checked, false)

    toggle.p.onCheckedChange(true)

    check('the preference is persisted',
      ctx.storage.get('prefs', {}).excludeCodeSpans, true)
    check('switching it on -> the ranges appear', ranges({ text: draft, sessionId: '' }), [
      { start: 4, end: 14, kind: 'code' },
      { start: 25, end: 34, kind: 'path' }
    ])

    toggle.p.onCheckedChange(false)
    check('switching it off -> no ranges again', ranges({ text: draft, sessionId: '' }), [])
  }

  console.log('\n=== 6. seam ABSENT: nothing registers, nothing throws, no notice ===')
  {
    const released = load()
    const counts = watchDom(released.sandbox.document)
    const ctx = makeCtx({ prefs: { excludeCodeSpans: true } })

    let threw = null
    try {
      released.plugin.register(ctx)
    } catch (err) {
      threw = err && err.message
    }

    check('register() did not throw', threw, null)
    check('NO composer.nonProse registration', ctx.registered.filter(c => c.area === NONPROSE_AREA).length, 0)
    check('nothing registers against an UNDEFINED area',
      ctx.registered.filter(c => c.area === undefined).length, 0)
    check('nothing even carries the provider id', ctx.registered.filter(c => c.id === 'code-spans').length, 0)
    check('the stub really has no nonProse key', 'nonProse' in released.sandbox.__SDK__.COMPOSER_AREAS, false)

    // The rest of the plugin is unaffected: this is a missing OPTION, not a
    // broken plugin.
    check('the menu still registers', ctx.registered.filter(c => c.area === 'composer.contextMenu').length, 1)
    check('the route still registers', ctx.registered.filter(c => c.area === 'routes').length, 1)
    check('the sidebar row still registers', ctx.registered.filter(c => c.area === 'sidebar-nav').length, 1)
    check('the settings page still registers', ctx.registered.filter(c => c.area === 'settings.plugins').length, 1)
    check('no notice is raised for a seam nobody asked about',
      released.notifyCalls.filter(n => /non-?prose|code span/i.test(String(n.message))).length, 0)
    check('no DOM API was called', Object.values(counts).reduce((a, b) => a + b, 0), 0)

    // And the row is hidden rather than offering a switch that cannot work.
    const tree = settingsTree(ctx)
    check('no Ignore code spans row on this shell',
      findByType(tree, 'ListRow', { title: 'Ignore code spans' }).length, 0)
    check('the remaining rows are the documented ones',
      findByType(tree, 'ListRow').map(r => r.p.title), ['Language', 'Show in the sidebar'])
    check('the page does not mention backticks', /backtick/i.test(textOf(tree)), false)
  }

  console.log('\n=== 7. with the seam, the row sits between Language and the sidebar toggle ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx()

    plugin.register(ctx)

    const tree = settingsTree(ctx)
    check('row order', findByType(tree, 'ListRow').map(r => r.p.title),
      ['Language', 'Ignore code spans', 'Show in the sidebar'])

    const row = findByType(tree, 'ListRow', { title: 'Ignore code spans' })[0]
    check('the description is the documented one', row && row.p.description,
      'Do not underline `backtick` code spans, file names or paths.')
  }

  console.log('\n=== 8. the plugin calls NO DOM API, at runtime or in the source ===')
  {
    const { source } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const code = stripLiteralsAndComments(source)

    // Source-wide, comments included: a DOM read hidden in a comment is still a
    // DOM read waiting to be un-commented, and these names have no other use in
    // this plugin.
    for (const api of ['querySelector', 'querySelectorAll', 'getElementById', 'createElement',
      'createTreeWalker', 'createDocumentFragment', 'createRange', 'getSelection']) {
      check(`${api} never appears in the source`, source.split(api).length - 1, 0)
    }

    // Code-only: the removed mask's vocabulary. It may still be described in a
    // comment (that is the disclosure), never executed.
    for (const gone of ['maskCodeSpans', 'MASKED_CODE_SELECTOR', 'characterOffset', 'restoreCaret',
      'CODE_SPLIT_RE', 'dataset', 'innerHTML', 'appendChild', 'insertNode', 'execCommand']) {
      check(`"${gone}" is not in the code`, code.split(gone).length - 1, 0)
    }

    check('the old wrapper marker is gone from the source', source.split('data-sp-mask').length - 1, 0)
    check('the provider is a pure text function',
      /function\s+codeSpanRanges\s*\(\s*text\s*\)/.test(code), true)
    check('it reads the text it was handed', /text\.matchAll\(CODE_SPAN_RE\)/.test(code), true)
  }

  console.log('\n=== 9. the seam is detected on the EXPORT, never on a version ===')
  {
    const { source } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const code = stripLiteralsAndComments(source)

    check('composerNonProseArea() is defined', /function\s+composerNonProseArea\s*\(/.test(code), true)
    check('it tests the nonProse key', /COMPOSER_AREAS\.nonProse/.test(code), true)
    check('the registration goes through it', /area\s*:\s*nonProseArea/.test(code), true)
    check('nothing registers against COMPOSER_AREAS.nonProse directly',
      /area\s*:\s*COMPOSER_AREAS\.nonProse/.test(code), false)

    for (const probe of ['ctx.version', 'host.version', 'appVersion', 'getVersion', 'requires_hermes']) {
      check(`the guard does not consult ${probe}`, code.includes(probe), false)
    }

    // The area id comes from the SDK, so the plugin does not hardcode a seam
    // name an older shell would happily accept and then never resolve.
    check('the literal area id appears nowhere in the source',
      source.includes("'composer.nonProse'"), false)
  }

  console.log('\n=== 10. DEFAULTS ===')
  {
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })

    // No stored preference: off, and therefore no ranges — the opt-in default.
    const ctx = makeCtx()
    plugin.register(ctx)
    check('excludeCodeSpans defaults to off',
      providerIn(ctx)({ text: '`x`', sessionId: '' }), [])

    // A stored preference is honoured.
    const stored = makeCtx({ prefs: { excludeCodeSpans: true } })
    plugin.register(stored)
    check('a stored preference is honoured',
      providerIn(stored)({ text: '`x`', sessionId: '' }), [{ start: 0, end: 3, kind: 'code' }])
  }

  console.log('\n=== 11. the harness suites still see the same module ===')
  {
    // Settings page sub-page and route are untouched by this feature.
    const { plugin } = load({ composerAreas: { nonProse: NONPROSE_AREA } })
    const ctx = makeCtx()
    plugin.register(ctx)

    const page = ctx.registered.find(c => c.area === 'settings.plugins')._page
    check('the Custom Words sub-page is still first', page.children[0].id, 'words')
    check('and still renders', typeof page.children[0].render, 'function')
    check('the plugin id is unchanged', plugin.id, 'hermes-composer-spellcheck-plugin')
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
