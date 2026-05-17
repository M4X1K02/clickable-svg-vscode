# Clickable SVG Viewer for VS Code

This extension provides a custom editor for `.svg` files that allows you to click on relative links (`<a>` tags) inside the SVG to open other files in your VS Code workspace.

## Features

- **Clickable Links**: Intercepts clicks on `<a>` tags and opens the referenced file in VS Code.
- **Pan & Zoom**: Zoom in/out with the mouse wheel and drag to pan around the SVG.
- **Security**: Blocks external web links by default and prompts before allowing embedded scripts to run (both configurable — see below).
- **Theme Integration**: The background matches your current VS Code theme.

## Settings

Search settings for **Clickable SVG** or edit `settings.json`:

| Setting | Values | Default |
|--------|--------|--------|
| `clickableSvg.scriptPolicy` | `strict` — no inline SVG scripts, no prompts.<br>`prompt` — prompt before widening CSP when the SVG contains `<script>`.<br>`permissive` — always allow inline scripts (unsafe on untrusted workspaces). | `prompt` |
| `clickableSvg.externalLinkPolicy` | `block` — warn and do nothing for `http`/`https` links.<br>`openExternal` — launch the system default browser via `xdg-open` / `open` / Windows `start` (avoids a hung `vscode.env.openExternal` on some setups). | `block` |

Changing a setting refreshes open SVG preview tabs automatically.

## Testing without Extension Development Host (Cursor)

If **Run Extension** opens **[Extension Development Host]** but navigating to your repo jumps back to the debugger window (Cursor routing), install the extension into your normal window instead:

1. Run **`npm run vsix`** in this repo (creates **`clickable-svg-vscode-0.0.1.vsix`**).
2. Command Palette → **Extensions: Install from VSIX…** → choose that file.
3. Reload if prompted. Open **`test-external.svg`** here and continue testing settings / links.

## Usage

1. Open any `.svg` file in VS Code.
2. If the SVG contains `<a>` tags with relative paths (e.g., `href="./other-file.ts"`), clicking them will open the target file in a new editor tab.
3. Use the mouse wheel to zoom and drag to pan.
