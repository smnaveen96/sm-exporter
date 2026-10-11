# SM exporter

A Figma plugin for exporting social-media creatives. Select frames, pick formats (JPEG, PNG, WebP, SVG, PDF),
then download them or upload them straight to a Google Drive folder.

**Open source** (MIT). No data is collected. Files go only to your own Google Drive. Connected-account tokens
are stored only on your computer, inside Figma.

## Install

- **From Figma Community:** search for "SM exporter" and click *Install* (link coming once published).
- **From source:** download this repository (Code → Download ZIP), unzip it, then in the Figma desktop app choose
  **Plugins → Development → Import plugin from manifest…** and select `manifest.json`.

## Upload to Google Drive (one-time setup)

Downloading works right away. To upload, paste a Drive folder link and connect your Google account when prompted:
see **[SETUP-GUIDE.md](SETUP-GUIDE.md)**. Google sign-in and token refresh are handled by the SM exporter OAuth service;
the plugin does not ask users to enter OAuth credentials or copy authorization codes.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin manifest (network access limited to Google APIs) |
| `code.ts` / `code.js` | Plugin sandbox: frame selection, rendering, settings storage, canvas drag-drop (`npm install` once, then `npm run build` compiles `.ts` to `.js`) |
| `ui.html` | Panel UI — **a built file**, not edited directly; see "Editing the UI" below |
| `SETUP-GUIDE.md` / `.html` | Connecting Google Drive and managing accounts |
| `src/`, `build.js` | The editable source `ui.html` is built from — see "Editing the UI" below |
| `swipe-gesture.js` / `swipe-gesture.test.js` | The trackpad swipe gesture logic, as its own tested module |

## Editing the UI (`ui.html`)

`ui.html` has to be one file — Figma loads it as a single literal string (`figma.showUI(__html__)`), with
no server behind the plugin iframe to fetch separate `<script src>` files from. So instead of hand-editing
that one big file, the actual source lives split up under `src/`, and `build.js` assembles it back into
`ui.html`:

```
src/
  shell.html       the page skeleton (head/body structure), with placeholder tokens build.js fills in
  styles.css       all CSS
  vendor/          pdf-lib, pdf.js (+ its worker), fflate — vendored as-is, never hand-edited
  app/             the plugin's own UI code, split by feature:
    01-setup-and-utils.js               shared constants, export-driving helpers
    02a-png-compression.js              lossless PNG optimization + palette quantization
    02b-vector-pdf.js                   vector PDF merge/dedup + path-data rounding
    02c-jpeg-encoder.js                 the baseline JPEG encoder
    03a-drive-upload.js                 Google Drive upload + button tooltips
    03b-client-settings.js              confirmation pop-up
    03c-oauth-and-transfers.js          Worker-based sign-in, token refresh, cancel-upload, cancel-download
    03d-account-ui.js                   profile photos + the account switcher
    04a-picker-state-and-listing.js     picker state, file-type rules, the Drive listing
    04b-picker-browse-ui.js             breadcrumbs, selection, the ⋮ context menu
    04c-picker-share-and-move.js        the Share… and Move-to… dialogs
    04d-picker-items-and-keyboard.js    rendering picker items + keyboard shortcuts
    04e-picker-rendering-and-drawer.js  list rendering, New Folder, opening/closing the drawer
    04f-picker-swipe.js                 the folder-history swipe (built on SwipeAxis)
    05a-ql-open-and-zoom.js             opening the quick-look preview + zoom
    05b-ql-swipe-and-pdf.js             the file-to-file swipe + PDF page rendering
    05c-ql-video-controls.js            custom video playback controls
    06-canvas-dragdrop.js               dragging images from the plugin onto the Figma canvas
```

`swipe-gesture.js` (top level, next to `code.js`) is pulled in automatically as the first app file — it's
kept there, not under `src/app/`, so `swipe-gesture.test.js` can `require()` it directly in plain Node.

To make a change: edit the right file, then run `node build.js` to regenerate `ui.html`, then reload the
plugin in Figma. `build.js` does nothing but concatenate files in order — no bundler, no minifier — so
what you see in each source file is exactly what ends up in the page.

## Contributing

Issues and pull requests are welcome. Please never include credentials or account tokens in a pull request.

## License

MIT, see [LICENSE](LICENSE). The "SM exporter" name and logo are not covered by the license: please don't use them
to present a modified copy as the original.
