# Publishing to the Chrome Web Store

## Create the upload ZIP

You need Node.js/npm and Python 3.9 or newer. From the repository root, install the development dependencies once:

```sh
npm ci
```

Then create a release:

```sh
npm run package
```

This runs the tests first and creates:

```text
dist/vim-keys-for-github-code-review-1.0.0.zip
```

The version in the filename comes from `manifest.json`. The ZIP contains `manifest.json` at its root, `LICENSE`, the manifest's content scripts and stylesheets, and the icons referenced by the manifest. Tests, HTML fixtures, dependencies, documentation, old icons, and other repository files are excluded. The `dist/` directory is ignored by Git.

Each run builds a fresh ZIP and replaces the output for that version. If you change the extension after packaging, run the command again before uploading.

To inspect the archive:

```sh
python3 -m zipfile --list dist/vim-keys-for-github-code-review-1.0.0.zip
```

## Prepare the listing

Register and complete your account setup in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Google requires a developer registration fee and two-step verification for publishing.

Prepare the listing description, category, language, and the required images:

| Asset | File or dimensions |
| --- | --- |
| Store icon | `icons/paper-looking-glass-128.png` |
| Screenshot showing the extension working on GitHub | At least one; 1280 × 800 preferred, or 640 × 400 |
| Small promotional image | 440 × 280 |

The icon is already included in the package. The screenshots and promotional image are uploaded separately in the dashboard. A promotional video and a large marquee image are optional. See Google's [image requirements](https://developer.chrome.com/docs/webstore/images).

Complete the privacy fields and provide a publicly accessible privacy-policy URL. Describe local processing of GitHub page elements and keyboard events. The current extension uses no analytics or remotely hosted code and does not transmit data to the developer. Clicking its shortcuts activates GitHub's own controls, which can make normal requests to GitHub.

Suggested **single purpose**:

> Provide Vim-style keyboard navigation and file review controls on GitHub pull request pages.

Suggested **GitHub site access justification**:

> Access to github.com is needed to identify diff files, open the Files changed tab, and activate GitHub's existing review controls. The content script loads across GitHub so it works when navigation occurs without a full page reload. Keyboard shortcuts activate only on the relevant pull request pages.

Select **No remote code** and complete the data-use declarations accurately for the version you submit. See Google's [privacy-field instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## Upload and submit

1. In the Developer Dashboard, click **Add new item**, then upload the ZIP from `dist/`.
2. Complete **Store listing**, **Privacy practices**, and **Distribution**. Choose **Public** for a searchable listing or **Unlisted** for installation through a shared link.
3. Add test instructions with a public pull request URL. Explain `f` to open Files changed, `j`/`k` to navigate files, Shift+J/K to scroll, `x` to toggle viewed status, Space to collapse/expand, and `p` to open Submit review.
4. Click **Submit for review**. Choose automatic publication after approval or deferred publication if you want to release it manually.

Test the packaged version on real GitHub pull requests before submitting, including large virtualized diffs and typing in comment fields. You can extract the ZIP into a temporary directory and use **Load unpacked** in `chrome://extensions` to test those exact files.

See Google's [packaging instructions](https://developer.chrome.com/docs/webstore/prepare) and [publishing guide](https://developer.chrome.com/docs/webstore/publish).

## Publish an update

Increase `version` in `manifest.json` before uploading an update to an existing store item; each uploaded version must be greater than the previous one. Keep `package.json` and the root version entries in `package-lock.json` in sync. Run `npm run package` again, then upload the new ZIP through the existing item's **Package** tab and submit it for review. Use the existing store item so users receive the update.
