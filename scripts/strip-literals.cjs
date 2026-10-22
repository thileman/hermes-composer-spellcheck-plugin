// A single-pass scanner that blanks out comments, strings, template literals
// and regex literals, so a scan for definitions and calls sees only CODE.
//
// A chain of regex replacements cannot do this. The obvious order -- strings
// first, then comments -- breaks on an apostrophe inside a comment: "the
// app's own menu" opens a fake string that runs on until the next apostrophe
// anywhere in the file, swallowing hundreds of lines of real code. The
// opposite order breaks on a "//" inside a string. Both orders lose
// definitions, which makes a "is this function defined?" scan report
// functions that are plainly there.
//
// This walks the source once, tracking state, and replaces every literal and
// comment with spaces of the same length -- so offsets stay meaningful and
// nothing shifts.

const TEMPLATE = 0
const SINGLE = 1
const DOUBLE = 2
const LINE_COMMENT = 3
const BLOCK_COMMENT = 4
const REGEX = 5

// A '/' starts a regex, not a division, when the previous significant
// character cannot end an expression.
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
])
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else',
  'yield', 'await', 'throw',
])

function blank(text) {
  return text.replace(/[^\n]/g, ' ')
}

/**
 * Blank out every literal and comment, preserving length and newlines.
 */
function stripLiteralsAndComments(src) {
  const out = src.split('')
  const n = src.length
  let i = 0
  let state = null
  // The last significant code character, for regex-vs-division.
  let prevCode = ''
  let prevWord = ''

  const blankRange = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
    }
  }

  while (i < n) {
    const ch = src[i]

    if (state === null) {
      if (ch === '/' && src[i + 1] === '/') {
        state = LINE_COMMENT
        blankRange(i, i + 2)
        i += 2
        continue
      }
      if (ch === '/' && src[i + 1] === '*') {
        state = BLOCK_COMMENT
        blankRange(i, i + 2)
        i += 2
        continue
      }
      if (ch === "'" || ch === '"') {
        state = ch === "'" ? SINGLE : DOUBLE
        blankRange(i, i + 1)
        i += 1
        continue
      }
      if (ch === '`') {
        state = TEMPLATE
        blankRange(i, i + 1)
        i += 1
        continue
      }
      if (ch === '/') {
        // Regex or division?
        const isRegex = REGEX_PRECEDERS.has(prevCode) || REGEX_KEYWORDS.has(prevWord)
        if (isRegex) {
          state = REGEX
          blankRange(i, i + 1)
          i += 1
          continue
        }
      }
      if (/\S/.test(ch)) {
        prevCode = ch
        if (/[A-Za-z_$]/.test(ch)) {
          prevWord += ch
        } else {
          prevWord = ''
        }
      } else if (ch === '\n') {
        prevCode = ''
        prevWord = ''
      }
      i += 1
      continue
    }

    if (state === LINE_COMMENT) {
      if (ch === '\n') {
        state = null
        i += 1
        continue
      }
      out[i] = ' '
      i += 1
      continue
    }

    if (state === BLOCK_COMMENT) {
      if (ch === '*' && src[i + 1] === '/') {
        blankRange(i, i + 2)
        i += 2
        state = null
        continue
      }
      if (ch !== '\n' && ch !== '\r') out[i] = ' '
      i += 1
      continue
    }

    if (state === REGEX) {
      if (ch === '\\') {
        blankRange(i, i + 2)
        i += 2
        continue
      }
      if (ch === '/') {
        blankRange(i, i + 1)
        i += 1
        // Flags.
        while (i < n && /[a-z]/.test(src[i])) {
          out[i] = ' '
          i += 1
        }
        state = null
        prevCode = '/'
        prevWord = ''
        continue
      }
      if (ch === '\n') {
        // Not a regex after all (unterminated) -- back out.
        state = null
        i += 1
        continue
      }
      if (ch !== '\n' && ch !== '\r') out[i] = ' '
      i += 1
      continue
    }

    // String or template literal.
    if (ch === '\\') {
      blankRange(i, i + 2)
      i += 2
      continue
    }
    if (state === SINGLE && ch === "'") {
      out[i] = ' '
      i += 1
      state = null
      prevCode = ''
      prevWord = ''
      continue
    }
    if (state === DOUBLE && ch === '"') {
      out[i] = ' '
      i += 1
      state = null
      prevCode = ''
      prevWord = ''
      continue
    }
    if (state === TEMPLATE && ch === '`') {
      out[i] = ' '
      i += 1
      state = null
      prevCode = ''
      prevWord = ''
      continue
    }
    if (ch !== '\n' && ch !== '\r') out[i] = ' '
    i += 1
  }

  return out.join('')
}

module.exports = { stripLiteralsAndComments, blank }
