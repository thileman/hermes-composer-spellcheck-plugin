# Screenshots

The catalog renders these on the plugin's page. Add them in a pull request
that changes the UI, and say in the PR description what each one shows.

| file | shows |
|---|---|
| `banner.png` | the catalog banner: the right-click suggestion menu over the composer |
| `context-menu.png` | the right-click suggestion menu in the composer, with the app around it |
| `suggestion-rows.png` | the suggestion rows close up |
| `custom-words.png` | the Custom Words page with the search field and the word list |
| `settings.png` | Settings → Plugins → Composer Spell Check |

Capture them from the running app (the plugin is loaded by the desktop app,
not by a browser), crop to the surface, and keep the image under ~500 KB —
the catalog page loads these eagerly.

**What the menu shot must show.** The app caps a plugin's section at **six
rows**, and the plugin fills exactly that: five ranked suggestions plus
**Add to dictionary** last. A shot with a seventh row is showing a build that
predates the cap.

**What the settings shot must show.** The rows a published build has:
**Check spelling**, **Language**, **Show in the sidebar** and the **Custom
Words** row. There is deliberately no *Ignore code spans* row in the shot: that
setting is real but needs the `COMPOSER_AREAS.nonProse` seam (upstream #144007,
in no release), and the plugin hides the row on a build without it rather than
offering a switch that cannot work. A shot taken on a dev build that carries
the seam would show a fourth row, ready to ship with the release that lands it.

**What the menu shot must not show.** A red squiggle under the word. The
underline is Chromium's, painted only when the app exposes
`host.composer.setSpellcheck` — an upstream PR that is in no release — so on a
released build there is no squiggle, and a shot that shows one is promising
something a user cannot yet get. The suggestions themselves work either way:
the plugin ranks them from its own dictionary. The shipped shots are of a build
with no squiggle, which is what a user has today.
