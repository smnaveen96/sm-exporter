    // ---- Preview (Space, double-click) ---------------------------------------------------------------------
    const qlEl = document.getElementById('qlook')
    const qlStage = document.getElementById('ql-stage')
    const qlName = document.getElementById('ql-name')
    const qlIcon = document.getElementById('ql-icon')
    const qlCount = document.getElementById('ql-count')
    const qlNavPrev = document.getElementById('ql-nav-prev')
    const qlNavNext = document.getElementById('ql-nav-next')
    const qlPages = document.getElementById('ql-pages')
    const qlZoomBar = document.getElementById('ql-zoom')
    const qlZoomOut = document.getElementById('ql-zoom-out')
    const qlZoomIn = document.getElementById('ql-zoom-in')
    const qlZoomPct = document.getElementById('ql-zoom-pct')
    const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]
    let qlList = [], qlIndex = -1, qlAbort = null, qlUrl = '', qlHideTimer = 0
    // Stepping to the next/previous file and back used to mean a full re-download every time — expensive
    // on a slow connection and, for video/audio, meant playback always restarted from 0 too. A small LRU
    // of recently-fetched blobs (capped, so this can't grow without bound over a long session) now covers
    // every kind of preview (image, PDF, video, audio) — revisiting a recent file reuses its blob instead
    // of re-fetching it — plus a plain map of last-known playback position (keyed by file id, cheap to
    // keep around for every file visited this session) so video/audio also resumes instead of restarting.
    const qlPlaybackPos = new Map() // entry.id -> last currentTime
    const qlBlobCache = new Map()   // entry.id -> Blob, insertion order = recency
    const QL_BLOB_CACHE_MAX = 4
    function qlCacheBlob(id, blob) {
      qlBlobCache.delete(id)
      qlBlobCache.set(id, blob)
      while (qlBlobCache.size > QL_BLOB_CACHE_MAX) qlBlobCache.delete(qlBlobCache.keys().next().value)
    }
    let qlZoom = 1, qlMedia = null, qlMediaFit = null, qlPage = 1, qlPageCount = 0, qlHolder = null
    // The preview panel's height animates open over several frames (see animateResize/openPreview), so
    // the very first captureMediaFit() — taken the instant the media is ready to show — can land mid-
    // animation, before #ql-holder has actually grown to its final size: the baseline it captures is then
    // smaller than the real 100% box, and zooming in from that wrong baseline is what looked like the
    // image snapping to the top-left corner instead of actually zooming (worse the faster the file loads,
    // since a quick load has more of the resize still ahead of it). Re-measuring whenever the holder's own
    // box changes size — only while still at 100% zoom, so there's no inline width/height of ours to be
    // fooled by — keeps the baseline correct through that resize and any later layout change, not just
    // the one instant the media first appears.
    // The same race this guards against at 100% zoom (the plugin window's own resize animation still
    // settling after the preview opens) turns out to be exactly what was behind zoom "jumping to the
    // top-left": centerQl (see applyZoom) reads scrollWidth/clientHeight once, a frame or two after a
    // zoom step, but the window can still be animating its own resize for a couple hundred ms after that
    // (syncHeight posts the new size to Figma's main thread and eases toward it — see animateResize — an
    // async round trip, not a same-frame DOM change), so clientWidth/clientHeight keep changing out from
    // under a one-shot calculation. Re-centering again on every one of this observer's own ticks, for as
    // long as the holder is zoomed, keeps it correct through all of that instead of just the first frame.
    const qlHolderObserver = new ResizeObserver(() => {
      if (qlZoom === 1 && qlMedia) captureMediaFit()
      else if (qlZoom !== 1 && qlHolder) {
        qlHolder.scrollLeft = (qlHolder.scrollWidth - qlHolder.clientWidth) / 2
        qlHolder.scrollTop = (qlHolder.scrollHeight - qlHolder.clientHeight) / 2
      }
    })
    // qlPdfBytes backs the pdf.js document (qlPdfJsDoc, below) that both renders pages and reports the
    // page count — kept per-file and cleared whenever a new file is shown.
    let qlPdfBytes = null, qlPdfRenderToken = 0

    function qlCleanup() {
      if (qlAbort) { qlAbort.abort(); qlAbort = null }
      if (qlUrl) { URL.revokeObjectURL(qlUrl); qlUrl = '' }
      qlPdfBytes = null
      qlPdfJsDoc = null
      qlPdfRenderToken += 1 // invalidate any in-flight renderPdfPage() from the file being left
      if (qlPageObserver) { qlPageObserver.disconnect(); qlPageObserver = null }
      qlHolderObserver.disconnect()
      // The overlay prev/next file-nav arrows are permanent children of #ql-stage, not per-file content,
      // so they're removed one by one rather than with a blanket qlStage.textContent = '' that would wipe
      // them too.
      for (const el of [...qlStage.children]) if (el !== qlNavPrev && el !== qlNavNext) el.remove()
      qlPages.hidden = true
      qlPages.textContent = ''
      qlPageCount = 0
      qlZoomBar.hidden = true
      qlMedia = null
      qlMediaFit = null
      qlHolder = null
      qlZoom = 1
      qlZoomPct.textContent = '100%'
    }

    // ---- Zoom (images + PDF pages): resizes the media's real box instead of a CSS transform. A transform
    // scales the element visually without changing its layout size, so the part of it beyond the frame
    // doesn't expand the holder's scrollable area evenly — in practice only about half the zoomed-in
    // content (the side away from the transform's center) was ever reachable by scrolling, the rest was
    // just clipped off. Setting an actual pixel width/height (with the holder anchored top-left while
    // zoomed) gives a real, fully scrollable overflow in every direction instead.
    //
    // The "100% / fit" baseline (qlMediaFit) used to be recomputed from naturalWidth/naturalHeight plus
    // the holder's own clientWidth/clientHeight every time zoom changed — correct in principle, but it
    // silently produced nothing (and therefore no zoom at all beyond the holder re-anchoring the content
    // to the top-left corner) wherever that recomputation came up short, e.g. a PDF canvas's made-up
    // naturalWidth/naturalHeight expando properties, or the holder's box not being exactly what the math
    // assumed. Measuring the box the browser already rendered — via getBoundingClientRect, once, right
    // when the media is first shown at 100% (object-fit: contain, no inline size yet) — needs no such
    // reconstruction and can't drift from what's actually on screen, for an <img>, a <canvas>, anything.
    function captureMediaFit() {
      if (!qlMedia) { qlMediaFit = null; return }
      const r = qlMedia.getBoundingClientRect()
      qlMediaFit = (r.width && r.height) ? { width: r.width, height: r.height } : null
    }
    function applyZoom() {
      if (qlMedia && qlMediaFit) {
        // max-width/max-height: 100% (the normal "fit inside the frame" rule) caps the *used* width/
        // height no matter how it was set, inline style included — it has to be lifted here or the
        // explicit pixel size below just gets clamped straight back down to the frame.
        if (qlZoom === 1) { qlMedia.style.width = ''; qlMedia.style.height = ''; qlMedia.style.maxWidth = ''; qlMedia.style.maxHeight = '' }
        else {
          qlMedia.style.maxWidth = 'none'; qlMedia.style.maxHeight = 'none'
          qlMedia.style.width = `${qlMediaFit.width * qlZoom}px`; qlMedia.style.height = `${qlMediaFit.height * qlZoom}px`
        }
      }
      if (qlHolder) {
        qlHolder.classList.toggle('is-zoomed', qlZoom !== 1)
        if (qlZoom !== 1) {
          // Going into/further into zoom makes the holder scrollable, and a freshly-scrollable element
          // always starts scrolled to (0,0) — its very top-left corner — with nothing here to say
          // otherwise. That's the "it keeps jumping to the top-left" complaint: the zoom math itself was
          // landing on the right size all along, the view just never got told to look at the middle of
          // that bigger content instead of its default corner. This immediate pass gives instant feedback
          // on the click; qlHolderObserver above keeps re-centering on every tick of the plugin window's
          // own (asynchronous, main-thread-round-trip) resize animation afterwards, which is what was
          // actually still landing on the corner — a single requestAnimationFrame only proves the centering
          // math is right, not that the real window has finished resizing by the time it runs.
          const holder = qlHolder
          requestAnimationFrame(() => {
            if (qlHolder !== holder) return // a different file opened in the meantime; don't fight its own centering
            holder.scrollLeft = (holder.scrollWidth - holder.clientWidth) / 2
            holder.scrollTop = (holder.scrollHeight - holder.clientHeight) / 2
          })
        }
      }
      qlZoomPct.textContent = `${Math.round(qlZoom * 100)}%`
      qlZoomOut.disabled = qlZoom <= ZOOM_STEPS[0]
      qlZoomIn.disabled = qlZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]
    }
    function clampZoom(value) { return Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], value)) }
    function stepZoom(delta) {
      const at = ZOOM_STEPS.indexOf(qlZoom)
      let next
      if (at !== -1) next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + delta))]
      // qlZoom can sit between steps after a trackpad pinch — step to the nearest step past the current
      // value in the requested direction instead of jumping straight to one end.
      else if (delta > 0) next = ZOOM_STEPS.find((s) => s > qlZoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
      else next = [...ZOOM_STEPS].reverse().find((s) => s < qlZoom) ?? ZOOM_STEPS[0]
      qlZoom = next
      applyZoom()
    }
    qlZoomOut.addEventListener('click', () => stepZoom(-1))
    qlZoomIn.addEventListener('click', () => stepZoom(1))
    qlZoomPct.addEventListener('click', () => { qlZoom = 1; applyZoom() })
    // Pinch/trackpad-gesture zooming: a trackpad pinch is reported to the browser as a wheel event with
    // ctrlKey set (this is the standard, cross-browser signal for it — Safari's own separate, non-standard
    // gesturestart/gesturechange events were tried here once too, but Figma's desktop shell is Chromium,
    // where that Safari-only path never fires anyway, so it's not needed). Scaled continuously by how far
    // the pinch has moved rather than snapping to the nearest of the fixed ZOOM_STEPS, so it tracks the
    // fingers the way a real pinch-zoom does; the +/- buttons still step through ZOOM_STEPS as before.
    // This was pulled out entirely for a few rounds on the theory that gesture input itself was somehow
    // behind the "jumps to the corner" bug — it wasn't (that turned out to be the recentering math racing
    // the plugin window's own resize animation, now fixed in qlHolderObserver above), so it's back.
    qlStage.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.012)
      qlZoom = clampZoom(qlZoom * factor)
      applyZoom()
    }, { passive: false })
    // Double-click/double-tap to zoom: a quick fallback for the "zoom jumps to the top-left corner" bug
    // rather than a fix for it — the underlying centering logic above is untouched. Double-clicking toggles
    // between 100% and 2x, so a stuck/jumped zoom is always one more double-click away from resetting.
    qlStage.addEventListener('dblclick', (event) => {
      if (qlZoomBar.hidden) return // only image and PDF previews offer zoom at all (not video/audio)
      event.preventDefault()
      qlZoom = qlZoom === 1 ? clampZoom(2) : 1
      applyZoom()
    })
    // A PDF now shows one page at a time (see renderPdfPage above) rather than the old native viewer's
    // single long scrollable document, so a plain scroll/trackpad gesture over it would otherwise do
    // nothing at all at 100% zoom. Turning that same gesture into "next/previous page" keeps scrolling
    // through a multi-page PDF feeling the same as before; once zoomed in, scrolling goes back to panning
    // the enlarged page the normal way instead, since there's now somewhere for it to actually go.
    let qlPageWheelLock = 0
    qlStage.addEventListener('wheel', (event) => {
      if (event.ctrlKey || qlZoom !== 1 || qlPageCount < 2 || Math.abs(event.deltaY) < 12) return
      const now = Date.now()
      if (now - qlPageWheelLock < 350) return // one page per scroll gesture, not one per pixel of momentum
      const next = qlPage + (event.deltaY > 0 ? 1 : -1)
      if (next < 1 || next > qlPageCount) return
      qlPageWheelLock = now
      event.preventDefault()
      setPage(next)
    }, { passive: false })
