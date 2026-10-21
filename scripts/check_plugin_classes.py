"""Check that every Tailwind class a desktop plugin uses actually exists in the
app's compiled stylesheet.

Tailwind scans the app's own source, NOT plugin files. A plugin that uses an
arbitrary-value class (`text-[color:var(--x)]`) or any utility the app never
uses gets NO rule generated for it — the class silently does nothing. In a
plugin that means text with no colour and no size: invisible content, no
error, no log line. That cost hours of debugging once, so it is checked here.

Run:
    python3 check_plugin_classes.py <plugin.js> [assets_dir]
"""

import os
import re
import sys


def tailwind_escape(name: str) -> str:
    """Escape a class name the way Tailwind does when writing a selector."""
    out = []
    for ch in name:
        if ch.isalnum() or ch in "-_":
            out.append(ch)
        else:
            out.append("\\" + ch)

    return "".join(out)


def plugin_classes(source: str) -> set:
    """Every class literal in the plugin's className props."""
    found = set()

    for m in re.finditer(r"className:\s*'([^']*)'", source):
        for c in m.group(1).split():
            if c and len(c) < 120:
                found.add(c)

    return found


def app_css(assets_dir: str) -> str:
    """Concatenate every stylesheet the built app ships."""
    chunks = []

    for name in sorted(os.listdir(assets_dir)):
        if name.endswith(".css"):
            with open(os.path.join(assets_dir, name), encoding="utf-8", errors="replace") as fh:
                chunks.append(fh.read())

    return "\n".join(chunks)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    plugin = sys.argv[1]
    assets = sys.argv[2] if len(sys.argv) > 2 else None

    if assets is None:
        local = os.environ.get("LOCALAPPDATA", "")
        assets = os.path.join(
            local,
            "hermes",
            "hermes-agent",
            "apps",
            "desktop",
            "release",
            "win-unpacked",
            "resources",
            "app.asar.unpacked",
            "dist",
            "assets",
        )

    with open(plugin, encoding="utf-8") as fh:
        source = fh.read()

    css = app_css(assets)
    classes = plugin_classes(source)

    missing = sorted(c for c in classes if tailwind_escape(c) not in css)

    print(f"classes used      : {len(classes)}")
    print(f"stylesheet bytes  : {len(css):,}")

    if missing:
        print(f"\nMISSING from the app's CSS ({len(missing)}):")
        for c in missing:
            print(f"  {c}")
        print(
            "\nThese classes have no rule: Tailwind does not scan plugin files, so "
            "any utility the app itself never uses is never generated.\n"
            "Replace them with utilities the app ships, or set the style inline."
        )

        return 1

    print("\nOK — every class the plugin uses exists in the app's stylesheet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
