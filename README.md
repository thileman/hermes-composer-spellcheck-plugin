# Hermes Composer Spellcheck

Spell check for the Hermes Desktop composer — squiggles, a right-click
suggestion menu, and a place to keep the words you use.

The desktop app already ships Chromium's Hunspell dictionaries and the
right-click menu plumbing, but the composer opts out of all of it, so you get
no squiggles and no suggestions while typing. This plugin turns it back on.

---

## For users

### What you get

- **Squiggles** under misspelled words in the composer and in the
  message-edit composer.
- **A right-click suggestion menu.** Right-click a misspelled word and you get
  ranked alternatives — inside the app's *own* context menu, so Cut, Copy,
  Paste and Select All are still exactly where you expect them.
- **A word list you control.** Add a word — a product name, a colleague's
  handle, your own jargon — and it stops being flagged. Find it again on the
  **Custom Words** page.
- **Optionally, no squiggles on code.** Turn on *Ignore code spans* and
  `` `backtick` `` runs, file names and paths are left alone.

### Install

Copy the plugin into your Hermes home and reload the app:

```
$HERMES_HOME/desktop-plugins/hermes-composer-spellcheck-plugin/plugin.js
```

`$HERMES_HOME` is `~/.hermes` by default. Then press `⌘K` → **Reload desktop
plugins**.

The plugin appears in **Capabilities → Plugins**, where you can turn it off
again, and its settings are in **Settings → Plugins → Composer Spell
Check**.

### Using it

**Suggest a correction.** Right-click a word with a squiggle under it. The
suggestions appear at the top of the menu; click one to replace the word.
Arrow keys work.

**Add a word for good.** Right-click the word → **Add to dictionary**. The
squiggle goes away immediately and the word is saved.

**Manage your words.** Click **Spellcheck** in the sidebar, or open
**Settings → Plugins → Composer Spell Check → Custom Words**. There you can
search your words, add more (one at a time, or several comma-separated), and
delete any you have added by mistake.

The search filters as you type: `o` narrows to every word starting with *o*,
`op` narrows further, and so on.

**Settings.**

| setting | what it does |
|---|---|
| Enable spell check | turns the squiggles on and off |
| Language | which dictionary to use — *Automatic* follows the app's language |
| Ignore code spans | leaves `` `code` ``, file names and paths unflagged |

### What it does on your machine

Worth knowing before you install it:

- **English works offline.** The English word list is built into the plugin.
  Switch the language to something else and it fetches that dictionary from
  `raw.githubusercontent.com` (the `wooorm/dictionaries` project — the same
  word data Firefox and LibreOffice use). Nothing is fetched unless you
  change the language, and only word lists are fetched, never code.
- **It writes to your browser's spell-check dictionary**
  (`Custom Dictionary.txt` in the app's data directory), which is how a word
  you add stays unflagged. That is the app's own spell-check mechanism.
- **No telemetry, no shell commands, no background processes.**

---

## For developers

### Layout

```
desktop/plugin.js          the plugin — one ESM file, loaded uncompiled
plugin.yaml                the manifest
tests/                     the test suites
scripts/                   the test runner and the checks
docs/                      screenshots for the catalog page
```

The plugin is plain ESM loaded **uncompiled** — there is no build step. Write
UI with `jsx()` / `jsxs()` from `react/jsx-runtime`; JSX syntax will not
parse in a disk plugin.

### How it works

Chromium will not populate a spell payload for a `contenteditable` element.
That was measured, not assumed: the same build returns `misspelledWord` and
`dictionarySuggestions` for a real `<textarea>` and empty strings for a
`contenteditable`, and the composer is a `contenteditable`. No amount of DOM
manipulation redirects the gesture — Chromium binds the spell context to the
element that originated it.

So the plugin supplies the dictionary and ranks locally:

- **Dictionary** — the SCOWL/Hunspell corpus from
  [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries), embedded
  and affix-expanded at load into ~118k real word forms. (A stem-only parse
  is only *half* a dictionary: `definitely` and `grammatically` have no
  standalone entry upstream and can never be produced without the affix
  expansion.)
- **Ranking** — Damerau-Levenshtein distance, tie-broken by a bundled corpus
  frequency list, because Hunspell carries no counts and alphabetical order
  puts `te` above `the`.
- **Menu** — the plugin leaves the app's own menu completely alone and
  *prepends* its rows into the DOM the app just rendered, copying padding,
  font and colour from a menu item the app already drew, so the rows are
  native rather than an imitation.

### SDK surface

Everything that has an SDK door uses it: `ctx.register` for the route and the
sidebar row, `ctx.registerSettingsPage` for the settings page, `ctx.storage`
for persistence, `ctx.addEventListener` for listeners, `ctx.onDispose` for
teardown, `host.notify` for feedback. The only importable specifiers are
`@hermes/plugin-sdk`, `react` and `react/jsx-runtime`.

Three things have no SDK door yet, and the plugin reaches for the DOM for
each: turning the browser's spell checker on for the composer, contributing
rows to the app's context menu, and marking a span as code. The selectors
used are public accessibility attributes (`role="textbox"` +
`contentEditable`), not the app's internal markup slots. If Hermes grows a
spell-check hook, this plugin should use it — see the note in
[Disclosures](#disclosures).

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
| `tests/jsx-args.test.cjs` | no `jsx()` call passes children as the third argument — React's automatic runtime reads it as the *key*, so the element renders empty |
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
rule forbids. This script parses the file and checks the rules, not a
pattern.

### CI

| workflow | what it does |
|---|---|
| `.github/workflows/plugin-validate.yml` | checks out **current `hermes-agent` main** and runs `hermes plugins validate` against it — the same gate the catalog runs, against the same scanner, not a pinned copy |
| `.github/workflows/tests.yml` | the test suites, plus an ESM parse and a real import of the plugin with a stubbed SDK |
| `.github/workflows/sdk-surface.yml` | the SDK surface rules above |

## Disclosures

- **Network:** `raw.githubusercontent.com` — the `wooorm/dictionaries` project
  — for a non-English dictionary. English is embedded, so the plugin is fully
  offline on first run. Word lists are data; no code is fetched and nothing
  is executed.
- **Writes outside its own data:** Chromium's `Custom Dictionary.txt`, through
  the app's own spell-check bridge, so an added word stays unflagged.
- **Reaches into the composer's DOM** to switch spell check on and to wrap
  code spans. There is no SDK surface for either today — `host.composer` moves
  text in and out of the editor and cannot toggle the browser's spell checker
  or mark a span as code. If Hermes gains a hook, this plugin should use it.
- **Does not:** collect telemetry, read files outside the app's data
  directory, run shell commands, or start background processes.

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
- **Keep the surface small.** The contribution areas are a route, a sidebar
  row, a settings page and a context-menu injection. New UI goes in one of
  those.

**Reporting a bug:** please include your Hermes version (Help → About), your
OS, and what you expected versus what happened. For a word that is not
recognised, say whether it is in the standard dictionary at all — a word the
corpus does not contain is a different problem from one it does.

## License

MIT — see [LICENSE](LICENSE).
