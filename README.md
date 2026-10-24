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
- **Adds a right-click suggestion menu** with ranked alternatives,
  contributed to the app's *own* context menu — the app renders it as its own
  section, between its spell-check rows and Cut/Copy/Paste/Select All, so
  nothing about the menu is re-implemented here.
- **Ranks with a standard dictionary.** The English word list is the
  SCOWL/Hunspell corpus from
  [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) (the same
  word data Firefox and LibreOffice ship), embedded and affix-expanded at
  load into ~118k real word forms. Ranking is Damerau-Levenshtein distance,
  tie-broken by a bundled corpus frequency list.
- **Keeps the dictionary's capitalisation.** The corpus distinguishes
  `Hermes` from `hermes` and `Monday` from `monday`, and so does this
  plugin: a lowercase proper noun is flagged, and the suggestion offered is
  the capitalised form Chromium accepts — right-click `english` and
  **English** is the first row. Suggesting the lowercase spelling would
  leave the word underlined after you accepted it.
- **Custom words.** Add a word from the right-click menu or from the
  **Custom Words** page; it stops being flagged immediately.
- **Optionally ignores code spans** — `` `backtick` `` runs, file names and
  paths are not underlined.
- **Settings** live under **Settings → Plugins → Composer Spell Check**, and
  the word list is on its own page at `/spellcheck-dictionary`. A
  **Show in the sidebar** switch controls whether a **Spellcheck** row
  appears in the sidebar; the page stays reachable from the settings either
  way, so turning the row off never hides the feature.

## Install

Drop the plugin into your Hermes home and reload:

```
$HERMES_HOME/desktop-plugins/hermes-composer-spellcheck-plugin/plugin.js
```

Then press `⌘K` → **Reload desktop plugins**. The plugin appears in
**Capabilities → Plugins**, where you can turn it off.

## Using it

**Suggest a correction.** Right-click a word with a squiggle under it. The
suggestions appear in their own section of the menu; click one to replace the
word.

**Add a word for good.** Right-click the word → **Add to dictionary**. The
squiggle goes away immediately and the word is saved.

**Manage your words.** Open **Settings → Plugins → Composer Spell Check →
Custom Words**, or click **Spellcheck** in the sidebar if you left that row
showing. There you can search your words, add more (one at a time, or several
comma-separated), and delete any you have added by mistake. The search
filters as you type: `o` narrows to every word starting with *o*, `op`
narrows further, and so on.

**Settings.**

| setting | what it does |
|---|---|
| Check spelling | turns the squiggles on and off |
| Language | which dictionary to use — *Automatic* follows the app's language |
| Ignore code spans | leaves `` `code` ``, file names and paths unflagged |
| Show in the sidebar | shows a **Spellcheck** row in the sidebar. The Custom Words page is always available from the settings, whether the row is shown or not. |

## How it works, and why it looks the way it does

Chromium will not populate a spell payload for a `contenteditable` element —
measured, not assumed: the same build returns `misspelledWord` and
`dictionarySuggestions` for a real `<textarea>` and empty strings for a
`contenteditable`, which is what the composer is. So the plugin supplies the
dictionary and ranks locally, and contributes its rows to the app's own menu
(`COMPOSER_AREAS.contextMenu`) rather than drawing a second one beside it. The
app renders the rows, caps them, closes the menu and restores the caret before
it calls the plugin's `onSelect`, which applies the correction through
`action.replaceWord()` — or, for a host without that action,
`host.composer.getDraft()` / `setDraft()`. The plugin never edits the editor's
DOM.

The plugin uses the documented SDK surface for everything it can:
`ctx.register` for the route, the sidebar row and the context-menu rows,
`ctx.registerSettingsPage` for the settings page, `ctx.storage` for
persistence, `ctx.addEventListener` for its listeners, `host.composer` for the
draft and for spell check, `host.spellcheck` for the app's dictionary, and
`host.notify` for feedback. It imports only `@hermes/plugin-sdk`, `react` and
`react/jsx-runtime`.

## Disclosures

The plugin catalog asks that a user know what a plugin does before
installing it. This plugin:

- **Makes a network request** to `raw.githubusercontent.com` — specifically the
  `wooorm/dictionaries` repository — to fetch the `.dic`/`.aff` word lists
  for a non-English locale. English is embedded, so the plugin works fully
  offline on first run. The fetched files are *data* (a word list); no code
  is fetched and nothing is executed. Nothing is fetched unless you switch
  the language away from English.
