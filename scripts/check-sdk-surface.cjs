// Check a desktop plugin against the Hermes Desktop Plugin SDK rules that
// `hermes plugins validate` cannot catch.
//
// The scanner's desktop-surface check is literal-regex based: it sees a
// forbidden selector only when the attribute appears INSIDE a
// querySelector() call. A selector hoisted into a const therefore passes the
// scanner while still being the thing the rule forbids. This script parses
// the file properly and checks the RULES, not a pattern.
//
//   node scripts/check-sdk-surface.cjs desktop/plugin.js
//
// Exits non-zero on any violation, so a green CI run means something.

const fs = require('fs')

const file = process.argv[2] || 'desktop/plugin.js'
const source = fs.readFileSync(file, 'utf8')
const lines = source.split('\n')

const violations = []


/** Strip comment contents but KEEP string contents — a selector, a hex colour
 *  and a JSX tag all live in strings or in raw source, so blanking strings
 *  would hide exactly what these rules are looking for. */
function stripComments(text) {
  let out = ''
  let i = 0
  let quote = null

  while (i < text.length) {
    const ch = text[i]
    const next = i + 1 < text.length ? text[i + 1] : ''

    if (quote) {
      out += ch
      if (ch === '\\') { out += next; i += 2; continue }
      if (ch === quote) quote = null
      i += 1
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1 }
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '; i += 2
      continue
    }

    out += ch
    i += 1
  }

  return out
}

/** Strip comments and string literals so a rule cannot match prose. */
function codeOnly(text) {
  let out = ''
  let i = 0
  let state = 'code'
  let quote = null

  while (i < text.length) {
    const ch = text[i]
    const next = i + 1 < text.length ? text[i + 1] : ''

    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (ch === "'" || ch === '"' || ch === '`') { state = 'str'; quote = ch; out += ' '; i += 1; continue }
      out += ch
      i += 1
      continue
    }

    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += '\n' }
      else out += ' '
      i += 1
      continue
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += ch === '\n' ? '\n' : ' '
      i += 1
      continue
    }

    // string literal
    if (ch === '\\') { out += '  '; i += 2; continue }
    if (ch === quote) { state = 'code'; out += ' '; i += 1; continue }
    out += ch === '\n' ? '\n' : ' '
    i += 1
  }

  return out
}

const code = codeOnly(source)
const codeLines = code.split('\n')

// Comment-stripped source that KEEPS string contents.
const sourceNoComments = stripComments(source)
const sourceNoCommentLines = sourceNoComments.split('\n')

function report(rule, detail, line) {
  violations.push({ rule, detail, line })
}

/**
 * 1. App-DOM reach.
 *
 * The forbidden attributes are data-slot / data-tour / data-sidebar /
 * data-testid. A SELECTOR lives inside a string literal, so the check has to
 * read string CONTENTS — codeOnly() blanks them, which is why the scanner's
 * literal-regex approach misses a selector that is hoisted into a const.
 *
 * Every string literal in the file is examined: if one contains a forbidden
 * attribute, that string is a selector reaching into the app's own markup.
 */
const APP_DOM_RE = /data-(slot|tour|sidebar|testid)/

function stringLiterals(text) {
  const out = []
  let i = 0
  let quote = null
  let start = 0
  let state = 'code'

  while (i < text.length) {
    const ch = text[i]
    const next = i + 1 < text.length ? text[i + 1] : ''

    // Comments are not selectors: skip them, but keep scanning for strings
    // AFTER them. The plugin documents the rule in a comment that quotes the
    // forbidden attribute names, and a comment is not a selector.
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue }
      if (ch === '/' && next === '*') { state = 'block'; i += 2; continue }
    } else if (state === 'line') {
      if (ch === '\n') state = 'code'
      i += 1
      continue
    } else if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; continue }
      i += 1
      continue
    }

    if (quote) {
      if (ch === '\\') { i += 2; continue }
      if (ch === quote) {
        out.push({ value: text.slice(start, i), line: text.slice(0, start).split('\n').length })
        quote = null
      }
      i += 1
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      start = i + 1
      i += 1
      continue
    }

    i += 1
  }

  return out
}

for (const lit of stringLiterals(source)) {
  if (APP_DOM_RE.test(lit.value)) {
    report(
      'app DOM reach',
      `a string contains ${lit.value.match(APP_DOM_RE)[0]} — querying the app's own markup is forbidden by the desktop surface rule (line ${lit.line})`,
      lit.line
    )
  }
}

