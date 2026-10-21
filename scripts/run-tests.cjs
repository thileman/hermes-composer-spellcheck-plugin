// Run every test suite in this repo. Each suite is a standalone Node script
// that exits non-zero on failure, so this is a plain loop — no framework.
//
//   node scripts/run-tests.cjs
//
// The suites read the real plugin source (desktop/plugin.js) and exercise the
// real functions out of it — they never re-implement the code under test.

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const TESTS = path.join(ROOT, 'tests')

const suites = fs
  .readdirSync(TESTS)
  .filter(f => f.endsWith('.test.cjs'))
  .sort()

if (!suites.length) {
  console.error('no test suites found in tests/')
  process.exit(1)
}

let failed = 0

for (const suite of suites) {
  console.log(`\n─── ${suite} ${'─'.repeat(Math.max(0, 56 - suite.length))}`)

  const result = spawnSync(process.execPath, [path.join(TESTS, suite)], {
    stdio: 'inherit',
    cwd: ROOT
  })

  if (result.status !== 0) {
    failed++
    console.error(`✗ ${suite} failed`)
  }
}

console.log('')

if (failed) {
  console.error(`✗ ${failed} of ${suites.length} suite(s) failed`)
  process.exit(1)
}

console.log(`✓ all ${suites.length} suite(s) passed`)
