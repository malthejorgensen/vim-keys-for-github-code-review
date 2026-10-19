# Vim keys for GitHub code review

A Chrome Manifest V3 extension for GitHub pull request **Files changed** pages (both `/files` and `/changes`).

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repository directory.
3. Reload any GitHub tabs already open.

## Shortcuts

| Key | Action |
| --- | --- |
| `f` | Open the pull request's Files changed tab from Conversation, Commits, or Checks |
| `j` | Move to the next file |
| `k` | Move to the previous file |
| Shift+`j` | Scroll down 100 pixels (hold to keep scrolling) |
| Shift+`k` | Scroll up 100 pixels (hold to keep scrolling) |
| `x` | Toggle viewed status: marking viewed advances to the next file; marking not viewed stays on the current file |
| Space | Collapse or expand the current file |
| `p` | Open GitHub's Submit review dialog |

The initial file is determined from focus, a click in a diff, or the top of the viewport. Once selected, the file is remembered while scrolling or when GitHub replaces its DOM element. Click another diff to change the selection. Navigation stops at the first/last file. A light blue outline marks the selected file, with a thicker border drawn above the header contents. Hold `j`/`k` to keep moving.

For virtualized diffs, navigation scrolls to the current file's boundary and waits up to 1.5 seconds for GitHub to render the neighboring file. If the selected file was unmounted, it first scrolls to its remembered position to restore it. Navigation keystrokes received during that wait are consumed. If no neighbor appears, the selection and previous scroll position are retained. Marking viewed with `x` uses the same navigation behavior.

Shortcuts are paused while typing, while a dialog is open, and when modifier keys are held, except for Shift+`j`/`k`. The extension clicks GitHub's own controls to preserve its normal saved state and behavior. It opens the review dialog; submit your review using GitHub's controls.

The keyboard listener registers on `window` in capture phase at `document_start`, preventing default actions and stopping propagation for handled keys, including keypress/keyup. The script loads throughout github.com so it also works when GitHub navigates into a pull request without a full reload. The `f` shortcut works on pull request pages with a Files changed link; other shortcuts activate only on review pages with rendered diff files or a remembered selection. It needs no additional permissions, background service, or build step.

## Development

Run `npm install` and `npm test`. Tests use the supplied HTML fixtures and simulate GitHub's control handlers and keyboard listeners. Live GitHub behavior can change if GitHub changes its markup.

To create the Chrome Web Store upload ZIP, run `npm run package`. See [PUBLISHING.md](PUBLISHING.md) for prerequisites, package contents, and submission steps.