/** 2. No document.body MutationObserver. */
codeLines.forEach((l, i) => {
  if (/\.observe\(\s*document\.body/.test(l)) {
    report('app DOM reach', 'observes document.body — forbidden by the desktop surface rule', i + 1)
  }
})

/** 3. No prototype patching, eval, new Function, script injection. */
const FORBIDDEN = [
  [/\.prototype\.\w+\s*=[^=]/, 'prototype patching'],
  [/Object\.definePropert(?:y|ies)\([^)]*\.prototype/, 'prototype patching'],
  [/\bsetPrototypeOf\(/, 'prototype patching'],
  [/__proto__\s*=/, 'prototype patching'],
  [/(?<![.\w])eval\(/, 'eval'],
  [/\bnew\s+Function\(/, 'new Function'],
  [/createElement\(\s*['"]script['"]\s*\)/, 'script injection'],
  [/import\s*\(\s*(?!['"](?:@hermes\/plugin-sdk|react)(?:\/[\w/-]*)?['"]\s*\))/s, 'dynamic import of code']
]

// These run over the comment-stripped source WITH string contents: a script
// tag is the STRING 'script', and a URL in a dynamic import() is a string
// too. Blanking strings would hide both.
for (const [pattern, label] of FORBIDDEN) {
  sourceNoCommentLines.forEach((l, i) => {
    if (pattern.test(l)) {
      report('forbidden construct', `${label} — ${l.trim().slice(0, 80)}`, i + 1)
    }
  })
}

/** 4. Only three import specifiers resolve in a disk plugin. */
const ALLOWED_IMPORTS = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
  if (!ALLOWED_IMPORTS.has(m[1])) {
    report('import allowlist', `imports "${m[1]}" — only ${[...ALLOWED_IMPORTS].join(', ')} resolve`, source.slice(0, m.index).split('\n').length)
  }
}

/**
 * 5. Never hardcode colours — theme variables only.
 *
 * A hex colour or an rgb() call is usually inside a string (a style value),
 * so this runs over the comment-stripped source WITH string contents intact.
 */
sourceNoCommentLines.forEach((l, i) => {
  if (/#[0-9a-fA-F]{3,8}\b/.test(l) || /\brgba?\s*\(/.test(l) || /\bhsla?\s*\(/.test(l)) {
    report('hardcoded colour', `a literal colour — use var(--ui-*) (line ${i + 1})`, i + 1)
  }
})

/** 6. Bare globals are not tracked by the host. */
codeLines.forEach((l, i) => {
  if (/^\s*(window|document|globalThis)\.addEventListener/.test(l)) {
    report('bare global', 'a global listener is not tracked — use ctx.addEventListener', i + 1)
  }
  if (/^\s*(window|globalThis)\.set(Interval|Timeout)\(/.test(l)) {
    report('bare global', 'a global timer is not tracked — use ctx.setInterval / ctx.setTimeout', i + 1)
  }
})

/**
 * 7. A disk plugin loads uncompiled: JSX syntax will not parse.
 *
 * JSX appears either as a statement (`<div>…</div>`) or as an expression
 * (`const a = <div>…</div>`), so the tag is looked for anywhere in the line.
 */
sourceNoCommentLines.forEach((l, i) => {
  // A JSX tag is '<' + a name. It may start the line (a statement) or follow
  // an operator (an expression), so the char before '<' is anything that is
  // not part of an identifier.
  if (/(?:^|[^\w$.])<[A-Za-z][A-Za-z0-9.]*(?:\s|\/|>)/.test(l)) {
    report('jsx syntax', 'a disk plugin is loaded uncompiled — use jsx()/jsxs()', i + 1)
  }
})

/** 8. Every capitalised identifier used in a jsx() call must be imported. */
const imported = new Set()
for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
  for (const n of m[1].split(',')) {
    const name = n.trim()
    if (name) imported.add(name)
  }
}
for (const m of source.matchAll(/import\s+(\w+)\s+from/g)) imported.add(m[1])

const KNOWN = new Set([
  'React', 'Fragment', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Map', 'Set', 'Error', 'TypeError', 'RangeError', 'Date', 'RegExp', 'URL',
  'Blob', 'File', 'FileReader', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'Node', 'NodeFilter', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'DocumentFragment', 'Text', 'Range', 'Selection', 'KeyboardEvent', 'InputEvent',
  'CompositionEvent', 'ClipboardEvent', 'PointerEvent', 'MouseEvent', 'CustomEvent',
  'Event', 'EventTarget', 'AbortController', 'Intl', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
  'Symbol', 'BigInt', 'Infinity', 'NaN', 'undefined', 'globalThis', 'window', 'document',
  'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'structuredClone', 'crypto',
  'performance', 'queueMicrotask', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'ArrayBuffer'
])

// Every declaration at ANY depth: a `const P = ...` inside a function body is
// a local too, and treating it as undefined is a false positive.
const localDefs = new Set(
  [...source.matchAll(/(?:^|[\s;{(])(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1])
)

// Only identifiers used as a COMPONENT in a jsx()/jsxs() call can be an
// undefined-component ReferenceError. Scanning every capitalised call would
// flag unrelated local helpers and words in prose.
const used = new Set()
for (const m of code.matchAll(/\bjsx[s]?\(\s*([A-Z][A-Za-z0-9_$]*)/g)) used.add(m[1])
for (const m of code.matchAll(/\bjsx[s]?\(\s*[A-Za-z_$][\w$]*\s*,\s*\{[^{}]*?\b([A-Z][A-Za-z0-9_$]*)\s*:/gs)) used.add(m[1])

for (const name of [...used].sort()) {
  if (imported.has(name) || KNOWN.has(name) || localDefs.has(name)) continue
  report('undefined identifier', `"${name}" is used but never imported — it is a ReferenceError at render`, null)
}

/** Report. */
console.log(`checking ${file}`)
console.log(`  ${imported.size} imported name(s), ${used.size} capitalised call(s) in use`)
console.log('')

if (!violations.length) {
  console.log('OK — the plugin stays inside the SDK surface.')
  process.exit(0)
}

for (const v of violations) {
  console.log(`  ✗ ${v.rule}: ${v.detail}`)
}
console.log('')
console.log(`${violations.length} violation(s).`)
process.exit(1)
