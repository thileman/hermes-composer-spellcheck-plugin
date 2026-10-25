# Hermes Composer Spellcheck

Spell check for the Hermes Desktop composer.

The desktop app ships the entire spell-check stack — Chromium's Hunspell
dictionaries, the context-menu plumbing, the right-click suggestion UI — but
every input opts out of it (`spellCheck={false}` in
`apps/desktop/src/app/chat/composer/index.tsx`), so none of it is reachable
from the composer. This plugin turns it back on and adds the piece the app
cannot provide: a working suggestion menu.

## What it does

- **Checks your spelling, with one switch.** **Check spelling** turns the
  squiggles *and* the right-click suggestions on and off together: off means
  no underlines and no suggestion rows, not just no underlines. The squiggles
  themselves need `host.composer.setSpellcheck`, which is in an open upstream
  PR and is in no release yet — without it the plugin leaves Chromium's spell
  check off (deliberately, with no DOM-attribute fallback), so a released
  build underlines nothing, and the switch's visible effect there is to turn
  the suggestion rows off. The suggestions are ranked from the plugin's own
  dictionary and need only the menu seam described under
  [Install](#install).
- **Adds a right-click suggestion menu** with ranked alternatives,
  contributed to the app's *own* context menu — the app renders it as its own
  section, between its spell-check rows and Cut/Copy/Paste/Select All, so
  nothing about the menu is re-implemented here.
- **Ranks with a standard dictionary.** The English word list is the
  SCOWL/Hunspell corpus from
  [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) (the same
  word data Firefox and LibreOffice ship), pinned to commit
  `8cfea406b505e4d7df52d5a19bce525df98c54ab`, embedded and affix-expanded at
  load into ~118k real word forms. Every other locale uses the same corpus,
  fetched from that same pinned commit. Ranking is Damerau-Levenshtein
  distance, tie-broken by a bundled corpus frequency list.
- **Keeps the dictionary's capitalisation.** The corpus distinguishes
  `Hermes` from `hermes` and `Monday` from `monday`, and so does this
  plugin: a lowercase proper noun is flagged, and the suggestion offered is
  the capitalised form Chromium accepts — right-click `english` and
  **English** is the first row. Suggesting the lowercase spelling would
  leave the word underlined after you accepted it.
- **Custom words.** Add a word from the right-click menu or from the
  **Custom Words** page; it stops being flagged immediately.
- **Optionally ignores code spans.** Turn on **Ignore code spans** and
  `` `backtick` `` runs, file names and paths are not underlined — without the
  plugin touching the composer: it *declares* which ranges of the draft are
  code and the app renders and owns the wrapper. That seam
  (`COMPOSER_AREAS.nonProse`) is an open upstream PR and is in no release yet,
  so on a build without it the switch is not offered at all; see
  [Install](#install).
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

`requires_hermes` is `>=0.22.5`. On 0.22.5 the plugin loads and the dictionary
and the Custom Words page work. Three features need a newer core, and each is
feature-detected on the SDK export rather than gated on a version string:

| feature | needs | state upstream |
|---|---|---|
| right-click suggestions | `COMPOSER_AREAS.contextMenu` | merged ([#143678](https://github.com/NousResearch/hermes-agent/pull/143678)), in no release yet |
| the red underline | `host.composer.setSpellcheck` | open ([#143057](https://github.com/NousResearch/hermes-agent/pull/143057)), in no release yet |
| *Ignore code spans* | `COMPOSER_AREAS.nonProse` | open ([#144007](https://github.com/NousResearch/hermes-agent/pull/144007)), in no release yet |

On 0.22.5 the menu rows, the underline and the code-span switch are simply
missing: the plugin says so once about the menu, and the other two are absent
without ceremony — it is never refused at install time.

## Using it

**Suggest a correction.** Right-click a word with a squiggle under it. The
suggestions appear in their own section of the menu; click one to replace the
word. They are offered everywhere the app draws its menu, for every word in the
draft: **Ignore code spans** only stops the *underline* on code, it never
suppresses the suggestions.

**Add a word for good.** Right-click the word → **Add to dictionary**. The
word is saved and the plugin stops flagging it immediately — no more
suggestion rows for it, and it survives a reload. On a build with
`host.composer.setSpellcheck` the squiggle clears at the same time; on a
released build there is no squiggle to clear yet, see [the `setSpellcheck`
trade-off](#the-setspellcheck-trade-off).

**Manage your words.** Open **Settings → Plugins → Composer Spell Check →
Custom Words**, or click **Spellcheck** in the sidebar if you left that row
showing. There you can search your words, add more (one at a time, or several
comma-separated), and delete any you have added by mistake. The list covers
every language you have added words in and tags each word with its dictionary,
so switching *Language* never hides a word; new words go into the dictionary
the app is using. The search filters
as you type: `op` narrows to every word starting with *op*, and a query that is
not a prefix (`code`) still matches anywhere in the word, because that is what
people expect from a search box. Matching is case-insensitive.

**Settings.**

| setting | what it does |
|---|---|
| Check spelling | the master switch: turns the squiggles **and** the right-click suggestions on and off together. On a build without `host.composer.setSpellcheck` there are no squiggles to turn on, so turning it off removes the suggestion rows. |
| Language | which dictionary to use — *Automatic* (the default) follows the app's language |
| Ignore code spans | leaves `` `code` ``, file names and paths unflagged. Off by default. Needs a Hermes that carries the `COMPOSER_AREAS.nonProse` seam — an open upstream PR, in no release yet — and the row is hidden on a build without it, so no switch is offered that could not work. |
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
DOM to apply a correction.

The plugin uses the documented SDK surface for everything it can:
`ctx.register` for the route, the sidebar row and the context-menu rows,
`ctx.registerSettingsPage` for the settings page, `ctx.storage` for
persistence, `ctx.addEventListener` for its listeners, `host.composer` for the
draft and for spell check, `host.spellcheck` for the app's dictionary, and
`host.notify` for feedback. It imports only `@hermes/plugin-sdk`, `react` and
`react/jsx-runtime`.

### The seams it uses

Each app-owned concern goes through a supported seam. The plugin contributes
data or asks for an effect; the app performs it.

- **The menu is a contribution, not an injection.** One `ctx.register` with
  `area: COMPOSER_AREAS.contextMenu` and `data: { items }` — `items(context)`
  returns the rows, and each row carries its own `label` and `onSelect`. The app
  asks for rows when it opens the composer's menu, renders them as its own
  section, orders them, caps the count, closes the menu and restores the caret
  before it calls each row's `onSelect`. The plugin never queries or mutates that menu;
  the old DOM injection and private bridge are gone. It reads nothing back out
  of the composer either — no element, no selection, no caret. On a Hermes too
  old to have that seam — 0.22.5 is the
  oldest release this plugin loads on, and it has no `contextMenu` area — the
  plugin still loads and its Custom Words page and dictionary work, but the
  right-click suggestions are unavailable, and it says so once rather than
  silently contributing rows to an area nothing renders.
- **The dictionary is the app's.** `host.spellcheck.addWord` /
  `removeWord`, and the two are now symmetric: a word added from the menu stops
  being flagged, and a word deleted on the Custom Words page is flagged again.
  The plugin writes its own list in `ctx.storage` first — that list is what the
  page renders — and the host call is best-effort, so a refusing host cannot
  lose the word.
- **Corrections go through the draft.** `action.replaceWord(text)` when the
  menu supplies that action (it knows the word's position), otherwise
  `host.composer.getDraft()` / `setDraft()` with just the offending word
  replaced. No `execCommand`, no `Range.insertNode` into the editor.
- **The squiggles need one more seam.** The underline is Chromium's own and
  only paints where `spellcheck` is on, which the app sets to false;
  `host.composer.setSpellcheck(null, enabled)` is how the app is asked to turn
  it on. It is not in a released SDK yet, so it is feature-detected — see
  [the trade-off](#the-setspellcheck-trade-off) below.
- **Code spans are declared, not painted.** One `ctx.register` with
  `area: COMPOSER_AREAS.nonProse` and `data: { ranges }`. `ranges({ text })`
  returns `{ start, end, kind }` — UTF-16 offsets into the draft exactly as
  submit would send it, `'code'` for a `` `backtick` `` span and `'path'` for a
  file name or path — and the app wraps each one in a span it renders and owns,
  so the wrapper survives the app's own reconciler and the text round-trips
  without the plugin doing anything. The plugin never sees a node: there is no
  wrapper to undo and no caret to restore. A path or a `backtick` span is
  unambiguous; a bare `name.ext` is not, so it counts only when the tail is at
  least two characters and ends at a word boundary — `e.g`, `i.e`, `etc` and
  `Mr` stay prose, as does `foo.x`.

## Disclosures

The plugin catalog asks that a user know what a plugin does before
installing it. This plugin:

- **Makes network requests** to `raw.githubusercontent.com` — specifically the
  [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries) repository —
  for every locale whose word list is not embedded. The base English
  dictionary (`en`, which `en-US` resolves to) *is* embedded, so an en-US user
  on the default setting fetches nothing and the plugin is fully offline. Every
  other locale has its own word list — including `en-GB`, `en-AU` and `en-CA` —
  fetched as `index.dic` plus `index.aff` from the source pinned at commit
  `8cfea406b505e4d7df52d5a19bce525df98c54ab`, so the word list cannot change
  under you between sessions.

  **When it fetches.** The **Language** setting defaults to **Automatic**,
  which follows the app's language, and the active locale is loaded once as
  the plugin registers — not lazily on the first right-click. The locale is
  resolved from the document's language (`<html lang>`, which the app's i18n
  provider keeps current), then the browser's (`navigator.language`), so a
  user whose *app or OS* language
  maps to a non-English dictionary (German, French, Chinese, …) fetches on
  first run without ever changing the plugin's setting. Changing
  **Language** re-fetches for the new locale. A locale the plugin has
  no dictionary for (Japanese, say) resolves to the embedded English list and
  fetches nothing.

  The fetched files are *data* (a word list); no code is fetched and nothing
  is executed. **If a fetch fails** the plugin logs it and keeps running on the
  embedded English dictionary: suggestions are still offered and applied,
  ranked in English, and the fetch is retried the next time the locale is
  loaded, so changing **Language** can recover it. Only that locale's accuracy
  degrades — nothing throws and the composer keeps working.
- **Adds and removes words in the app's spell-check dictionary** through
  `host.spellcheck.addWord` / `removeWord`, so a word you add stops being
  flagged and one you delete is flagged again. The app owns that store
  (Chromium's `Custom Dictionary.txt` in its user-data directory); the plugin
  never writes the file itself. The plugin also keeps its own list in
  `ctx.storage` under `customWords` — that list is the source of truth the
  Custom Words page renders.
- **Asks the app to turn the browser's spell checker on**, via
  `host.composer.setSpellcheck(null, enabled)`. That is the entire mechanism:
  nothing is written onto the composer's `spellcheck` or `lang` attributes any
  more, and there is no DOM fallback. The API is in an upstream PR that has not
  been released, so on a shell without it the call is skipped, Chromium's spell
  check stays off (no red squiggles), and the plugin's own suggestions keep
  working while **Check spelling** is on.
- **Writes nothing into the composer's DOM.** No attributes, no wrappers of its
  own, no nodes, no caret moves. The plugin contributes menu rows, reads the
  draft through `host.composer` (and, for code spans, through the plain `text`
  the seam hands it), and asks the app to flip spell check on. Even **Ignore
  code spans** — the one setting that changes how the composer looks — changes
  nothing itself: it *declares* the draft's non-prose ranges through
  `COMPOSER_AREAS.nonProse`, and the app renders and owns the
  `<span data-composer-nonprose>` wrapper. A build without `setSpellcheck`
  simply keeps Chromium's underline off.
- **Does not** collect telemetry, read files outside the app's own data
  directory, run shell commands, or start background processes.

### The `setSpellcheck` trade-off

`host.composer.setSpellcheck` is in no released SDK yet, so the plugin
feature-detects it. When it is absent there is deliberately **no DOM
fallback**: the composer keeps the app's default (Chromium's spell check off,
so no red squiggles), and everything else keeps working. The plugin computes
and ranks its own suggestions from its own dictionary, so right-clicking a
misspelling still offers the right corrections and applies them — Chromium
only paints the underline. `plugin.yaml`'s floor is `>=0.22.5`: a 0.22.5 host
has none of the three seams (`contextMenu`, `setSpellcheck`, `nonProse`), so
what it gets is the dictionary and the Custom Words page — no squiggles, no
right-click rows, and no code-span switch. Each of the three lights up on its
own as soon as the SDK carrying it is there, with no further change here.

### The `composer.nonProse` trade-off

**Ignore code spans** used to be the plugin's one DOM write: it wrapped code
spans in its own `<code spellcheck="false">` nodes and unwrapped them again,
which moved the caret and fought the composer's reconciler. That is gone for
good — see [`tests/no-code-masking.test.cjs`](tests/no-code-masking.test.cjs),
which fails if any of it comes back. The setting now only *declares* ranges
through `COMPOSER_AREAS.nonProse`
([#144007](https://github.com/NousResearch/hermes-agent/pull/144007)), and the
app renders and owns the wrapper.

The trade-off is that the seam is not in a release yet, so on any published
build today the switch is **hidden** rather than present-but-dead: the plugin
registers no provider (nothing to mis-file), and the settings page omits the
row. The stored preference is left alone, so a user who turns it on in a build
that carries the seam keeps it on across builds. There is no DOM fallback and
there will not be one.

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
settings row that writes into the app's own DOM breaks on the app's next
refactor of it, and a helper
that was lost in an edit throws only when the feature that calls it is used.
None of them raise an error at build time.

| suite | what it proves |
|---|---|
| `tests/jsx-args.test.cjs` | no `jsx()` call passes children as the third argument (React's automatic runtime treats it as the *key*, so the element renders empty) |
| `tests/no-code-masking.test.cjs` | the code-span MASKING is ABSENT: no `maskCodeSpans`/`caretInMaskedCode`/`MASKED_CODE_SELECTOR`, no `data-sp-mask` write, no `CODE_SPLIT_RE`, no `input`/`focusout` listener that rewrites the composer, and nothing that creates nodes or reads a caret — the feature is a declared range provider now, and a re-added mask fails here |
| `tests/code-span-ranges.test.cjs` | *Ignore code spans* declares exact UTF-16 ranges (`code` for a `` `backtick` `` span, `path` for a file name or path) for a draft, leaves `e.g`/`i.e`/`etc`/`Mr`/`foo.x` in prose, registers the provider only on a shell that carries `COMPOSER_AREAS.nonProse`, is gated live by the real settings switch, and makes no DOM call of any kind — counted at runtime and grepped in the source |
| `tests/selectors.test.cjs` | the composer is found by role, not by the app's private slot names |
| `tests/sidebar-toggle.test.cjs` | flipping the *Show in the sidebar* switch removes the row and leaves the page reachable — driven through the real settings switch |
| `tests/settings-custom-words-link.test.cjs` | the *Custom Words* link targets the settings sub-page, not the top-level route that closes Settings |
| `tests/settings-render.test.cjs` | the settings page renders in a real React DOM, so a row React refuses to render fails the build |
| `tests/dictionary-case.test.cjs` | the dictionary keeps its capitalisation: `Hermes` is a word, `hermes` is not, and a typo offers the spelling the dictionary actually holds |
| `tests/menu-case.test.cjs` | the context-menu contribution: `data.items()` returns the right rows (right-click `english` → **English** first), a correctly spelled word returns none, and `onSelect` calls `action.replaceWord`; also that the old DOM injection and private bridge are gone |
| `tests/menu-seam-absence.test.cjs` | the menu seam is feature-detected, not version-gated: with `COMPOSER_AREAS.contextMenu` present the rows register; without it the plugin still loads, registers nothing for the menu, shows exactly one info notice naming the minimum version, and its dictionary and Custom Words page keep working |
| `tests/dictionary-seam.test.cjs` | add calls `host.spellcheck.addWord` **and** records the word in storage; remove (through the Custom Words page's own button) calls `removeWord` **and** drops it — the two stores move together |
| `tests/correction-seam.test.cjs` | a correction goes through `action.replaceWord`, or `host.composer.getDraft`/`setDraft` when there is no action — never `execCommand`/`insertNode`, and an ambiguous word is left alone |
| `tests/defined-symbols.test.cjs` | no function that existed in the first commit is called without being defined (three helpers were lost this way) |
| `tests/ranking-stability.test.cjs` | the suggestion ranker's output is frozen: 60 recorded lists come back byte for byte, a verbatim copy of the pre-rewrite algorithm re-derives them from the same dictionary, the capitalisation rules hold, the menu still caps at six rows — and a ten-letter typo ranks in under 50 ms (the pre-rewrite ranker took 871 ms, and the app ranks inside a `useMemo` during render, so that was a frozen menu) |
| `tests/menu-failure-reporting.test.cjs` | a correction that could not be applied now says so instead of closing the menu silently; a `host.notify` that throws (or is missing) never escapes the plugin; and nothing is written onto the composer for the plugin's own bookkeeping any more |
| `tests/docs-truth.test.cjs` | the README and the in-app description describe the switch the code implements: *Check spelling* gates the squiggles **and** the suggestion rows, and "Add a word" no longer promises a squiggle on a build that cannot paint one |
| `tests/custom-word-toast.test.cjs` | the "Added …" / "already in your custom words" toasts quote the word as STORED (`hermes`), not the raw selection (`Hermes`) the list does not contain |
| `tests/dictionary-page-locale.test.cjs` | the Custom Words page lists every locale's words, adds to the locale the app is running in (not "the longest list"), and can delete a word from another locale — driven through the real Add field and Remove buttons; also that the locale is resolved from `<html lang>`/`navigator.language` and the composer element is never queried |
| `tests/locale-options.test.cjs` | the Language dropdown offers exactly the locales `LOCALE_MAP`/`loadDictionary()` can load — including `en-GB`, `en-AU` and `en-CA` — and every option resolves to its own dictionary rather than to English |

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
  sidebar row, a settings page, a composer context-menu contribution and a
  `composer.nonProse` range provider. New UI goes in one of those.

**Reporting a bug:** please include your Hermes version
(`Help → About`), your OS, and what you expected versus what happened. For a
word that is not recognised, say whether it is in the standard dictionary at
all — a word the corpus does not contain is a different problem from one it
does.

## License

MIT — see [LICENSE](LICENSE).

<!-- CI now runs on every push: the path filters skipped most commits. -->
