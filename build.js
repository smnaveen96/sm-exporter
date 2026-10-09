#!/usr/bin/env node
"use strict";
// Builds the single ui.html file Figma actually loads (figma.showUI(__html__) takes it as one literal
// string — there's no static file server behind the plugin iframe, so it can't load separate <script src>
// files at runtime). Editing happens in src/ instead, split into files anyone can open on their own:
//   src/shell.html          the page skeleton, with one placeholder token per block this script fills in
//   src/styles.css          all CSS
//   src/vendor/*            third-party libraries, byte-for-byte as vendored (pdf-lib, pdf.js, fflate) —
//                           never hand-edit these; replace the whole file if the library is ever upgraded
//   src/app/NN-*.js         the plugin's own application code, split by feature area and concatenated in
//                           this exact numeric order — this is the same single shared scope the original
//                           one-big-<script> file had, just split across files on disk for editing; it is
//                           NOT a set of ES modules, so these files still freely read/call each other's
//                           top-level functions and variables exactly as before.
//   swipe-gesture.js        (one level up, next to code.js) the swipe fast-flick/slow-hold classifier —
//                           kept there, not under src/app/, because it also has to be require()-able by
//                           swipe-gesture.test.js in plain Node; the build below pulls it in as the first
//                           app file so there is exactly one copy of it, never a second one to fall out of
//                           sync with. Edit it there; it's picked up automatically on the next build.
//
// This script does nothing but string/file concatenation — it does not reformat, minify, or otherwise
// change any of the source files, so the output is exactly "shell with each placeholder replaced by that
// content," in the same order and the same <script>/<style> tags the original hand-built ui.html used.
// Run with: node build.js  (writes ui.html in this same directory, next to code.js and manifest.json)
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const SRC = path.join(ROOT, 'src')

// The app's own code, in load order. 00 is the shared swipe-gesture module, pulled from the project root
// (see the comment above) rather than from src/app, so it stays a single source of truth.
const APP_FILES = [
  path.join(ROOT, 'swipe-gesture.js'),
  path.join(SRC, 'app', '01-setup-and-utils.js'),
  path.join(SRC, 'app', '02a-png-compression.js'),
  path.join(SRC, 'app', '02b-vector-pdf.js'),
  path.join(SRC, 'app', '02c-jpeg-encoder.js'),
  path.join(SRC, 'app', '03a-drive-upload.js'),
  path.join(SRC, 'app', '03b-client-settings.js'),
  path.join(SRC, 'app', '03c-oauth-and-transfers.js'),
  path.join(SRC, 'app', '03d-account-ui.js'),
  path.join(SRC, 'app', '04a-picker-state-and-listing.js'),
  path.join(SRC, 'app', '04b-picker-browse-ui.js'),
  path.join(SRC, 'app', '04c-picker-share-and-move.js'),
  path.join(SRC, 'app', '04d-picker-items-and-keyboard.js'),
  path.join(SRC, 'app', '04e-picker-rendering-and-drawer.js'),
  path.join(SRC, 'app', '04f-picker-swipe.js'),
  path.join(SRC, 'app', '05a-ql-open-and-zoom.js'),
  path.join(SRC, 'app', '05b-ql-swipe-and-pdf.js'),
  path.join(SRC, 'app', '05c-ql-video-controls.js'),
  path.join(SRC, 'app', '06-canvas-dragdrop.js'),
]

// swipe-gesture.js is also a plain Node module (for swipe-gesture.test.js), so it carries a leading
// "use strict" and a trailing `module.exports` line that don't belong inlined into the page's own script
// (the page already has its own "use strict", and `module` doesn't exist in the browser — harmless if left
// in, but cleaner out). Strip exactly those two lines; leave everything else, including all comments, as-is.
function readAppFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  if (path.basename(filePath) !== 'swipe-gesture.js') return content
  const lines = content.replace(/\n$/, '').split('\n')
  if (lines[0] !== '"use strict";') throw new Error('swipe-gesture.js: expected a leading "use strict"; line shape changed, update build.js')
  if (lines[lines.length - 1] !== "if (typeof module !== 'undefined') module.exports = { SwipeAxis }") {
    throw new Error('swipe-gesture.js: expected trailing module.exports line; line shape changed, update build.js')
  }
  const header = (
    '\n' +
    '    // ---- SwipeAxis: shared fast-flick/slow-hold classifier for both the folder-picker\'s swipe and\n' +
    '    // the quick-look preview\'s swipe (see each usage site below). Canonical source is swipe-gesture.js\n' +
    '    // (next to code.js) — inlined here verbatim by build.js, not hand-copied, so there is only ever one\n' +
    '    // copy of this logic; see swipe-gesture.test.js for the fast/slow cases it\'s tuned against.\n'
  )
  return header + lines.slice(1, -1).join('\n') + '\n\n'
}

const replacements = [
  ['__STYLES_CSS__', () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')],
  ['__VENDOR_PDF_LIB_MIN_JS__', () => fs.readFileSync(path.join(SRC, 'vendor/pdf-lib.min.js'), 'utf8')],
  ['__VENDOR_PDFJS_MIN_JS__', () => fs.readFileSync(path.join(SRC, 'vendor/pdfjs.min.js'), 'utf8')],
  ['__VENDOR_PDFJS_WORKER_TXT__', () => fs.readFileSync(path.join(SRC, 'vendor/pdfjs.worker.txt'), 'utf8')],
  ['__VENDOR_FFLATE_MIN_JS__', () => fs.readFileSync(path.join(SRC, 'vendor/fflate.min.js'), 'utf8')],
  ['__APP_MAIN_JS__', () => APP_FILES.map(readAppFile).join('')],
]

function build() {
  let shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8')
  for (const [token, getContent] of replacements) {
    if (!shell.includes(token)) throw new Error(`placeholder ${token} not found in shell.html (expected exactly once)`)
    const content = getContent()
    shell = shell.replace(token, () => content) // function form: avoids $-escape sequences in content being misread as replacement patterns
  }
  const outPath = path.join(ROOT, 'ui.html')
  fs.writeFileSync(outPath, shell, 'utf8')
  console.log(`Built ${outPath} (${shell.length.toLocaleString()} chars)`)
}

build()
