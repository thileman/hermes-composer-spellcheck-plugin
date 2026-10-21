# Hermes Composer Spellcheck

Spell check for the Hermes Desktop composer.

The desktop app ships the entire spell-check stack — Chromium's Hunspell
dictionaries, the context-menu plumbing, the right-click suggestion UI — but
every input opts out of it (`spellCheck={false}` in
`apps/desktop/src/app/chat/composer/index.tsx`), so none of it is reachable
from the composer. This plugin turns it back on and adds the piece the app
cannot provide: a working suggestion menu.

## What it does

- **Restores the squiggles** in the composer and the message-edit composer.
- **Adds a right-click suggestion menu** with ranked alternatives, injected
  into the app's *own* context menu — the app's Cut/Copy/Paste/Select All
  stay exactly where they were.
- **Ranks with a standard dictionary.** The English word list is the
  SCOWL/Hunspell corpus from
  [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) (the same
  word data Firefox and LibreOffice ship), embedded and affix-expanded at
  load into ~118k real word forms. Ranking is Damerau-Levenshtein distance,
  tie-broken by a bundled corpus frequency list.
- **Custom words.** Add a word from the right-click menu or from the
  **Custom Words** page; it stops being flagged immediately.
- **Optionally ignores code spans** — `` `backtick` `` runs, file names and
  paths are not underlined.
- **Settings** live under **Settings → Plugins → Composer Spell Check**, and
  the word list is on its own page at `/spellcheck-dictionary` (sidebar:
  **Spellcheck**).

## Install

Drop the plugin into your Hermes home and reload:

```
$HERMES_HOME/desktop-plugins/hermes-composer-spellcheck-plugin/plugin.js
```

Then press `⌘K` → **Reload desktop plugins**. The plugin appears in
**Capabilities → Plugins**, where you can turn it off.

## How it works, and why it looks the way it does

Chromium will not populate a spell payload for a `contenteditable` element —
measured, not assumed: the same build returns `misspelledWord` and
`dictionarySuggestions` for a real `<textarea>` and empty strings for a
`contenteditable`, which is what the composer is. So the plugin supplies the
dictionary and ranks locally, and injects the suggestion rows into the app's
own menu rather than drawing a second one beside it.

The plugin uses the documented SDK surface for everything it can:
`ctx.register` for the route and the sidebar row, `ctx.registerSettingsPage`
for the settings page, `ctx.storage` for persistence, `ctx.addEventListener`
for its listeners, and `host.notify` for feedback. It imports only
`@hermes/plugin-sdk`, `react` and `react/jsx-runtime`.

## Disclosures

The plugin catalog asks that a user know what a plugin does before
installing it. This plugin:

- **Makes a network request** to `raw.githubusercontent.com` — specifically the
  `wooorm/dictionaries` repository — to fetch the `.dic`/`.aff` word lists
  for a non-English locale. English is embedded, so the plugin works fully
  offline on first run. The fetched files are *data* (a word list); no code
  is fetched and nothing is executed. Nothing is fetched unless you switch
  the language away from English.
