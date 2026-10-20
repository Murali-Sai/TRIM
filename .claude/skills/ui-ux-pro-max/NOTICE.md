# UI/UX Pro Max (third-party)

This folder is the UI/UX Pro Max skill for Claude Code, installed with the `uipro-cli`
npm package, version 2.2.3 (`uipro init --ai claude --offline`), unchanged except that
Python bytecode caches were left out.

- Source: https://www.npmjs.com/package/uipro-cli
- License: CC-BY-NC-4.0, as stated in the package README. The package metadata says MIT;
  the README's CC-BY-NC-4.0 is the stricter of the two, so it is the one followed here.
  Attribution: UI/UX Pro Max by its authors. Non-commercial use only.

It is a development aid for agents working on TRIM. It is not part of the app and is never
shipped to users. If TRIM is ever used commercially, remove this folder or get a license.

Its suggestions do not override SPEC.md or AGENTS.md. Where they conflict (fonts, colors,
icons, gamification), the SPEC wins.

To update: run `npx uipro-cli@<version> init --ai claude --offline` from the repo root, then
review the diff.

The SKILL.md examples say `python3 skills/ui-ux-pro-max/scripts/search.py`; in this repo, run
`python3 .claude/skills/ui-ux-pro-max/scripts/search.py` from the repo root.
