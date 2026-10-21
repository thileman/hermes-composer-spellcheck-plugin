// AST-accurate check: React's automatic runtime is jsx(type, config, maybeKey).
// A 3rd positional argument is the KEY. Passing children there renders an
// EMPTY element — the text silently becomes the key.
//
// Parses the plugin with Babel and reports every jsx()/jsxs() call whose 3rd
// argument is not `undefined` (i.e. children were passed the wrong way).

const fs = require('fs')
const path = require('path')
const babel = require(resolveDep('@babel/parser'))

// Resolve the plugin and its deps relative to THIS file, so the suite runs
// from any checkout root with no arguments.
const PLUGIN = path.join(__dirname, '..', 'desktop', 'plugin.js')

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


const pluginPath = PLUGIN
const source = fs.readFileSync(pluginPath, 'utf8')

const ast = babel.parse(source, {
  sourceType: 'module',
  plugins: ['jsx'],
  errorRecovery: true
})

const offenders = []

function walk(node, parent) {
  if (!node || typeof node !== 'object') return

  if (node.type === 'CallExpression') {
    const callee = node.callee
    const isJsx =
      callee &&
      callee.type === 'Identifier' &&
      (callee.name === 'jsx' || callee.name === 'jsxs')

    if (isJsx && node.arguments.length >= 3) {
      const third = node.arguments[2]
      const line = third.loc ? third.loc.start.line : node.loc.start.line
      offenders.push({
        line,
        snippet: source.slice(node.start, Math.min(node.end, node.start + 120)).replace(/\s+/g, ' ')
      })
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) walk(c, node)
    } else if (child && typeof child.type === 'string') {
      walk(child, node)
    }
  }
}

walk(ast, null)

if (!offenders.length) {
  console.log('OK — no jsx()/jsxs() call passes a 3rd positional argument.')
  process.exit(0)
}

console.log(`FOUND ${offenders.length} jsx()/jsxs() call(s) with a 3rd positional argument:`)
for (const o of offenders) {
  console.log(`  line ${o.line}: ${o.snippet}`)
}
console.log('')
console.log('React automatic runtime: jsx(type, config, maybeKey) — the 3rd argument')
console.log('is the KEY. Children must be config.children. Passing them 3rd renders')
console.log('an EMPTY element: the text becomes the key and nothing is shown.')
process.exit(1)
