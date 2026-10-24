// The RANKER'S OUTPUT IS FROZEN, and it has to be fast enough to paint a menu.
//
// `suggest()` decides what the right-click menu offers and in what order. The
// app calls it from inside a `useMemo` DURING RENDER (app-context-menu.tsx),
// so the menu cannot paint until it returns — a slow ranker is not a slow
// feature, it is a frozen window.
//
// The ranker was rewritten to meet that: the full-matrix Damerau-Levenshtein
// it used to run against all 118,087 dictionary spellings allocated three
// arrays per candidate and scored the whole matrix, which cost 871 ms on
// "definately". It is now banded (|i - j| <= cap only), runs on reused
// Int32Arrays, and skips out-of-band candidates before the call. That is a
// 45x change to the hottest loop in the plugin, so the thing this suite exists
// to prove is that NOTHING ELSE changed.
//
// Five independent checks, so no single one can quietly rot:
//
//   1. SPEED. A 10-letter typo must rank in well under 50 ms. THIS is the
//      check that fails on the pre-rewrite plugin (871 ms); the ranking checks
//      pass on both, which is exactly the point.
//   2. GOLDEN. The ordered lists the pre-rewrite ranker produced, recorded
//      from that build, byte for byte. This is the user-visible contract.
//   3. ORACLE. A verbatim copy of the pre-rewrite algorithm, below, run over
//      the plugin's OWN dictionary. It must agree with the plugin's suggest()
//      for every word here. Independent of (2): if the recording in (2) were
//      ever "updated to match the new behaviour", this still fails.
//   4. CASE. The capitalisation semantics the dictionary encodes: "english"
//      corrects to "English", and lookup() accepts "Hermes" but not "hermes".
//   5. ROWS. Five suggestions, six rows at most, "Add to dictionary" last.
//   6. EXHAUSTIVE. The distance function itself, against the full-matrix one,
//      for every string over a small alphabet — empty, repeated letters,
//      transpositions on the band edge. 6 million pairs, no dictionary involved.
//
//   node tests/ranking-stability.test.cjs

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const PLUGIN = process.env.SC_PLUGIN || path.join(__dirname, '..', 'desktop', 'plugin.js')
const source = fs.readFileSync(PLUGIN, 'utf8')

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

let failures = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`        got  ${JSON.stringify(actual)}`)
    console.log(`        want ${JSON.stringify(expected)}`)
  }
}

// --- stub host, enough to load the module and to build menu rows -----------
const notified = []
const SDK = {
  atom: initial => {
    let v = initial
    const subs = new Set()
    return {
      get: () => v,
      set: n => { v = n; subs.forEach(f => f()) },
      listen: f => { subs.add(f); return () => subs.delete(f) }
    }
  },
  Button: 'Button',
  Codicon: 'Codicon',
  COMPOSER_AREAS: { contextMenu: 'composer.contextMenu' },
  EmptyState: 'EmptyState',
  Input: 'Input',
  ListRow: 'ListRow',
  Switch: 'Switch',
  ToggleRow: 'ToggleRow',
  SearchField: 'SearchField',
  ROUTES_AREA: 'routes',
  SIDEBAR_NAV_AREA: 'sidebar.nav',
  pluginSettingsHref: () => '/settings',
  useValue: a => a.get(),
  host: {
    notify: m => notified.push(m),
    navigate() {},
    spellcheck: { addWord: () => Promise.resolve(true), removeWord: () => Promise.resolve(true) },
    composer: { getDraft: () => Promise.resolve(null), setDraft: () => Promise.resolve(false) }
  }
}

// No caret anywhere: `caretInMaskedCode()` must fall through to "offer rows".
const sandbox = {
  console,
  __SDK__: SDK,
  __REACT__: { useState: v => [v, () => {}] },
  __JSX__: { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }), Fragment: 'frag' },
  document: {
    documentElement: { lang: 'en' },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, style: {} }),
    createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => ({ append() {} }),
    createRange: () => ({ setStart() {}, setEnd() {}, selectNodeContents() {}, toString: () => '' }),
    addEventListener() {},
    body: { dispatchEvent() {} },
    getSelection: () => null
  },
  window: { addEventListener() {}, removeEventListener() {} },
  navigator: { language: 'en' },
  NodeFilter: { SHOW_TEXT: 4 },
  HTMLElement: function HTMLElement() {},
  Element: function Element() {},
  MutationObserver: function MutationObserver() {},
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  URL,
  Blob: function Blob() {},
  TextEncoder,
  TextDecoder,
  Uint8Array,
  fetch: async () => ({ ok: false, status: 404, text: async () => '' })
}

