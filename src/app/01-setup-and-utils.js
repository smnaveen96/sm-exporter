    // =====================================================================================
    //  TEAM SETUP — fill these in once, then share the plugin folder with the team.
    //  Values come from Google Cloud → Google Auth Platform → Clients → "Figma plugin"
    //  (Desktop app). With them filled in, teammates never see the OAuth settings drawer;
    //  they only sign in with their own Google account once. Leave both empty to make every
    //  user enter the client themselves in the ⚙ drawer.
    // =====================================================================================
    const DEFAULT_GOOGLE_CLIENT_ID = ''
    const DEFAULT_GOOGLE_CLIENT_SECRET = ''
    const DEFAULT_GOOGLE_REDIRECT_URI = 'http://127.0.0.1:53682/'

    const LOG = '[SM exporter]'
    // A plain build marker, printed once on load — Figma (and some browsers) can hang onto a cached copy
    // of a plugin's ui.html, so when a fix doesn't seem to be there, the fastest way to tell "did the new
    // file actually load" from "did the fix not work" is checking this string in the console against the
    // date of whatever ui.html was just handed over, rather than guessing from behavior alone.
    console.log(LOG, 'build 2026-10-08-r11')
    let selectedCount = 0
    let busy = false
    let thumbnailUrls = []
    let latestSelectionVersion = null // thumbnails that arrive for an older selection are ignored
    // Where the files produced by the next export go: 'download' (EXPORT) or 'drive' (UPLOAD).
    let activeDestination = 'download'

    const selectionCount = document.getElementById('selection-count')
    const preview = document.getElementById('preview')
    const previewArrowLeft = document.getElementById('preview-arrow-left')
    const previewArrowRight = document.getElementById('preview-arrow-right')
    const exportButton = document.getElementById('export-button')
    const buttonLabel = document.getElementById('button-label')
    const fileNameInput = document.getElementById('file-name')
    const driveSubmit = document.getElementById('drive-submit')
    let tooltipEl = null, tooltipTimer = 0, overTarget = null // button tooltips (set up further down)

    function post(message) {
      parent.postMessage({ pluginMessage: message }, '*')
    }

    function checked(id) {
      return document.getElementById(id).checked
    }

    const FORMAT_IDS = ['jpeg', 'pdf-image', 'png', 'webp', 'svg', 'pdf-vector']

    function anyFormatSelected() {
      return FORMAT_IDS.some(checked)
    }

    function scaleOf(id) {
      const value = Number(document.getElementById(id).value)
      return Number.isFinite(value) && value > 0 ? value : 1
    }

    function exportOptions() {
      return {
        jpeg: checked('jpeg'),
        pdfImage: checked('pdf-image'),
        webp: checked('webp'),
        png: checked('png'),
        svg: checked('svg'),
        pdfVector: checked('pdf-vector'),
        pdfMode: document.getElementById('pdf-mode').value, // 'merged' | 'individual'
        compressPdf: checked('pdf-vector') && checked('compress-pdf'),
        compressLevel: document.getElementById('compress-level').value, // 'default' | 'smaller'
        scales: { jpeg: scaleOf('jpeg-scale'), png: scaleOf('png-scale'), webp: scaleOf('webp-scale') },
        fileName: fileNameInput.value.trim() || 'SM Export', // placeholder is the default name
        typedName: fileNameInput.value.trim(), // empty when the user left the default
        order: frameOrder.slice(), // thumbnail order → export/numbering order
      }
    }

    function updateButton() {
      const blocked = busy || selectedCount === 0 || !anyFormatSelected()
      exportButton.disabled = blocked
      driveSubmit.disabled = blocked
      refreshTooltip()
    }

    // Formats, scales and Compress are remembered per person (figma.clientStorage), so the
    // plugin opens the way it was left. Nothing is ever ticked that the user did not tick.
    const STORAGE_SETTINGS_KEY = 'tier2-export-settings'
    const SETTING_CHECKBOXES = ['jpeg', 'pdf-image', 'png', 'webp', 'svg', 'pdf-vector', 'compress-pdf']
    const SETTING_SELECTS = ['jpeg-scale', 'png-scale', 'webp-scale', 'compress-level', 'pdf-mode']
    let settingsLoaded = false
    // Resolves once the first 'storage' reply arrives from the plugin's main thread (where the saved
    // last-used folder actually lives). Opening the picker before that reply lands used to mark the
    // last-folder lookup "done" with nothing yet to apply, permanently skipping it for the rest of the
    // session — which is exactly what a fast click on "Drive folders" right after launch would trigger.
    let resolveStorageReady
    const storageReady = new Promise((resolve) => { resolveStorageReady = resolve })
    function currentSettings() {
      const settings = {}
      for (const id of SETTING_CHECKBOXES) settings[id] = checked(id)
      for (const id of SETTING_SELECTS) settings[id] = document.getElementById(id).value
      return settings
    }
    function saveSettings() {
      if (!settingsLoaded) return // never overwrite the stored settings with defaults before they arrive
      post({ type: 'storage-set', values: { [STORAGE_SETTINGS_KEY]: currentSettings() } })
    }
    // The folder last used for an upload (however it was chosen — typed link or the picker), so the
    // plugin can reopen there instead of always starting back at My Drive.
    let lastFolder = null       // { id, name } loaded from storage, applied once the picker first opens
    let lastFolderApplied = false
    function saveLastFolder(id, name) {
      if (!id) return
      lastFolder = { id, name: name || 'Folder' }
      post({ type: 'storage-set', values: { [STORAGE_LAST_FOLDER_KEY]: lastFolder } })
    }
    function applySettings(settings) {
      settingsLoaded = true
      if (!settings || typeof settings !== 'object') return
      for (const id of SETTING_CHECKBOXES) if (typeof settings[id] === 'boolean') document.getElementById(id).checked = settings[id]
      for (const id of SETTING_SELECTS) {
        const select = document.getElementById(id)
        if (typeof settings[id] === 'string' && Array.from(select.options).some((option) => option.value === settings[id])) select.value = settings[id]
      }
      document.querySelectorAll('.scale-pill select').forEach((select) => select.dispatchEvent(new Event('sync')))
      syncCompressToggle()
      updateButton()
    }

    function setButtonState(state, label) {
      exportButton.classList.remove('is-busy', 'is-success', 'is-error')
      if (state) exportButton.classList.add(`is-${state}`)
      exportButton.setAttribute('aria-busy', state === 'busy' ? 'true' : 'false')
      buttonLabel.textContent = label
    }

    function clearThumbnailUrls() {
      for (const url of thumbnailUrls) URL.revokeObjectURL(url)
      thumbnailUrls = []
    }

    function asBytes(value) {
      return value instanceof Uint8Array ? value : new Uint8Array(value)
    }

    // Export order = order of the thumbnails. The sandbox sends frames in canvas reading
    // order; the user can drag thumbnails to change it. Reset only when the set of frames changes.
    let frameOrder = []   // frame node ids, current export order
    let frameNames = {}   // id → layer name (for tooltips)
    const selected = new Set()   // thumbnails currently selected (for group reordering)
    let selectionAnchor = null   // where a Shift+click range starts

    function sameIdSet(a, b) {
      if (a.length !== b.length) return false
      const set = new Set(a)
      return b.every((id) => set.has(id))
    }

    function renumberThumbnails() {
      const thumbs = Array.from(preview.querySelectorAll('.thumb'))
      const width = Math.max(2, String(thumbs.length).length)
      thumbs.forEach((thumb, index) => {
        const label = String(index + 1).padStart(width, '0')
        thumb.querySelector('.thumb-index').textContent = label
        if (thumbs.length > 1) thumb.title = 'Drag to reorder'; else thumb.removeAttribute('title')
      })
      frameOrder = thumbs.map((thumb) => thumb.dataset.id)
    }

    function renderThumbnails(thumbnails, ids, names, pending) {
      // While fresh previews are still being rendered, a frame that stays selected keeps showing
      // its current preview (no blank flash); the new one replaces it as soon as it arrives.
      const kept = new Map()
      if (pending && ids) {
        const wanted = new Set(ids)
        preview.querySelectorAll('.thumb').forEach((thumb) => {
          const img = thumb.querySelector('img')
          if (img && img.dataset.blob && wanted.has(thumb.dataset.id)) kept.set(thumb.dataset.id, img.dataset.blob)
        })
      }
      const keptUrls = new Set(kept.values())
      for (const url of thumbnailUrls) if (!keptUrls.has(url)) URL.revokeObjectURL(url)
      thumbnailUrls = thumbnailUrls.filter((url) => keptUrls.has(url))
      preview.replaceChildren()
      selected.clear()
      selectionAnchor = null
      if (!thumbnails.length && !pending) {
        const empty = document.createElement('div')
        empty.className = 'preview-empty'
        empty.textContent = selectedCount ? 'Preview unavailable' : 'No frames selected'
        preview.appendChild(empty)
        updateScrollCues()
        frameOrder = ids ? ids.slice() : []
        return
      }
      ids = ids || thumbnails.map((_, index) => `frame-${index}`)
      frameNames = {}
      ids.forEach((id, index) => { frameNames[id] = (names || [])[index] || '' })
      // Keep the user's arrangement if the same frames are still selected.
      const order = sameIdSet(frameOrder, ids) ? frameOrder.slice() : ids.slice()
      const byId = new Map(ids.map((id, index) => [id, thumbnails[index]]))
      for (const id of order) {
        const bytes = byId.get(id)
        let url = null
        if (bytes) {
          url = URL.createObjectURL(new Blob([asBytes(bytes)], { type: 'image/png' }))
          thumbnailUrls.push(url)
        } else if (kept.has(id)) {
          url = kept.get(id)
        }
        const frame = document.createElement('div')
        frame.className = 'thumb'
        frame.dataset.id = id
        const image = document.createElement('img')
        if (url) { image.src = url; image.dataset.blob = url } else if (pending) frame.classList.add('is-loading')
        image.alt = frameNames[id] || 'Selected frame'
        image.draggable = false
        const badge = document.createElement('span')
        badge.className = 'thumb-index'
        frame.appendChild(image)
        frame.appendChild(badge)
        preview.appendChild(frame)
      }
      renumberThumbnails()
      updateScrollCues()
    }

    // A thumbnail finished rendering: put it into its slot (replacing the previous preview, if any).
    function applyThumbnail(id, bytes) {
      const thumb = Array.from(preview.querySelectorAll('.thumb')).find((candidate) => candidate.dataset.id === id)
      if (!thumb) return
      const image = thumb.querySelector('img')
      if (bytes) {
        const previous = image.dataset.blob
        const url = URL.createObjectURL(new Blob([asBytes(bytes)], { type: 'image/png' }))
        thumbnailUrls.push(url)
        image.src = url
        image.dataset.blob = url
        if (previous) {
          URL.revokeObjectURL(previous)
          thumbnailUrls = thumbnailUrls.filter((candidate) => candidate !== previous)
        }
      }
      thumb.classList.remove('is-loading')
    }

    // Left / right arrows appear only where there is more to see; none when everything fits.
    function updateScrollCues() {
      const max = preview.scrollWidth - preview.clientWidth
      const left = preview.scrollLeft
      previewArrowLeft.classList.toggle('is-visible', max > 1 && left > 1)
      previewArrowRight.classList.toggle('is-visible', max > 1 && left < max - 1)
    }
    preview.addEventListener('scroll', updateScrollCues, { passive: true })
    window.addEventListener('resize', updateScrollCues)
    function glideTo(target) {
      const max = preview.scrollWidth - preview.clientWidth
      scrollTarget = Math.max(0, Math.min(max, target))
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(glideScroll)
    }
    const CARD_STEP = 80 + 7 // thumbnail width + gap
    previewArrowLeft.addEventListener('click', () => glideTo((scrollTarget === null ? preview.scrollLeft : scrollTarget) - CARD_STEP))
    previewArrowRight.addEventListener('click', () => glideTo((scrollTarget === null ? preview.scrollLeft : scrollTarget) + CARD_STEP))

    // A mouse wheel (vertical) scrolls the strip sideways with a short eased glide.
    // Trackpad swipes (horizontal deltas) keep their native feel.
    let scrollTarget = null
    let scrollFrame = 0
    function glideScroll() {
      const distance = scrollTarget - preview.scrollLeft
      if (Math.abs(distance) < 1) { preview.scrollLeft = scrollTarget; scrollTarget = null; return }
      // scrollLeft is integer-rounded by the browser: always move at least a whole pixel.
      const step = distance * 0.28
      preview.scrollLeft += Math.abs(step) < 1 ? Math.sign(step) : step
      scrollFrame = requestAnimationFrame(glideScroll)
    }
    preview.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return // horizontal swipe: native
      const max = preview.scrollWidth - preview.clientWidth
      if (max <= 0) return
      event.preventDefault()
      const from = scrollTarget === null ? preview.scrollLeft : scrollTarget
      scrollTarget = Math.max(0, Math.min(max, from + event.deltaY))
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(glideScroll)
    }, { passive: false })

    // Pointer-based drag to reorder thumbnails, Figma-layer-list style: the held thumbnail
    // follows the pointer, neighbours slide aside with an eased transition, and on release the
    // thumbnail glides into its slot before the DOM order (and export order) is committed.
    //
    // Selection: click selects one frame, Shift+click selects a range, Cmd (Mac) / Ctrl (Windows)
    // +click toggles one frame, Cmd/Ctrl+A selects all, Esc clears. Dragging any selected frame
    // moves the whole selection as a block, keeping its internal order.
    // Dragging near either end of the strip scrolls it, so a frame can travel the full length.
    let drag = null
    let autoFrame = 0

    function dragThumbs() {
      return Array.from(preview.querySelectorAll('.thumb'))
    }

    function applySelectionClasses() {
      dragThumbs().forEach((thumb) => thumb.classList.toggle('is-selected', selected.has(thumb)))
    }
    function selectOnly(thumb) {
      selected.clear()
      if (thumb) selected.add(thumb)
      selectionAnchor = thumb || null
      applySelectionClasses()
    }
    function selectRange(thumb, additive) {
      const thumbs = dragThumbs()
      const anchor = thumbs.includes(selectionAnchor) ? selectionAnchor : (thumbs.find((t) => selected.has(t)) || thumb)
      const from = thumbs.indexOf(anchor)
      const to = thumbs.indexOf(thumb)
      if (!additive) selected.clear()
      for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) selected.add(thumbs[i])
      selectionAnchor = anchor
      applySelectionClasses()
    }

    // Final order if the drag ended now: the unselected frames keep their order, and the selected
    // block is inserted after the first `drag.k` of them.
    function projectedOrder() {
      const rest = drag.rest.map((i) => drag.thumbs[i])
      const group = drag.group.map((i) => drag.thumbs[i])
      return [...rest.slice(0, drag.k), ...group, ...rest.slice(drag.k)]
    }

    function renumberProjected() {
      const order = projectedOrder()
      const width = Math.max(2, String(order.length).length)
      order.forEach((thumb, index) => { thumb.querySelector('.thumb-index').textContent = String(index + 1).padStart(width, '0') })
    }

    function layoutRest() {
      // Unselected frames slide to their projected slot, opening a gap as wide as the selection.
      drag.rest.forEach((index, rank) => {
        const projected = rank < drag.k ? rank : rank + drag.group.length
        const shift = (projected - index) * drag.slot
        drag.thumbs[index].style.transform = shift ? `translateX(${shift}px)` : ''
      })
    }

    function updateDrag() {
      // Content-space offset of the held frame: pointer travel plus however far the strip has scrolled.
      let dx = drag.lastX - drag.startX + (preview.scrollLeft - drag.startScroll)
      // Keep the held frame within the strip: it can reach the first and last slot, plus a small margin, but no further.
      const END_MARGIN = 6
      const first = drag.centers[0] - END_MARGIN
      const last = drag.centers[drag.centers.length - 1] + END_MARGIN
      dx = Math.max(first - drag.centers[drag.fromIndex], Math.min(last - drag.centers[drag.fromIndex], dx))
      const heldCenter = drag.centers[drag.fromIndex] + dx
      drag.thumb.style.transform = `translateX(${dx}px)`
      let follower = 0
      drag.group.forEach((index) => {
        if (index === drag.fromIndex) return
        follower += 1
        const offset = Math.min(follower, 3) * 4
        const x = drag.centers[drag.fromIndex] + dx - drag.centers[index] + offset
        drag.thumbs[index].style.transform = `translate(${x}px, ${offset * 0.6}px)`
      })
      // Target slot = how many unselected thumbnails' centres the held centre has passed.
      let k = 0
      for (const index of drag.rest) if (drag.centers[index] < heldCenter) k += 1
      if (k !== drag.k) {
        drag.k = k
        layoutRest()
        renumberProjected()
      }
    }

    function autoScrollTick() {
      autoFrame = 0
      if (!drag || !drag.active) return
      const rect = preview.getBoundingClientRect()
      const zone = 36
      let speed = 0
      if (drag.lastX < rect.left + zone) speed = -Math.min(1, (rect.left + zone - drag.lastX) / zone) * 16
      else if (drag.lastX > rect.right - zone) speed = Math.min(1, (drag.lastX - (rect.right - zone)) / zone) * 16
      if (speed) {
        const before = preview.scrollLeft
        preview.scrollLeft += Math.abs(speed) < 1 ? Math.sign(speed) : speed
        if (preview.scrollLeft !== before) updateDrag()
      }
      autoFrame = requestAnimationFrame(autoScrollTick)
    }
    // Wheel / trackpad scrolling during a drag must move the held frame with the strip too.
    preview.addEventListener('scroll', () => { if (drag && drag.active) updateDrag() }, { passive: true })

    preview.addEventListener('pointerdown', (event) => {
      if (drag) { finishDrag(); return } // a drag that never got its release: settle it instead of getting stuck
      if (busy || event.button !== 0) return
      const thumb = event.target.closest('.thumb')
      if (!thumb) { if (event.target === preview) selectOnly(null); return }
      const additive = event.metaKey || event.ctrlKey
      let collapseOnClick = false
      if (event.shiftKey) {
        selectRange(thumb, additive)
      } else if (additive) {
        if (selected.has(thumb)) { // toggling a frame off: nothing to drag
          selected.delete(thumb)
          selectionAnchor = thumb
          applySelectionClasses()
          event.preventDefault()
          return
        }
        selected.add(thumb)
        selectionAnchor = thumb
        applySelectionClasses()
      } else if (!selected.has(thumb)) {
        selectOnly(thumb)
      } else if (selected.size > 1) {
        collapseOnClick = true // a plain click on a multi-selection narrows it to this frame, unless it turns into a drag
      }
      const thumbs = dragThumbs()
      const rects = thumbs.map((t) => t.getBoundingClientRect())
      const fromIndex = thumbs.indexOf(thumb)
      const slot = rects.length > 1 ? Math.abs(rects[1].left - rects[0].left) : rects[0].width + 7
      drag = {
        thumb, thumbs, pointerId: event.pointerId, active: false, collapseOnClick,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX,
        startScroll: preview.scrollLeft,
        fromIndex, k: 0, slot, group: [], rest: [],
        centers: rects.map((r) => r.left + r.width / 2), // layout centres, unaffected by transforms
      }
      thumb.setPointerCapture(event.pointerId)
      event.preventDefault()
    })

    preview.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (!(event.buttons & 1)) { finishDrag(); return } // the button was released somewhere we never saw it
      drag.lastX = event.clientX
      if (!drag.active) {
        if (Math.abs(event.clientX - drag.startX) < 4 && Math.abs(event.clientY - drag.startY) < 4) return
        drag.active = true
        cancelAnimationFrame(scrollFrame) // stop any wheel glide so it cannot fight the drag
        scrollTarget = null
        const indices = drag.thumbs.map((t, i) => i)
        drag.group = indices.filter((i) => selected.has(drag.thumbs[i]))
        if (!drag.group.includes(drag.fromIndex)) drag.group = [drag.fromIndex]
        drag.rest = indices.filter((i) => !drag.group.includes(i))
        drag.k = drag.rest.filter((i) => i < drag.fromIndex).length // start with nothing displaced
        drag.thumb.classList.add('is-dragging')
        if (drag.group.length > 1) drag.thumb.dataset.count = String(drag.group.length)
        drag.group.forEach((i) => { if (i !== drag.fromIndex) drag.thumbs[i].classList.add('is-follower') })
        preview.classList.add('is-reordering')
        layoutRest()
        renumberProjected()
        autoFrame = requestAnimationFrame(autoScrollTick)
      }
      updateDrag()
    })

    function finishDrag() {
      const current = drag
      drag = null
      cancelAnimationFrame(autoFrame)
      autoFrame = 0
      if (!current.active) { // a plain click
        if (current.collapseOnClick) selectOnly(current.thumb)
        return
      }
      const { thumb, thumbs, group, rest, k, slot } = current
      const order = [...rest.slice(0, k).map((i) => thumbs[i]), ...group.map((i) => thumbs[i]), ...rest.slice(k).map((i) => thumbs[i])]
      const moved = order.some((t, i) => t !== thumbs[i])
      const commit = () => {
        if (moved) order.forEach((t) => preview.appendChild(t))
        // Clear the slide transforms with transitions frozen, so nothing animates over the
        // slot it has just been placed in.
        const all = dragThumbs()
        for (const t of all) { t.style.transition = 'none'; t.style.transform = '' }
        for (const t of all) t.classList.remove('is-dragging', 'is-settling', 'is-follower')
        thumb.removeAttribute('data-count')
        preview.classList.remove('is-reordering')
        void preview.offsetWidth // apply the frozen state before re-enabling transitions
        requestAnimationFrame(() => { for (const t of all) t.style.transition = '' })
        renumberThumbnails()
        if (moved) console.log(LOG, 'Frame order:', frameOrder.join(', '))
      }
      // Glide every moved frame into its target slot, then commit the DOM order.
      group.forEach((index, rank) => {
        const t = thumbs[index]
        t.classList.remove('is-follower')
        t.classList.add('is-settling')
        t.style.transform = `translateX(${(k + rank - index) * slot}px)`
      })
      let done = false
      const finish = () => { if (done) return; done = true; thumb.removeEventListener('transitionend', finish); commit() }
      thumb.addEventListener('transitionend', finish)
      setTimeout(finish, 260)
    }

    function endDrag(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return
      finishDrag()
    }
    preview.addEventListener('pointerup', endDrag)
    preview.addEventListener('pointercancel', endDrag)
    preview.addEventListener('lostpointercapture', endDrag)
    // Releasing outside the plugin window, or the window losing focus mid-drag, must also end the drag.
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', () => { if (drag) finishDrag() })
    document.addEventListener('pointerdown', (event) => {
      if (drag || !selected.size) return
      if (event.target.closest && event.target.closest('.preview-wrap')) return
      selectOnly(null)
    })
    // Ctrl+click opens a context menu on macOS; keep it from interrupting a selection.
    preview.addEventListener('contextmenu', (event) => { if (event.target.closest('.thumb')) event.preventDefault() })

    document.addEventListener('keydown', (event) => {
      if (busy || drag) return
      const active = document.activeElement
      if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) return
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
        // The Drive drawer/picker sits on top of this view and has its own Cmd/Ctrl+A handler (see
        // "Keyboard in the picker" below) — this one used to fire too since it never checked drawerMode,
        // silently selecting the hidden frame thumbnails underneath whatever the picker was doing.
        if (drawerMode) return
        const thumbs = dragThumbs()
        if (!thumbs.length) return
        event.preventDefault()
        selected.clear()
        thumbs.forEach((t) => selected.add(t))
        selectionAnchor = thumbs[0]
        applySelectionClasses()
      } else if (event.key === 'Escape' && selected.size && !drawerMode) {
        selectOnly(null)
      }
    })

    document.querySelectorAll('.scale-pill select').forEach((select) => {
      const value = select.parentElement.querySelector('.scale-value')
      const sync = () => { value.textContent = select.options[select.selectedIndex].text }
      select.addEventListener('change', () => { sync(); saveSettings(); dropStaleTick() })
      select.addEventListener('sync', sync)
      sync()
    })
    // The info tooltip next to the PDF type pill follows the chosen type.
    const PDF_MODE_TIPS = { merged: 'All frames in one PDF', individual: 'One PDF per frame' }
    const pdfModeSelect = document.getElementById('pdf-mode')
    function syncPdfModeTip() {
      const tip = PDF_MODE_TIPS[pdfModeSelect.value] || PDF_MODE_TIPS.merged
      document.getElementById('pdf-vector-tip').textContent = tip
      document.getElementById('pdf-vector-info').setAttribute('aria-label', `About ${pdfModeSelect.options[pdfModeSelect.selectedIndex].text} PDF: ${tip}`)
      refreshTooltip() // in case it's this icon's tooltip that's open right now and the type just changed
    }
    pdfModeSelect.addEventListener('change', syncPdfModeTip)
    pdfModeSelect.addEventListener('sync', syncPdfModeTip)
    syncPdfModeTip()
    const compressToggle = document.getElementById('compress-toggle')
    const compressInput = document.getElementById('compress-pdf')
    const compressLevelPill = document.getElementById('compress-level-pill')
    function syncCompressToggle() {
      const enabled = checked('pdf-vector')
      compressInput.disabled = !enabled
      compressToggle.classList.toggle('is-disabled', !enabled)
      compressLevelPill.hidden = !(enabled && compressInput.checked)
    }
    document.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener('change', () => {
      syncCompressToggle()
      if (exportButton.classList.contains('is-error')) setButtonState('', 'EXPORT')
      updateButton()
      saveSettings()
      dropStaleTick()
    }))
    syncCompressToggle()

    exportButton.addEventListener('click', () => {
      busy = true
      activeDestination = 'download'
      setButtonState('busy', `EXPORTING 0/${selectedCount}`)
      updateButton()
      post({ type: 'export', options: exportOptions() })
    })

    function concatBytes(chunks) {
      const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const output = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.length
      }
      return output
    }

    function textBytes(value) {
      return new TextEncoder().encode(value)
    }

    async function convertPng(pngBytes, mime, quality) {
      const bitmap = await createImageBitmap(new Blob([asBytes(pngBytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (mime === 'image/jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image conversion failed.')), mime, quality)
      })
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
    }

    function buildRasterPdf(images) {
      const objectCount = 2 + images.length * 3
      const objects = new Array(objectCount + 1)
      const pageRefs = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
      objects[1] = textBytes('<< /Type /Catalog /Pages 2 0 R >>')
      objects[2] = textBytes(`<< /Type /Pages /Count ${images.length} /Kids [${pageRefs}] >>`)
      images.forEach((image, index) => {
        const pageId = 3 + index * 3
        const imageId = pageId + 1
        const contentId = pageId + 2
        const imageName = `Im${index + 1}`
        const content = textBytes(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/${imageName} Do\nQ\n`)
        objects[pageId] = textBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)
        objects[imageId] = concatBytes([
          textBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace [/CalRGB << /WhitePoint [0.95047 1 1.08883] /Gamma [2.2 2.2 2.2] /Matrix [0.4124564 0.2126729 0.0193339 0.3575761 0.7151522 0.1191920 0.1804375 0.0721750 0.9503041] >>] /Intent /RelativeColorimetric /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
          image.bytes,
          textBytes('\nendstream'),
        ])
        objects[contentId] = concatBytes([textBytes(`<< /Length ${content.length} >>\nstream\n`), content, textBytes('endstream')])
      })
      const chunks = [textBytes('%PDF-1.4\n%1234\n')]
      const offsets = new Array(objectCount + 1).fill(0)
      let position = chunks[0].length
      for (let id = 1; id <= objectCount; id += 1) {
        const object = concatBytes([textBytes(`${id} 0 obj\n`), objects[id], textBytes('\nendobj\n')])
        offsets[id] = position
        chunks.push(object)
        position += object.length
      }
      const xrefOffset = position
      let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
      for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
      xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
      chunks.push(textBytes(xref))
      return concatBytes(chunks)
    }

    const crcTable = (() => {
      const table = new Uint32Array(256)
      for (let index = 0; index < 256; index += 1) {
        let value = index
        for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
        table[index] = value >>> 0
      }
      return table
    })()

    function crc32(bytes) {
      let value = 0xffffffff
      for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
      return (value ^ 0xffffffff) >>> 0
    }

    function littleEndian16(value) {
      return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
    }

    function littleEndian32(value) {
      return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
    }

    function zipDateTime(date) {
      const year = Math.max(1980, date.getFullYear())
      return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      }
    }

    function buildZip(files) {
      const localParts = []
      const centralParts = []
      const stamp = zipDateTime(new Date())
      let localOffset = 0
      for (const file of files) {
        const name = textBytes(file.name)
        const data = asBytes(file.bytes)
        const checksum = crc32(data)
        const localHeader = concatBytes([
          littleEndian32(0x04034b50), littleEndian16(20), littleEndian16(0x0800), littleEndian16(0),
          littleEndian16(stamp.time), littleEndian16(stamp.date), littleEndian32(checksum),
          littleEndian32(data.length), littleEndian32(data.length), littleEndian16(name.length), littleEndian16(0),
        ])
        const localFile = concatBytes([localHeader, name, data])
        localParts.push(localFile)
        centralParts.push(concatBytes([
          littleEndian32(0x02014b50), littleEndian16(20), littleEndian16(20), littleEndian16(0x0800), littleEndian16(0),
          littleEndian16(stamp.time), littleEndian16(stamp.date), littleEndian32(checksum),
          littleEndian32(data.length), littleEndian32(data.length), littleEndian16(name.length),
          littleEndian16(0), littleEndian16(0), littleEndian16(0), littleEndian16(0), littleEndian32(0),
          littleEndian32(localOffset), name,
        ]))
        localOffset += localFile.length
      }
      const centralDirectory = concatBytes(centralParts)
      const end = concatBytes([
        littleEndian32(0x06054b50), littleEndian16(0), littleEndian16(0),
        littleEndian16(files.length), littleEndian16(files.length), littleEndian32(centralDirectory.length),
        littleEndian32(localOffset), littleEndian16(0),
      ])
      return concatBytes([...localParts, centralDirectory, end])
    }

    function normalizedFilename(value, extension, fallback) {
      const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const withoutExtension = String(value || '').trim().replace(new RegExp(`(?:\\.${escaped})+$`, 'i'), '')
      const safe = withoutExtension.replace(/[\\/:*?"<>|]/g, '-').trim() || fallback
      return `${safe}.${extension}`
    }

    // Turns the sandbox's PNG renders into the final JPEG / WebP / PDF files.
    // Shared by the EXPORT (download) and UPLOAD (Google Drive) paths.
    // The PNG render for a given scale: 1x is the shared render, others come from `renders`.
