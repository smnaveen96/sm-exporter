# SM exporter

A Figma plugin for exporting social-media creatives. Select frames, pick formats (JPEG, PNG, WebP, SVG, PDF),
then download them or upload them straight to a Google Drive folder.

**Open source** (MIT). No data is collected. Files go only to your own Google Drive. Connected-account tokens
are stored only on your computer, inside Figma.

## What it does

- **Export** the selected frames as JPEG, PNG or WebP (at 0.5x to 4x), SVG, and PDF: one merged PDF or one per
  frame, as images or as vector, with optional compression. Name the files once and every format follows.
- **Upload to Google Drive:** paste a folder link, or browse your Drive in the plugin (My Drive, Shared with me,
  Shared drives, Starred) and upload right there. Files with the same name are replaced, not duplicated.
- **Work with Drive files** without leaving Figma: preview images, PDFs and videos, search, create folders, rename,
  move, share, star, move to bin, undo, and drag images onto the canvas.
- **Several Google accounts**, with a quick switcher.
- **Light and dark themes** that follow Figma's, or your own choice.

## Install

- **From Figma Community:** search for "SM exporter" and click *Install* (link coming once published).
- **From source:** download this repository (Code → Download ZIP), unzip it, then in the Figma desktop app choose
  **Plugins → Development → Import plugin from manifest…** and select `manifest.json`.

## Connect Google Drive

Downloading works right away. To upload, connect a Google account: click the Google icon at the top right of
the plugin, or just start an upload. There are two ways to connect, both explained step by step in the
**[setup guide](https://smnaveen96.github.io/sm-exporter/SETUP-GUIDE.html)** (also in
[SETUP-GUIDE.md](SETUP-GUIDE.md)):

- **Sign in with Google:** no setup. Sign-in and token refresh run through the SM exporter OAuth service.
- **Use your own Client ID:** add a Client ID and secret from your own Google Cloud project (about 10 minutes,
  once). Sign-in then runs between the plugin and Google only, and the Client ID and secret stay on your
  computer, inside Figma.

You can connect accounts both ways at once. Each account keeps renewing its sign-in the way it was connected.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin manifest (network access limited to Google APIs and the SM exporter OAuth service) |
| `code.ts` / `code.js` | Plugin sandbox: frame selection, rendering, settings storage, canvas drag-drop (`npm install` once, then `npm run build` compiles `.ts` to `.js`) |
| `ui.html` | Panel UI. **A built file**, not edited directly; see "Editing the UI" below |
| `SETUP-GUIDE.md` / `.html` | Connecting Google Drive (both ways), sharing with a team, and fixing sign-in problems |
| `src/`, `build.js` | The editable source `ui.html` is built from; see "Editing the UI" below |
| `swipe-gesture.js` / `swipe-gesture.test.js` | The trackpad swipe gesture logic, as its own tested module |

## Editing the UI (`ui.html`)

`ui.html` has to be one file. Figma loads it as a single literal string (`figma.showUI(__html__)`), with
no server behind the plugin iframe to fetch separate `<script src>` files from. So instead of hand-editing
that one big file, the actual source lives split up under `src/`, and `build.js` assembles it back into
`ui.html`:

```
src/
  shell.html       the page skeleton (head/body structure), with placeholder tokens build.js fills in
  styles.css       all CSS, with the light and dark theme colours as tokens at the top
  vendor/          pdf-lib, pdf.js (+ its worker), fflate: vendored as-is, never hand-edited
  app/             the plugin's own UI code, split by feature:
    01-setup-and-utils.js               shared constants, settings, export-driving helpers
    02a-png-codec.js                    lossless PNG optimisation + palette quantisation
    02b-vector-pdf.js                   vector PDF merge/dedup + path-data rounding
    02c-jpeg-encoder.js                 the baseline JPEG encoder
    02d-generate-files.js               from Figma's renders to the final files (JPEG/PNG/WebP/SVG/PDF)
    03a-drive-upload.js                 Google Drive upload, the file name field, button tooltips
    03b-client-settings.js              confirmation pop-up; your own Client ID + its sign-in (code + PKCE)
    03c-oauth-and-transfers.js          the two ways to connect, quick sign-in via the OAuth service, token refresh, cancel
    03d-account-ui.js                   profile photos + the account menu
    04a-picker-state-and-listing.js     picker state, file-type rules, the Drive listing
    04b-picker-browse-ui.js             breadcrumbs, selection, the ⋮ context menu
    04c-picker-share-and-move.js        the Share… and Move-to… dialogs
    04d-picker-items-and-keyboard.js    rendering picker items + keyboard shortcuts
    04e-picker-rendering-and-drawer.js  list rendering, search, New Folder, opening/closing the drawer
    04f-picker-swipe.js                 the folder-history swipe (built on SwipeAxis)
    04g-picker-location-and-info.js     "Show location" and "File info"
    04h-picker-undo.js                  undo/redo for Drive actions
    05a-ql-open-and-zoom.js             opening the quick-look preview + zoom
    05b-ql-swipe-and-pdf.js             the file-to-file swipe + PDF page rendering
    05c-ql-video-controls.js            custom video playback controls
    06-canvas-dragdrop.js               dragging images from the plugin onto the Figma canvas
    07-window-resize.js                 the resize grip while Drive folders is open
    08-theme.js                         light and dark themes (follows Figma, or your choice)
    09-edge-glow.js                     the light that travels round a field while it works
```

`swipe-gesture.js` (top level, next to `code.js`) is pulled in automatically as the first app file. It's
kept there, not under `src/app/`, so `swipe-gesture.test.js` can `require()` it directly in plain Node.

To make a change: edit the right file, then run `node build.js` to regenerate `ui.html`, then reload the
plugin in Figma. `build.js` does nothing but concatenate files in order (no bundler, no minifier), so
what you see in each source file is exactly what ends up in the page.

## Contributing

Issues and pull requests are welcome. Please never include credentials or account tokens in a pull request.

## License

MIT, see [LICENSE](LICENSE). The "SM exporter" name and logo are not covered by the license: please don't use them
to present a modified copy as the original.
