# Clickable SVG Viewer for VS Code

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Open `.svg` files with a preview you can pan and zoom. Click links in the diagram to jump to other files in your project.

## Getting started

1. Open an `.svg` file in VS Code.
2. Click colored regions or text that are links (SVG `<a>` elements).
3. **Zoom** with the mouse wheel, **pan** by dragging, or use **+**, **−**, and **Reset** on the toolbar.

Links to files in your workspace open in the editor. If a link includes a `#section`, that fragment is passed along when the target file opens.

## What happens when you click a link

| You click something like… | What usually happens |
|---------------------------|----------------------|
| `./docs/guide.md` or `../src/app.ts` | Opens that file in VS Code |
| `../readme.md#features` | Opens the file and keeps the `#…` part |
| `https://example.com` | Blocked by default; can be changed to open your web browser |
| `vscode://…` | Always blocked (`vscode://` can run editor commands) |
| `file://…` | Blocked by default; if scheme links are unblocked, `file:` is allowlisted |
| `/etc/passwd` or paths outside the project | Blocked by default |
| `../../../` tricks to escape the project | Always blocked |
| Symlinks pointing outside the workspace | Blocked after path resolution |

If a link is blocked, VS Code shows a short warning instead of opening it.

## Settings

Open **Settings**, search for **Clickable SVG**, and adjust:

**Script policy** (`strict` / `prompt` / `permissive`, default: `prompt`)

Controls whether animations or logic inside `<script>` tags in the SVG may run in the preview.

- **strict** — Scripts never run; safest if you open SVGs from unknown sources.
- **prompt** — You are asked once per open editor tab for each SVG that contains scripts; allowing scripts clears when you close that tab.
- **permissive** — Scripts always run; only use this if you trust every SVG you open.

**External link policy** (`block` / `openExternal`, default: `block`)

Controls `http://` and `https://` links.

- **block** — Click does nothing (after a warning).
- **openExternal** — Opens the URL in your default web browser.

**Block absolute paths** (on by default)

Blocks links that start at the root of your disk (e.g. `/etc/passwd`). Links must still stay inside your project even if you turn this off.

**Block scheme links** (on by default)

Blocks links that use special protocols. If you turn this off, only `file:`, `mailto:`, and `tel:` can open; `vscode://` and `command:` remain blocked.

Open SVG tabs refresh when you change a setting.

## SVGs with scripts

When **Script policy** is **prompt** and the file contains `<script>` (any casing), you will see a confirmation before anything runs.

To allow scripts for the **current tab**, run **SVG: Allow Scripts** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Closing the SVG tab clears that opt-in; reopening the file prompts again.

## Trust and safety

Defaults are meant for everyday use, including SVGs from diagrams, exports, or downloads you have not fully vetted.

**Restricted Mode** (untrusted workspace): script policy behaves as **strict**, external and scheme links stay blocked, and absolute paths stay blocked — regardless of your settings.

Only relax **Block scheme links**, **Script policy**, or **External link policy** when you trust the SVG and its author, and the workspace is trusted.

## License

MIT — see [LICENSE](LICENSE).