sandbox.globalThis = sandbox

const EXPORT = `
globalThis.__ranker = {
  EMBEDDED_WORDS,
  EMBEDDED_CANDS,
  EMBEDDED_MIXED,
  FREQ_RANK,
  SUGGESTION_ROWS,
  maskAllows,
  lookup,
  rankFor,
  suggest,
  suggestionItems,
  // Absent on the pre-rewrite plugin: undefined rather than a ReferenceError,
  // so the suite can report it instead of dying at load.
  primeEditTarget: typeof primeEditTarget === 'function' ? primeEditTarget : undefined,
  editDistanceToTarget: typeof editDistanceToTarget === 'function' ? editDistanceToTarget : undefined
};
`

const context = vm.createContext(sandbox)
const loadStart = process.hrtime.bigint()

vm.runInContext(
  source
    .replace(/import\s*\{([^}]*)\}\s*from\s*'@hermes\/plugin-sdk'/s, (_, n) => `const {${n}} = __SDK__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react'/s, (_, n) => `const {${n}} = __REACT__;`)
    .replace(/import\s*\{([^}]*)\}\s*from\s*'react\/jsx-runtime'/s, (_, n) => `const {${n}} = __JSX__;`)
    .replace(/export default\s*\{/, 'globalThis.__PLUGIN__ = {') + EXPORT,
  context,
  { filename: 'plugin.js' }
)

const ranker = sandbox.__ranker
const entry = ranker.rankFor('en')

entry.words = ranker.EMBEDDED_WORDS
entry.cands = ranker.EMBEDDED_CANDS
entry.mixed = ranker.EMBEDDED_MIXED
entry.ready = true

const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6

const suggest = word => ranker.suggest(entry, word, ranker.FREQ_RANK, ranker.SUGGESTION_ROWS)

// ---------------------------------------------------------------------------
// 1. SPEED, measured first and on a quiet heap
//
// This is the check the rewrite exists for, and it is the one that fails on the
// pre-rewrite plugin: 871 ms for "definately". Measured the way the benchmark
// that found the bug measured it — the real plugin, the real embedded
// dictionary, warmed, then timed — with the best of three taken so a scheduler
// hiccup cannot fail the build. On the banded ranker this is ~19 ms.
//
// It runs BEFORE the oracle section on purpose: that section deliberately runs
// the old allocating ranker 60 times, and the heap it leaves behind makes any
// timing taken afterwards a worst case rather than a typical one.
// ---------------------------------------------------------------------------
const SPEED_LIMIT_MS = 50
const speedReport = []

console.log('=== 1. a ten-letter typo ranks in well under 50 ms ===')
{
  for (const word of ['definately', 'occurence', 'concious', 'accomodate', 'enviroment', 'recieved']) {
    suggest(word) // warm

    let best = Infinity
    let rows = 0

    for (let run = 0; run < 3; run++) {
      const t0 = process.hrtime.bigint()

      rows = suggest(word).length

      const ms = Number(process.hrtime.bigint() - t0) / 1e6

      if (ms < best) best = ms
    }

    speedReport.push({ word, ms: best, rows })
    console.log(`  "${word}" — ${best.toFixed(1)} ms, ${rows} rows`)
  }

  const worst = speedReport.reduce((a, b) => (a.ms > b.ms ? a : b))

  check(`the slowest of them ("${worst.word}", ${worst.ms.toFixed(1)} ms) is under ${SPEED_LIMIT_MS} ms`, worst.ms < SPEED_LIMIT_MS, true)
}

// ---------------------------------------------------------------------------
// 2. THE FROZEN LIST
//
// Recorded from the merged plugin BEFORE the banded rewrite, with
// `suggest(entry, word, FREQ_RANK, SUGGESTION_ROWS)`. Deliberately mixed:
// famous misspellings, ordinary words that are spelled correctly (which still
// get distance-1 neighbours, because suggest() ranks and the caller decides),
// proper nouns, an ALL-CAPS form, one- and two-letter inputs, a 16-letter one
// with no close neighbour, and the corpus-frequency tie-breaks that make
// "wich" -> "with" come before "which".
// ---------------------------------------------------------------------------
const GOLDEN = {
  teh: ["the","ten","eh","tea","ted"],
  wich: ["with","which","wish","rich","witch"],
  recieve: ["receive","relieve","believe","received","relieved"],
  occurence: ["occurrence","occurrences","Clarence","Laurence","occupancy"],
  definately: ["definitely","delicately","defiantly","definite","indefinitely"],
  concious: ["conscious","copious","continue","continues","obvious"],
  english: ["English","anguish","enlist","English's","Englisher"],
  monday: ["Monday","money","today","Sunday","monkey"],
  hermes: ["Hermes","heroes","herpes","here","horses"],
  speling: ["spelling","spewing","spieling","feeling","seeing"],
  tehre: ["there","the","here","where","were"],
  seperate: ["separate","desperate","separated","operate","generate"],
  alot: ["lot","plot","slot","clot","alto"],
  begining: ["beginning","begging","Beijing","beginnings","reigning"],
  calender: ["calendar","lavender","cylinder","blender","slender"],
  enviroment: ["environment","environments","environmental","enrichment","enlistment"],
  accomodate: ["accommodate","accommodated","accommodates","accumulate"],
  embarass: ["embarrass","embarks","embarrassed","embrace","embassy"],
  happend: ["happened","happen","happens","append","tapped"],
  independant: ["independent","independents","defendant","independence","dependent"],
  neccessary: ["necessary","necessarily","unnecessary","necessity","accessory"],
  occassion: ["occasion","occasions","accession","occlusion","passion"],
  persistant: ["persistent","resistant","persisting","assistant","Persian"],
  priviledge: ["privilege","privileges","privileged","privilege's"],
  publically: ["publicly","physically","publicity","surgically","musically"],
  recieved: ["received","relieved","believed","receive","deceived"],
  refered: ["referred","referee","revered","refereed","offered"],
  sucessful: ["successful","stressful","successfully","unsuccessful"],
  tommorow: ["tomorrow","tomorrows","Comoros","Doctorow"],
  untill: ["until","still","till","untie","unwell"],
  wierd: ["weird","wired","wield","where","were"],
  writting: ["writing","gritting","witting","waiting","sitting"],
  accross: ["across","cross","access","actress","accords"],
  adress: ["dress","address","across","arrest","press"],
  arguement: ["argument","agreement","arguments","amusement","agreements"],
  bizzare: ["bizarre","blizzard","buzzard","gizzard","pizza"],
  buisness: ["business","Guinness","bigness","briskness","busyness"],
  caluclate: ["calculate","calculated","calculates","calculator","circulate"],
  cemetary: ["cemetery","secretary","century","elementary","geometry"],
  changable: ["changeable","changeably","chargeable","change","capable"],
  the: ["he","they","she","them","then"],
  a: ["i","at","as","an","am"],
  i: ["a","it","is","in","if"],
  spelling: ["selling","smelling","swelling","spilling","shelling"],
  dictionary: ["dictionary's","missionary","fictional","visionary","stationary"],
  English: ["Anguish","Enlist","English's","Englisher","Englishes"],
  Monday: ["Money","Today","Sunday","Monkey","Mona"],
  Hermes: ["Heroes","Herpes","Here","Horses","Terms"],
  HERMES: ["Heroes","Herpes","Here","Horses","Terms"],
  university: ["diversity","universality","university's","universe","universal"],
  extraordinary: ["extraordinarily","extraordinaire"],
  tehcat: ["that","Tehran","tomcat","teat","reheat"],
  x: ["i","a","l","s","o"],
  zebra: ["Debra","zebras","zero","era","Vera"],
  qwerty: ["twenty","sweaty","query","warty"],
  ab: ["a","at","as","an","am"],
  abc: ["ABC","Abe","BBC","arc","ac"],
  abcd: ["ABC","abed","ABCS","and","back"],
  abcdefghijklmnop: [],
  recieveing: ["believing","recovering","deceiving","reviewing","rechecking"]
}

console.log('=== 2. every recorded suggestion list comes back byte for byte ===')
console.log(`  (plugin loaded in ${loadMs.toFixed(0)} ms, ${entry.cands.size} candidates)`)

{
  const words = Object.keys(GOLDEN)
  let differing = 0

  for (const word of words) {
    const want = GOLDEN[word]
    const got = suggest(word)

    if (JSON.stringify(got) !== JSON.stringify(want)) {
      differing++
      console.log(`  FAIL  "${word}"`)
      console.log(`        got  ${JSON.stringify(got)}`)
      console.log(`        want ${JSON.stringify(want)}`)
    }
  }

  if (differing) failures++
  console.log(`  ${differing === 0 ? 'PASS' : 'FAIL'}  ${words.length} words rank identically (${differing} differ)`)
}

console.log('\n=== 3. the pre-rewrite algorithm, on this dictionary, agrees ===')
console.log('  (independent of the recording above: this recomputes the lists)')

// Verbatim copy of the ranker's hot loop as it stood before the banded
// rewrite: three fresh arrays per candidate, the whole m x n matrix, and the
// same restricted-Damerau recurrence. It is slow on purpose — it is the oracle.
function editDistanceOracle(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) {
    return cap + 1
  }

  let prevPrev = new Array(b.length + 1)
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j
    prevPrev[j] = j
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowBest = curr[0]

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1

      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prevPrev[j - 2] + 1)
      }

      if (curr[j] < rowBest) {
        rowBest = curr[j]
      }
    }

    if (rowBest > cap) {
      return cap + 1
    }

    const spare = prevPrev

    prevPrev = prev
    prev = curr
    curr = spare
  }

  return prev[b.length]
}

function suggestOracle(word, limit) {
  const target = word.toLowerCase()
  const cap = target.length <= 3 ? 1 : target.length <= 6 ? 2 : 3
  const scored = []

  for (const [candidate, canonical] of entry.cands) {
    if (Math.abs(candidate.length - target.length) > cap) {
      continue
    }

    const mask = entry.words.get(candidate)

    if (candidate === target && mask && ranker.maskAllows(mask, word)) {
      continue
    }

    const d = editDistanceOracle(target, candidate, cap)

    if (d > cap) {
      continue
    }

    const fr = ranker.FREQ_RANK.get(candidate)

    scored.push([d, fr === undefined ? Number.MAX_SAFE_INTEGER : fr, candidate, canonical])
  }

  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const out = []
  const seen = new Set()

  for (const [, , candidate, canonical] of scored) {
    if (seen.has(candidate)) {
      continue
    }

    seen.add(candidate)

    if (canonical === canonical.toLowerCase() && word[0] === word[0].toUpperCase()) {
      out.push(canonical[0].toUpperCase() + canonical.slice(1))
    } else {
      out.push(canonical)
    }

    if (out.length >= limit) {
      break
    }
  }

  return out
}

{
  const words = Object.keys(GOLDEN)
  let wrong = 0

  for (const word of words) {
    const oracle = suggestOracle(word, ranker.SUGGESTION_ROWS)
    const got = suggest(word)

    if (JSON.stringify(oracle) !== JSON.stringify(got)) {
      wrong++
      console.log(`  FAIL  "${word}"`)
      console.log(`        ranker ${JSON.stringify(got)}`)
      console.log(`        oracle ${JSON.stringify(oracle)}`)
      continue
    }

    // And the oracle must reproduce the recording, or the recording is not
    // evidence of anything.
    if (JSON.stringify(oracle) !== JSON.stringify(GOLDEN[word])) {
      wrong++
      console.log(`  FAIL  "${word}" — the oracle does not reproduce the frozen list`)
    }
  }

  if (wrong) failures++
  console.log(`  ${wrong === 0 ? 'PASS' : 'FAIL'}  ${words.length} words: ranker == oracle == recording (${wrong} disagree)`)
}

console.log('\n=== 4. capitalisation semantics survive ===')
{
  check('"english" is corrected to "English"', suggest('english')[0], 'English')
  check('"hermes" is corrected to "Hermes"', suggest('hermes')[0], 'Hermes')
  check('"monday" is corrected to "Monday"', suggest('monday')[0], 'Monday')
  check('lookup("Hermes") is a word', ranker.lookup(entry, 'Hermes'), true)
  check('lookup("hermes") is NOT a word', ranker.lookup(entry, 'hermes'), false)
  check('lookup("English") is a word', ranker.lookup(entry, 'English'), true)

  let allRecapitalised = true

  for (const word of ['english', 'hermes', 'monday', 'englishman']) {
    const first = suggest(word)[0]

    if (first && first[0] !== first[0].toUpperCase()) {
      allRecapitalised = false
      console.log(`  FAIL  "${word}" was offered "${first}" — not capitalised`)
    }
  }

  check('a lowercase proper noun is offered capitalised', allRecapitalised, true)
}

console.log('\n=== 5. the menu caps at 6 rows, Add to dictionary last ===')
{
  check('SUGGESTION_ROWS is 5', ranker.SUGGESTION_ROWS, 5)

  const storage = { get() {}, set() {} }
  let worstRows = 0

  for (const word of ['teh', 'wich', 'recieve', 'definately', 'concious', 'speling']) {
    const rows = ranker.suggestionItems(word, 'en', storage)

    worstRows = Math.max(worstRows, rows.length)

    if (rows.length > 6) {
      console.log(`  FAIL  "${word}" produced ${rows.length} rows`)
    }

    if (rows.length && rows[rows.length - 1].label !== 'Add to dictionary') {
      console.log(`  FAIL  "${word}" does not end with Add to dictionary`)
    }
  }

  check('no word exceeds the 6-row cap', worstRows <= 6, true)
  check('a misspelling gets 5 suggestions plus Add to dictionary',
    ranker.suggestionItems('definately', 'en', storage).length, 6)
}

console.log('\n=== 6. the distance function, exhaustively, on strings no dictionary holds ===')
{
  // Sections 2 and 3 prove the RANKING is unchanged for words. This proves the
  // distance underneath it agrees with the pre-rewrite version for EVERY string
  // over a small alphabet up to length 6/7 — empty strings, runs of the same
  // letter, transpositions sitting exactly on the band edge. Those are the
  // shapes a real dictionary never contains, and they are where a band that is
  // one cell too narrow or a stale buffer row shows up.
  const prime = ranker.primeEditTarget
  const distance = ranker.editDistanceToTarget

  check('the distance internals are still there', [typeof prime, typeof distance], ['function', 'function'])

  const oracle = (a, b, cap) => editDistanceOracle(a, b, cap)

  const strings = (alphabet, maxLen) => {
    const out = ['']
    let layer = ['']

    for (let len = 1; len <= maxLen; len++) {
      const next = []

      for (const s of layer) {
        for (const ch of alphabet) {
          next.push(s + ch)
        }
      }

      out.push(...next)
      layer = next
    }

    return out
  }

  let compared = 0
  let bad = 0

  const fuzz = () => {
    for (const [alphabet, maxLen] of [['ab', 7], ['abc', 5], ['aab', 6], ['abcd', 4]]) {
      const list = strings(alphabet, maxLen)

      for (const b of list) {
        const n = prime(b)

        for (const a of list) {
          for (const cap of [0, 1, 2, 3]) {
            const want = oracle(a, b, cap)
            const got = distance(a, n, cap)

            compared++

            if ((want <= cap) !== (got <= cap) || (want <= cap && want !== got)) {
              bad++

              if (bad <= 3) {
                console.log(`  FAIL  d(${JSON.stringify(a)}, ${JSON.stringify(b)}) cap ${cap}: got ${got}, want ${want}`)
              }
            }
          }
        }
      }
    }
  }

  if (typeof prime === 'function' && typeof distance === 'function') {
    fuzz()
  }

  check(`${compared} string pairs agree with the full-matrix version`, bad, 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures ? 1 : 0)