- **Adds and removes words in the app's spell-check dictionary** through
  `host.spellcheck.addWord` / `removeWord`, so a word you add stops being
  flagged and one you delete is flagged again. The app owns that store
  (Chromium's `Custom Dictionary.txt` in its user-data directory); the plugin
  never writes the file itself. The plugin also keeps its own list in
  `ctx.storage` under `customWords` — that list is the source of truth the
  Custom Words page renders.
- **Asks the app to turn the browser's spell checker on**, via
  `host.composer.setSpellcheck(...)`. Nothing is written onto the composer's
  `spellcheck` or `lang` attributes any more.
- **Wraps code spans in `<code spellcheck="false">`** inside the composer when
  *Ignore code spans* is on. This is the one place the plugin still edits the
  editor's DOM, and it undoes itself: the wrappers are unwrapped when the
  setting is switched off and the text round-trips byte-for-byte. The
  selectors it uses are public accessibility attributes (`role="textbox"` +
  `contentEditable`), not the app's internal markup slots.
- **Does not** collect telemetry, read files outside the app's own data
  directory, run shell commands, or start background processes.

### The `setSpellcheck` trade-off

`host.composer.setSpellcheck` is newer than the released SDK, so the plugin
feature-detects it. When it is absent there is deliberately **no DOM
fallback**: the composer keeps the app's default (Chromium's spell check off,
so no red squiggles), and everything else keeps working. The plugin computes
and ranks its own suggestions from its own dictionary, so right-clicking a
misspelling still offers the right corrections and applies them — Chromium
only paints the underline. When the API lands, the squiggles light up with no
further change here.

## Development

```
desktop/plugin.js          the plugin (single ESM file, loaded uncompiled)
plugin.yaml                the manifest
scripts/run-tests.cjs      runs every suite
scripts/check-sdk-surface.cjs   the SDK surface rules
scripts/check_plugin_classes.py checks every CSS class against the app
scripts/strip-literals.cjs  blanks comments and literals for the symbol scan
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
that passes children as the third argument renders an empty element, a
code-span mask that cannot be undone corrupts the user's draft, and a helper
that was lost in an edit throws only when the feature that calls it is used.
None of them raise an error at build time.

| suite | what it proves |
|---|---|
| `tests/jsx-args.test.cjs` | no `jsx()` call passes children as the third argument (React's automatic runtime treats it as the *key*, so the element renders empty) |
| `tests/mask-code-spans.test.cjs` | code spans are masked and unmasked, the text round-trips byte-for-byte, and the caret survives the DOM surgery |
| `tests/pattern.test.cjs` | `src/app.ts` matches; `e.g.`, `i.e.`, `etc.` and `a.b.c` do not |
| `tests/selectors.test.cjs` | the composer is found by role, not by the app's private slot names |
| `tests/sidebar-toggle.test.cjs` | flipping the *Show in the sidebar* switch removes the row and leaves the page reachable — driven through the real settings switch |
| `tests/settings-custom-words-link.test.cjs` | the *Custom Words* link targets the settings sub-page, not the top-level route that closes Settings |
| `tests/settings-render.test.cjs` | the settings page renders in a real React DOM, so a row React refuses to render fails the build |
| `tests/dictionary-case.test.cjs` | the dictionary keeps its capitalisation: `Hermes` is a word, `hermes` is not, and a typo offers the spelling the dictionary actually holds |
| `tests/menu-case.test.cjs` | the context-menu contribution: `data.items()` returns the right rows (right-click `english` → **English** first), a correctly spelled word returns none, and `onSelect` calls `action.replaceWord`; also that the old DOM injection and private bridge are gone |
| `tests/dictionary-seam.test.cjs` | add calls `host.spellcheck.addWord` **and** records the word in storage; remove (through the Custom Words page's own button) calls `removeWord` **and** drops it — the two stores move together |
| `tests/correction-seam.test.cjs` | a correction goes through `action.replaceWord`, or `host.composer.getDraft`/`setDraft` when there is no action — never `execCommand`/`insertNode`, and an ambiguous word is left alone |
| `tests/defined-symbols.test.cjs` | no function that existed in the first commit is called without being defined (three helpers were lost this way) |

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
  sidebar row, a settings page and a composer context-menu contribution. New
  UI goes in one of those.

**Reporting a bug:** please include your Hermes version
(`Help → About`), your OS, and what you expected versus what happened. For a
word that is not recognised, say whether it is in the standard dictionary at
all — a word the corpus does not contain is a different problem from one it
does.

## License

MIT — see [LICENSE](LICENSE).

<!-- CI now runs on every push: the path filters skipped most commits. -->
