#!/usr/bin/env node
"use strict";
// Builds the single ui.html file Figma actually loads (figma.showUI(__html__) takes it as one literal
// string — there's no static file server behind the plugin iframe, so it can't load separate <script src>
// files at runtime). Editing happens in src/ instead, split into files anyone can open on their own:
//   src/shell.html          the page skeleton, with one placeholder token per block this script fills in
//   src/styles.css          all CSS
//   src/vendor/*            third-party libraries, byte-for-byte as vendored (pdf-lib, pdf.js, fflate) —
//                           never hand-edit these; replace the whole file if the library is ever upgraded
//                           (pdf.js is the ESM build: pdfjs.min.mjs + its worker saved as pdfjs.worker.txt)
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
  path.join(SRC, 'app', '02a-png-codec.js'),
  path.join(SRC, 'app', '02b-vector-pdf.js'),
  path.join(SRC, 'app', '02c-jpeg-encoder.js'),
  path.join(SRC, 'app', '02d-generate-files.js'),
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
  path.join(SRC, 'app', '04g-picker-location-and-info.js'),
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

// pdf.js 4 is an ES module: inlined verbatim into a <script type="module"> in shell.html, its `export{…}`
// statement is harmless there but reaches nothing, so this appends one line that re-publishes every export
// under its public name as window.pdfjsLib — the same global the old UMD build set, which is all the app
// code (a classic script) ever uses. The export list is parsed from the file itself, so a future upgrade
// needs no edit here as long as the build still ends in a single `export{a as b,…}` statement.
function pdfjsModule(source) {
  source = patchPdfjsSoftMaskAlpha(source)
  const match = source.match(/export\{([^}]*)\}\s*;?\s*$/)
  if (!match) throw new Error('pdfjs.min.mjs: expected a trailing export{…} statement; file shape changed, update build.js')
  const pairs = match[1].split(',').map((entry) => {
    const [local, exported = local] = entry.trim().split(/\s+as\s+/)
    return `${exported}: ${local}`
  })
  return source + `\nwindow.pdfjsLib = { ${pairs.join(', ')} }\n`
}

// pdf.js drops an object's constant alpha (/ca, /CA) whenever that object is drawn under a soft mask:
// CanvasGraphics.beginSMaskMode() ends by resetting BM/ca/CA to their defaults on the temporary layer it
// draws the masked content into, and the layer is later composited at alpha 1 — so an opacity set *before*
// the mask's `gs` (the order Figma's PDF export always writes: `/E3 gs` for `ca 0.22`, then `/E4 gs` for
// the mask) never reaches the page. That is exactly the "dark panel renders solid black in the preview"
// bug: a 22%-opacity gradient rectangle under a luminosity mask came out at 100%. The PDF spec applies
// constant alpha per object regardless of any soft mask, so keeping ca/CA on the layer (only BM still
// has to be neutralised there) draws the layer's pixels with the right alpha, and the compositing step,
// which multiplies the layer's alpha by the mask, then does the rest. Applied here at build time rather
// than by hand-editing the vendored file, so pdfjs.min.mjs stays byte-for-byte upstream and the build
// fails loudly if a future pdf.js changes the shape of this code instead of silently losing the fix.
function patchPdfjsSoftMaskAlpha(source) {
  const start = source.indexOf('beginSMaskMode(){')
  const end = start === -1 ? -1 : source.indexOf('endSMaskMode(){', start)
  if (start === -1 || end === -1) throw new Error('pdfjs.min.mjs: beginSMaskMode()/endSMaskMode() not found; pdf.js shape changed, update patchPdfjsSoftMaskAlpha in build.js')
  const reset = 'this.setGState([["BM","source-over"],["ca",1],["CA",1]])'
  const span = source.slice(start, end)
  if (span.split(reset).length !== 2) throw new Error('pdfjs.min.mjs: expected exactly one BM/ca/CA reset inside beginSMaskMode(); pdf.js shape changed, update patchPdfjsSoftMaskAlpha in build.js')
  return source.slice(0, start) + span.replace(reset, 'this.setGState([["BM","source-over"]])') + source.slice(end)
}

// The PNG optimiser runs in a Web Worker during exports (see optimizePngAsync in 02d). The worker's script
// can't be a separate file inside Figma's plugin iframe, so its text ships inline (an inert text/plain block
// that 02d turns into a Blob Worker): fflate again, a copy of the one helper the codec needs from 01, and the
// codec itself byte-for-byte — the same file that is also part of the main script, so there is one source.
function pngWorkerScript() {
  return [
    '"use strict";',
    fs.readFileSync(path.join(SRC, 'vendor/fflate.min.js'), 'utf8'),
    "const LOG = '[SM exporter PNG worker]'",
    'function concatBytes(chunks) { const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length } return output }',
    fs.readFileSync(path.join(SRC, 'app', '02a-png-codec.js'), 'utf8'),
    'self.onmessage = (event) => {',
    '  const { id, bytes } = event.data || {}',
    '  try { const out = optimizePng(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); self.postMessage({ id, bytes: out }, [out.buffer]) }',
    '  catch (error) { self.postMessage({ id, error: String((error && error.message) || error) }) }',
    '}',
  ].join('\n')
}

const replacements = [
  ['__STYLES_CSS__', () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')],
  ['__VENDOR_PDF_LIB_MIN_JS__', () => fs.readFileSync(path.join(SRC, 'vendor/pdf-lib.min.js'), 'utf8')],
  ['__VENDOR_PDFJS_MJS__', () => pdfjsModule(fs.readFileSync(path.join(SRC, 'vendor/pdfjs.min.mjs'), 'utf8'))],
  ['__VENDOR_PDFJS_WORKER_TXT__', () => fs.readFileSync(path.join(SRC, 'vendor/pdfjs.worker.txt'), 'utf8')],
  ['__VENDOR_FFLATE_MIN_JS__', () => fs.readFileSync(path.join(SRC, 'vendor/fflate.min.js'), 'utf8')],
  ['__PNG_WORKER_JS__', () => pngWorkerScript()],
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