- **Writes to Chromium's own custom dictionary**
  (`Custom Dictionary.txt` in the app's user-data directory), so a word you
  add is remembered by the browser's spell checker and not flagged again.
  This is the app's own spell-check mechanism, reached through its
  context-menu bridge.
- **Reaches into the composer's DOM** to switch spell check on and to wrap
  code spans. There is currently no SDK surface for either — `host.composer`
  moves text in and out of the editor, and cannot toggle the browser's
  spell checker or mark a span as code. The selectors used are public
  accessibility attributes (`role="textbox"` + `contentEditable`), not the
  app's internal markup slots, so a markup change is unlikely to break it.
  If Hermes gains a spell-check hook, this plugin should use it.
- **Does not** collect telemetry, read files outside the app's own data
  directory, run shell commands, or start background processes.

## Development

```
desktop/plugin.js          the plugin (single ESM file, loaded uncompiled)
plugin.yaml                the manifest
scripts/run-tests.cjs      runs every suite
scripts/check-sdk-surface.cjs   the SDK surface rules
scripts/check_plugin_classes.py checks every CSS class against the app
tests/                     the test suites
```

The plugin is plain ESM loaded **uncompiled** — no JSX syntax, no build step.
Write UI with `jsx()` / `jsxs()` from `react/jsx-runtime`.

### Tests

```bash
npm install --no-save jsdom @babel/parser
node scripts/run-tests.cjs
```

Every suite reads the real `desktop/plugin.js` and exercises the real
functions out of it — nothing is re-implemented, so a test cannot pass while
the shipped code is broken. They exist because the failures they cover are
all *silent*: a dead Tailwind class renders invisible text, a `jsx()` call
that passes children as the third argument renders an empty element, and a
code-span mask that cannot be undone corrupts the user's draft. None of them
raise an error.

| suite | what it proves |
|---|---|
| `tests/jsx-args.test.cjs` | no `jsx()` call passes children as the third argument (React's automatic runtime treats it as the *key*, so the element renders empty) |
| `tests/mask-code-spans.test.cjs` | code spans are masked and unmasked, the text round-trips byte-for-byte, and the caret survives the DOM surgery |
| `tests/pattern.test.cjs` | `src/app.ts` matches; `e.g.`, `i.e.`, `etc.` and `a.b.c` do not |
| `tests/selectors.test.cjs` | the composer is found by role, not by the app's private slot names |

### Checks

```bash
node scripts/check-sdk-surface.cjs desktop/plugin.js
```

Enforces the Desktop Plugin SDK rules that `hermes plugins validate` cannot
catch, because its checks are literal-regex based: a forbidden selector
hoisted into a `const` slips past the scanner while still being what the
rule forbids. The script parses the file and checks the rules, not a pattern.

### CI

| workflow | what it does |
|---|---|
| `.github/workflows/plugin-validate.yml` | checks out **current `hermes-agent` main** and runs `hermes plugins validate` against it — the same gate the catalog runs, against the same scanner, not a pinned copy |
| `.github/workflows/tests.yml` | the test suites, plus an ESM parse and a real import of the plugin with a stubbed SDK |
| `.github/workflows/sdk-surface.yml` | the SDK surface rules above |

## Contributing

Contributions are welcome — open an issue or a pull request.

**Before you open a pull request:**

1. `node scripts/run-tests.cjs` passes.
2. `node scripts/check-sdk-surface.cjs desktop/plugin.js` passes.
3. `hermes plugins validate .` passes (CI runs it against current `main`).
4. If you changed the UI, add or update a screenshot in `docs/` and say what
   changed in the PR description.

**House rules:**

- **Never change the plugin's `id`.** It is the storage namespace
  (`hermes.plugin.<id>.*`) and the catalog entry name. Renaming it orphans
  every user's saved custom words.
- **The dictionary is data, not code.** The embedded word list must stay
  plain, readable text — never base64, never encoded. A reviewer has to be
  able to read it (catalog rule 17).
- **Do not add a dependency the loader cannot resolve.** Only
  `@hermes/plugin-sdk`, `react` and `react/jsx-runtime` are importable.
- **Do not hardcode a colour.** Use `var(--ui-*)`.
- **Do not add a bare global listener or timer.** Use `ctx.addEventListener`
  / `ctx.setInterval` — a bare global is not tracked by the host, so it
  survives disable and every hot reload.
- **Reach for the SDK first.** If you need a capability the SDK does not
  have, open an issue on
  [hermes-agent](https://github.com/NousResearch/hermes-agent) rather than
  reaching into the app's markup.
- **Keep the surface small.** The plugin's contribution areas are a route, a
  sidebar row, a settings page and a context-menu injection. New UI goes in
  one of those.

**Reporting a bug:** please include your Hermes version
(`Help → About`), your OS, and what you expected versus what happened. For a
word that is not recognised, say whether it is in the standard dictionary at
all — a word the corpus does not contain is a different problem from one it
does.

## License

MIT — see [LICENSE](LICENSE).
