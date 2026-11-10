// ---- Two-finger horizontal swipe between files in the preview, same arrow feedback, the same
    // SwipeAxis classification, and the same DOM-glue-only split as the folder swipe above.
    const qlSwipeAxis = new SwipeAxis({ now: () => performance.now(), quietMs: 350, quietHoldMs: 450 })
    let qlSwipeDisplay = 0
    let qlSwipeRaf = 0
    let qlSwipeResetTimer = 0
    function setQlSwipeRatio(prev, next) {
      qlStage.style.setProperty('--swipe-back', String(prev))
      qlStage.style.setProperty('--swipe-fwd', String(next))
    }
    function qlSwipeTick() {
      const accum = qlSwipeAxis.accum
      qlSwipeDisplay = accum
      setQlSwipeRatio(
        qlSwipeDisplay < 0 && qlIndex > 0 ? Math.min(1, -qlSwipeDisplay / qlSwipeAxis.threshold) : 0,
        qlSwipeDisplay > 0 && qlIndex < qlList.length - 1 ? Math.min(1, qlSwipeDisplay / qlSwipeAxis.threshold) : 0,
      )
      qlSwipeRaf = qlSwipeDisplay !== accum ? requestAnimationFrame(qlSwipeTick) : 0
    }
    function qlSwipeRelease() {
      qlStage.classList.remove('is-swiping')
      cancelAnimationFrame(qlSwipeRaf)
      qlSwipeRaf = 0
      qlSwipeDisplay = 0
      setQlSwipeRatio(0, 0)
      const direction = qlSwipeAxis.release()
      if (direction < 0 && qlIndex > 0) stepPreview(-1)
      else if (direction > 0 && qlIndex < qlList.length - 1) stepPreview(1)
    }
    function resetQlSwipeVisual() {
      cancelAnimationFrame(qlSwipeRaf)
      qlSwipeRaf = 0
      qlSwipeDisplay = 0
      setQlSwipeRatio(0, 0)
      clearTimeout(qlSwipeResetTimer)
      qlSwipeResetTimer = 0
    }
    qlStage.addEventListener('wheel', (event) => {
      if (event.ctrlKey || qlZoom !== 1 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
      // The momentum tail of a swipe that already went through (a flick keeps sending events for a second or
      // two after the fingers lift): keep feeding it so it stays swallowed, but don't redraw the arrow or put
      // is-swiping back on — that would switch the CSS transition off again right as the page change plays.
      if (qlSwipeAxis.inCooldown) { qlSwipeAxis.feed(event.deltaX); return }
      if (qlSwipeAxis.accum === 0) resetQlSwipeVisual()
      qlStage.classList.add('is-swiping')
      const quiet = qlSwipeAxis.feed(event.deltaX)
      clearTimeout(qlSwipeResetTimer)
      qlSwipeResetTimer = setTimeout(qlSwipeRelease, quiet)
      if (!qlSwipeRaf) qlSwipeRaf = requestAnimationFrame(qlSwipeTick)
    }, { passive: true })

    // ---- PDF page strip: a rail of page numbers to jump to one, rendered via pdf.js (see renderPdfPage
    // and ensurePdfJsDoc below) — the page count comes straight from pdf.js's own qlPdfJsDoc.numPages,
    // which is always accurate, so there's no separate page-count step here any more. -------------------

    // ---- Real page thumbnails (pdf.js): pdf-lib above only reads a PDF's structure, it can't rasterize a
    // page to pixels, so the page strip used to just be page-shaped number cards. pdf.js can actually
    // render each page to a canvas — this loads it once per file and renders a thumbnail into a chip the
    // first time that chip scrolls into view (a 200-page PDF would otherwise render 200 pages up front).
    let qlPdfJsDoc = null, qlPdfJsWorkerUrl = null, qlPageObserver = null
    function ensurePdfJsWorker() {
      if (qlPdfJsWorkerUrl || !window.pdfjsLib) return qlPdfJsWorkerUrl
      const src = document.getElementById('pdfjs-worker-src')
      if (!src) return null
      const blob = new Blob([src.textContent], { type: 'application/javascript' })
      qlPdfJsWorkerUrl = URL.createObjectURL(blob)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = qlPdfJsWorkerUrl
      return qlPdfJsWorkerUrl
    }
    // One pdf.js document per file. The load is memoised (the page render and the strip thumbnails can
    // all ask for it in the same tick, and each getDocument() would otherwise spin up its own worker),
    // and a load that finishes after the preview has already moved on to another file is thrown away
    // rather than adopted — otherwise file B's thumbnails and page flips could quietly draw file A's pages.
    let qlPdfJsLoading = null
    async function ensurePdfJsDoc() {
      if (qlPdfJsDoc) return qlPdfJsDoc
      if (qlPdfJsLoading) return qlPdfJsLoading
      if (!window.pdfjsLib || !qlPdfBytes) return null
      if (!ensurePdfJsWorker()) return null
      const bytes = qlPdfBytes
      qlPdfJsLoading = (async () => {
        try {
          // pdf.js detaches/consumes the buffer it's given, so a page-count fallback using the same
          // qlPdfBytes elsewhere still has its own untouched copy.
          const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
          if (qlPdfBytes !== bytes) { void doc.destroy().catch(() => {}); return null } // a different file is on show now
          qlPdfJsDoc = doc
          return doc
        } catch (error) {
          if (qlPdfBytes === bytes) console.warn(LOG, 'pdf.js could not open this PDF', error)
          return null
        } finally {
          qlPdfJsLoading = null
        }
      })()
      return qlPdfJsLoading
    }
    // ---- Rendering a PDF page for the main preview itself: a <canvas>, not an <iframe> showing the
    // browser's own built-in PDF viewer. The native viewer draws its own toolbar/chrome over the page
    // (most visible on a single-page PDF, where there's no scrolling to carry it out of view) and its
    // internal zoom/scroll is opaque from outside, which is exactly why zooming it via a CSS transform
    // on the iframe element clipped the page instead of actually zooming it. A canvas is just pixels, so
    // it zooms through the exact same real-size mechanism as an image (see applyZoom/imageFitSize above):
    // naturalWidth/naturalHeight are set on it like an <img>'s, and it's rendered once at a resolution
    // high enough to stay crisp at the highest zoom step, so zooming afterward is a cheap CSS resize of
    // the existing bitmap rather than a re-render.
    // Safari/WebKit silently refuses to paint a <canvas> past roughly 16.7 million pixels of area — no
    // error, nothing in the console, whatever falls past that ceiling is just left blank. Rendering
    // eagerly at (highest zoom step) × devicePixelRatio, with no upper bound, is exactly what could cross
    // that line: a plain 1080×1350pt frame already reaches 6480×8100px (~52 million pixels) on an ordinary
    // retina screen, before the person has even touched the zoom control once — and a top portion
    // painting fine while the rest of the page stays pure white is precisely what that ceiling looks like.
    // Capping the eager render to a fixed pixel budget keeps every page within that ceiling everywhere,
    // while staying sharp enough that zooming afterward is still a plain CSS resize of the same bitmap.
    const PDF_RENDER_MAX_AREA = 9000000 // ~9 megapixels: well clear of the ~16.7M ceiling, still crisp
    // Two render qualities. 'fast' is the page at exactly the size it is about to be shown at (the
    // holder's fit box × devicePixelRatio — well under a megapixel in this window), which pdf.js turns
    // around in a few tens of milliseconds, so flipping pages feels instant. 'sharp' is the bitmap that
    // zooming actually needs (fit × the highest zoom step × devicePixelRatio, capped at
    // PDF_RENDER_MAX_AREA). Sharp used to be the only render, at a flat 9 Mpx no matter how small the
    // page is shown, and it was done from scratch on every page flip — a second or more of pdf.js work
    // each time, which is what made paging through a deck feel slow. It now happens in the background
    // once the fast render is already on screen, is cached per page (a small LRU), and the neighbouring
    // pages are rendered ahead of time, so paging back and forth never re-renders anything.
    function pdfRenderScales(base) {
      const dpr = window.devicePixelRatio || 1
      const w = qlHolder ? qlHolder.clientWidth : 0, h = qlHolder ? qlHolder.clientHeight : 0
      const fit = (w && h) ? Math.min(w / base.width, h / base.height) : 1
      const cap = Math.sqrt(PDF_RENDER_MAX_AREA / (base.width * base.height))
      const fast = Math.min(cap, Math.max(0.1, fit * dpr))
      return { fast, sharp: Math.min(cap, Math.max(fast, fit * dpr * ZOOM_STEPS[ZOOM_STEPS.length - 1])) }
    }
    async function renderPdfPage(n, quality) {
      const doc = await ensurePdfJsDoc()
      if (!doc) throw new Error('pdf.js unavailable')
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 }) // the page's "natural" size, same role naturalWidth/Height play for an <img>
      const viewport = page.getViewport({ scale: pdfRenderScales(base)[quality === 'sharp' ? 'sharp' : 'fast'] })
      const canvas = document.createElement('canvas')
      canvas.className = 'ql-media'
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.naturalWidth = base.width
      canvas.naturalHeight = base.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      return canvas
    }
    const qlPageCache = new Map() // page number → sharp canvas, insertion order = recency; cleared per file in qlCleanup
    const QL_PAGE_CACHE_MAX = 4   // a sharp canvas can be tens of MB of pixels; a handful covers paging back and forth
    function cacheSharpPage(n, canvas) {
      qlPageCache.delete(n)
      qlPageCache.set(n, canvas)
      while (qlPageCache.size > QL_PAGE_CACHE_MAX) qlPageCache.delete(qlPageCache.keys().next().value)
    }
    // Sharp renders (the current page's and the prefetches) run strictly one after another, so a prefetch
    // never competes with the page the person is actually looking at; each re-checks that it's still
    // wanted (same file, still the current page or next to it) right before it starts.
    let qlSharpQueue = Promise.resolve()
    const qlSharpPending = new Set()
    function queueSharpRender(n, onDone) {
      if (qlPageCache.has(n) || qlSharpPending.has(n)) return
      qlSharpPending.add(n)
      const doc = qlPdfJsDoc
      qlSharpQueue = qlSharpQueue.then(async () => {
        try {
          if (qlPdfJsDoc !== doc || !qlHolder || qlPageCache.has(n) || Math.abs(n - qlPage) > 1) return
          const canvas = await renderPdfPage(n, 'sharp')
          if (qlPdfJsDoc !== doc) return
          cacheSharpPage(n, canvas)
          if (onDone) onDone(canvas)
        } catch (error) {
          console.warn(LOG, `Couldn't render page ${n}`, error)
        } finally {
          qlSharpPending.delete(n)
        }
      })
    }
    function prefetchPdfNeighbours(n) {
      for (const m of [n + 1, n - 1]) if (m >= 1 && m <= qlPageCount) queueSharpRender(m)
    }
    // Puts a rendered page in the holder in place of whatever page is there, carrying the zoom level over
    // and, when a sharp render replaces the fast one of the same page, the scroll position too.
    function placePdfCanvas(canvas, label) {
      const old = qlMedia
      // A cached canvas may still carry the inline size (and the fade-in class) from the last time it
      // was shown — cleared first, so the 100% baseline below is measured from the real fitted size.
      canvas.removeAttribute('style')
      canvas.classList.remove('is-loading')
      canvas.setAttribute('aria-label', label || (old && old.getAttribute && old.getAttribute('aria-label')) || '')
      const scroll = old ? [qlHolder.scrollLeft, qlHolder.scrollTop] : null
      if (!old) { canvas.classList.add('is-loading'); requestAnimationFrame(() => canvas.classList.remove('is-loading')) }
      // Stepping away and straight back to a page can ask for the very canvas already on screen (its
      // sharp render, served from the cache) — nothing to swap then, and "remove the old one" must not
      // run, since the old one *is* this canvas.
      if (old !== canvas) {
        qlHolder.insertBefore(canvas, old || null)
        if (old) old.remove()
      }
      qlMedia = canvas
      if (qlZoom === 1) captureMediaFit() // measured now, while the canvas is unstyled (so at its 100% size)
      applyZoom(Boolean(scroll))
      if (scroll && qlZoom !== 1) { qlHolder.scrollLeft = scroll[0]; qlHolder.scrollTop = scroll[1] }
    }
    // Shows page n: straight from the cache when its sharp render is there, otherwise a fast render right
    // away with the sharp one swapped in underneath once it's done. Resolves false when nothing could be shown.
    async function showPdfPage(n, label) {
      if (!qlHolder) return false
      const token = ++qlPdfRenderToken
      const holder = qlHolder
      let canvas = qlPageCache.get(n)
      if (canvas) cacheSharpPage(n, canvas) // bump its recency
      else {
        try { canvas = await renderPdfPage(n, 'fast') } catch (error) { console.warn(LOG, `Couldn't render page ${n}`, error); return false }
        // The preview may have moved on to a different page/file by the time this resolves.
        if (token !== qlPdfRenderToken || qlHolder !== holder) return false
      }
      placePdfCanvas(canvas, label)
      if (!qlPageCache.has(n)) queueSharpRender(n, (sharp) => { if (token === qlPdfRenderToken && qlHolder === holder && qlPage === n) placePdfCanvas(sharp) })
      prefetchPdfNeighbours(n)
      return true
    }
    async function renderPageThumb(chip, n) {
      if (chip.dataset.rendering || chip.dataset.rendered) return
      chip.dataset.rendering = '1'
      const doc = await ensurePdfJsDoc()
      // The preview may have moved on to a different file (or closed) by the time this resolves.
      if (!doc || chip.isConnected === false || chip.dataset.stale) return
      try {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(40 / base.width, 52 / base.height)
        const viewport = page.getViewport({ scale })
        if (chip.dataset.stale) return
        const canvas = document.createElement('canvas')
        canvas.className = 'ql-page-thumb'
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        if (chip.dataset.stale) return
        chip.textContent = ''
        chip.append(canvas, Object.assign(document.createElement('span'), { className: 'ql-page-num', textContent: String(n) }))
        chip.dataset.rendered = '1'
      } catch (error) {
        console.warn(LOG, `Couldn't render a thumbnail for page ${n}`, error)
      } finally {
        delete chip.dataset.rendering
      }
    }
    // Shared by a page-strip click and the page prev/next arrows, so both keep the strip, the count
    // label and the arrows' disabled state in sync the same way.
    function setPage(n) {
      if (!qlMedia || n === qlPage || n < 1 || n > qlPageCount) return
      qlPage = n
      for (const chip of qlPages.children) chip.classList.toggle('is-current', Number(chip.dataset.page) === n)
      qlPages.children[n - 1] && qlPages.children[n - 1].scrollIntoView({ block: 'nearest' })
      void showPdfPage(n)
      qlCount.textContent = qlList.length > 1 ? `${qlIndex + 1} of ${qlList.length} · Page ${n} of ${qlPageCount}` : `Page ${n} of ${qlPageCount}`
    }
    function buildPageStrip(count) {
      qlPages.textContent = ''
      qlPageCount = count || 0
      if (qlPageObserver) { qlPageObserver.disconnect(); qlPageObserver = null }
      // A single-page PDF still gets its one chip — it's a plain, honest page count (same as Google's own
      // preview shows), not just a strip that's only useful once there's more than one page to jump between.
      if (!count) { qlPages.hidden = true; return }
      qlPage = 1
      qlPageObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) void renderPageThumb(entry.target, Number(entry.target.dataset.page))
      }, { root: qlPages, rootMargin: '200px 0px' })
      for (let n = 1; n <= count; n += 1) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = `ql-page-chip${n === 1 ? ' is-current' : ''}`
        chip.textContent = String(n)
        chip.dataset.page = String(n)
        chip.setAttribute('aria-label', `Page ${n} of ${count}`)
        chip.addEventListener('click', () => setPage(n))
        qlPages.append(chip)
        qlPageObserver.observe(chip)
      }
      qlPages.hidden = false
    }

    function qlMessage(text, entry) {
      const box = document.createElement('div')
      box.className = 'ql-msg'
      const p = document.createElement('p')
      p.textContent = text
      box.append(p)
      if (entry) {
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'small-button is-primary'
        open.textContent = 'Open in Drive'
        open.addEventListener('click', () => post({ type: 'open-url', url: driveUrl(entry) }))
        box.append(open)
      }
      return box
    }