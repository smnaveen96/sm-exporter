    // ---- Custom video controls: native <video controls> puts its buttons wherever the browser decides
    // (the mute icon in particular lands on the left in a cramped player, not the right), and can't be
    // restyled, so a small custom bar replaces it instead — play/pause, ±10s, a seek bar and time on the
    // left, mute, speed and fullscreen on the right. It shows on hover or while paused, and fades away
    // during playback, the same shape as every familiar player's controls, "Chapters" aside. --------------
    function formatClock(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
      const total = Math.floor(seconds)
      const h = Math.floor(total / 3600)
      const m = Math.floor((total % 3600) / 60)
      const s = total % 60
      const mm = h ? String(m).padStart(2, '0') : String(m)
      return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
    }
    const VIDEO_PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>'
    const VIDEO_PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    const VIDEO_MUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9v6h4l5 4V5l-5 4z"/><path d="M19 9l-4 4M15 9l4 4"/></svg>'
    const VIDEO_UNMUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9v6h4l5 4V5l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 7a7 7 0 0 1 0 10"/></svg>'
    // A native range input's thumb, wrapped with a plain div thumb drawn at the exact pixel the value
    // maps to — see the .ql-range comment above for why. `axis` is 'x' (left→right, e.g. the seek bar)
    // or 'y' (bottom→top, the rotated volume slider, measured along its own unrotated width which
    // visually becomes vertical).
    function wireRangeThumb(input, track, thumb, axis) {
      const sync = () => {
        const max = Number(input.max) || 100
        const pct = Math.min(1, Math.max(0, Number(input.value) / max))
        if (axis === 'x') thumb.style.left = `${pct * 100}%`
        else thumb.style.bottom = `${pct * 100}%`
      }
      input.addEventListener('input', sync)
      sync()
      return sync
    }
    function buildVideoControls(video) {
      const wrap = document.createElement('div')
      wrap.className = 'ql-video-wrap'
      const bar = document.createElement('div')
      bar.className = 'ql-vctrl'

      const seekWrap = Object.assign(document.createElement('div'), { className: 'ql-range ql-seek-wrap' })
      const seek = Object.assign(document.createElement('input'), { type: 'range', className: 'ql-seek', min: '0', max: '1000', value: '0' })
      const seekTrack = Object.assign(document.createElement('div'), { className: 'ql-range-track' })
      const seekThumb = Object.assign(document.createElement('div'), { className: 'ql-range-thumb' })
      seekWrap.append(seekTrack, seek, seekThumb)
      let seeking = false

      const playBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ql-vbtn' })
      const backBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ql-vbtn' })
      backBtn.setAttribute('aria-label', 'Back 10 seconds')
      backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2-4.9"/><path d="M5 5v3.2h3.2"/><text x="12.2" y="15.3" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">10</text></svg>'
      const fwdBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ql-vbtn' })
      fwdBtn.setAttribute('aria-label', 'Forward 10 seconds')
      fwdBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2-4.9"/><path d="M19 5v3.2h-3.2"/><text x="11.8" y="15.3" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">10</text></svg>'
      const time = Object.assign(document.createElement('span'), { className: 'ql-vtime' })
      // Mute button + a vertical slider that only appears while hovering/focusing this little group — the
      // same shape as YouTube's volume control.
      const volGroup = Object.assign(document.createElement('div'), { className: 'ql-vvol-group' })
      const muteBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'ql-vbtn' })
      const volBox = Object.assign(document.createElement('div'), { className: 'ql-vvol-box' })
      const volTrack = Object.assign(document.createElement('div'), { className: 'ql-range-track' })
      const volThumb = Object.assign(document.createElement('div'), { className: 'ql-range-thumb' })
      const volSlider = Object.assign(document.createElement('input'), { type: 'range', className: 'ql-vvol', min: '0', max: '100', value: '100', 'aria-label': 'Volume' })
      volBox.append(volTrack, volThumb)
      const volPop = Object.assign(document.createElement('div'), { className: 'ql-vvol-pop' })
      volPop.append(volBox, volSlider)
      volGroup.append(muteBtn, volPop)
      // Back / play / forward / time / volume all grouped together inside one pill, centered in the row.
      const pill = Object.assign(document.createElement('div'), { className: 'ql-vpill' })
      pill.append(backBtn, playBtn, fwdBtn, time, volGroup)
      const row = Object.assign(document.createElement('div'), { className: 'ql-vrow' })
      row.append(pill)
      bar.append(seekWrap, row)
      wrap.append(video, bar)

      const syncSeekThumb = wireRangeThumb(seek, seekTrack, seekThumb, 'x')
      const syncVolThumb = wireRangeThumb(volSlider, volTrack, volThumb, 'y')

      const syncPlay = () => {
        playBtn.innerHTML = video.paused ? VIDEO_PLAY_ICON : VIDEO_PAUSE_ICON
        playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause')
        wrap.classList.toggle('is-paused', video.paused)
      }
      const syncMute = () => {
        muteBtn.innerHTML = (video.muted || video.volume === 0) ? VIDEO_MUTE_ICON : VIDEO_UNMUTE_ICON
        volSlider.value = String(video.muted ? 0 : Math.round(video.volume * 100))
        syncVolThumb()
      }
      const syncTime = () => {
        if (!seeking && video.duration) seek.value = String(Math.round((video.currentTime / video.duration) * 1000))
        syncSeekThumb()
        time.textContent = `${formatClock(video.currentTime)} / ${formatClock(video.duration)}`
      }
      video.addEventListener('play', syncPlay)
      video.addEventListener('pause', syncPlay)
      video.addEventListener('volumechange', syncMute)
      video.addEventListener('timeupdate', syncTime)
      video.addEventListener('loadedmetadata', syncTime)
      video.addEventListener('click', () => { if (video.paused) void video.play(); else video.pause() })
      playBtn.addEventListener('click', () => { if (video.paused) void video.play(); else video.pause() })
      backBtn.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10) })
      fwdBtn.addEventListener('click', () => { video.currentTime = Math.min(video.duration || video.currentTime + 10, video.currentTime + 10) })
      muteBtn.addEventListener('click', () => { video.muted = !video.muted })
      volSlider.addEventListener('input', () => {
        video.volume = Number(volSlider.value) / 100
        video.muted = video.volume === 0
      })
      seek.addEventListener('pointerdown', () => { seeking = true })
      seek.addEventListener('input', () => {
        if (video.duration) time.textContent = `${formatClock((Number(seek.value) / 1000) * video.duration)} / ${formatClock(video.duration)}`
      })
      seek.addEventListener('change', () => {
        if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration
        seeking = false
      })
      syncPlay()
      syncMute()
      return wrap
    }

    async function showPreview() {
      qlCleanup()
      const entry = qlList[qlIndex]
      if (!entry) return
      const kind = fileKind(entry)
      qlName.textContent = entry.name
      qlIcon.innerHTML = typeIcon(kind)
      qlCount.textContent = qlList.length > 1 ? `${qlIndex + 1} of ${qlList.length}` : ''
      // No overlay nav arrows over a PDF (the page strip and scrolling are the way to move around inside
      // it); Left/Right on the keyboard still steps between files. Over a video they sit at the bottom
      // corners, the same place as over an image — both are hover-revealed, same as the video controls
      // underneath them, rather than permanently fighting for the same strip of space.
      qlStage.classList.toggle('kind-video', kind === 'video')
      // Reserve the page-strip's width up front for a PDF, rather than only revealing it once the page
      // count has actually loaded (which happens after the PDF itself is already on screen) — that gap is
      // what read as the preview opening at full width and then "rescaling" smaller a moment later.
      // buildPageStrip hides it again on the rare one-page PDF.
      if (kind === 'pdf') qlPages.hidden = false
      qlNavPrev.hidden = qlNavNext.hidden = kind === 'pdf'
      qlNavPrev.disabled = qlIndex <= 0
      qlNavNext.disabled = qlIndex >= qlList.length - 1
      const abort = new AbortController()
      qlAbort = abort
      const progress = document.createElement('div')
      progress.className = 'ql-progress'
      const holder = document.createElement('div')
      holder.className = 'ql-holder'
      qlStage.append(holder)
      qlHolder = holder
      qlHolderObserver.observe(holder)
      // A quick look first: Google's own preview of the file, while the real thing loads.
      let quick = null
      if (entry.thumbnailLink) {
        quick = new Image()
        quick.className = 'ql-media'
        quick.alt = ''
        quick.referrerPolicy = 'no-referrer'
        quick.src = thumbUrl(entry.thumbnailLink, 1600)
        holder.append(quick)
      } else holder.append(Object.assign(document.createElement('div'), { className: 'ql-bigicon', innerHTML: typeIcon(kind) }))
      const limit = MEDIA_LIMIT[kind]
      const size = Number(entry.size) || 0
      if (!limit || (size && size > limit) || isNativeGoogle(entry) && kind !== 'pdf') {
        qlStage.append(Object.assign(qlMessage(limit ? 'This file is too large to preview here.' : 'No preview for this kind of file.', entry)))
        return
      }
      qlStage.append(progress)
      try {
        const cachedBlob = qlBlobCache.get(entry.id)
        const blob = cachedBlob || await fetchMedia(entry, { signal: abort.signal, onProgress: (ratio) => { progress.textContent = ratio ? `Loading ${Math.round(ratio * 100)}%` : 'Loading…' } })
        if (abort.signal.aborted) return
        if (!cachedBlob) qlCacheBlob(entry.id, blob)
        // A PDF page is rendered to a canvas (renderPdfPage) rather than shown in an <iframe> with the
        // browser's built-in viewer — see the comment on renderPdfPage for why. That also means the page
        // count comes straight from pdf.js itself (qlPdfJsDoc.numPages), which is always accurate, instead
        // of a quick regex scan of the raw bytes that could come up empty on an unusual single-page PDF
        // and leave the whole preview looking broken.
        if (kind === 'pdf') {
          progress.remove()
          qlPdfBytes = await blob.arrayBuffer()
          qlPage = 1
          const token = ++qlPdfRenderToken
          let canvas = null
          try { canvas = await renderPdfPage(1) } catch (error) { console.warn(LOG, 'pdf.js could not render this PDF', error) }
          if (abort.signal.aborted || token !== qlPdfRenderToken) return
          if (!canvas) {
            qlStage.append(qlMessage('Couldn’t preview this PDF.', entry))
            return
          }
          canvas.setAttribute('aria-label', entry.name)
          canvas.classList.add('is-loading')
          holder.append(canvas)
          qlMedia = canvas
          captureMediaFit()
          qlZoom = 1
          qlZoomBar.hidden = false
          applyZoom()
          requestAnimationFrame(() => { canvas.classList.remove('is-loading'); if (quick) quick.remove() })
          const pageCount = (qlPdfJsDoc && qlPdfJsDoc.numPages) || 1
          if (!abort.signal.aborted) {
            buildPageStrip(pageCount)
            qlCount.textContent = pageCount > 1
              ? (qlList.length > 1 ? `${qlIndex + 1} of ${qlList.length} · Page 1 of ${pageCount}` : `Page 1 of ${pageCount}`)
              : (qlList.length > 1 ? `${qlIndex + 1} of ${qlList.length}` : '')
          }
          return
        }
        qlUrl = URL.createObjectURL(blob)
        progress.remove()
        let media
        if (kind === 'image') { media = new Image(); media.alt = entry.name; media.className = 'ql-media' }
        else if (kind === 'video') { media = document.createElement('video'); media.className = 'ql-media'; media.autoplay = true; media.playsInline = true }
        else { media = document.createElement('audio'); media.controls = true; media.autoplay = true }
        if (kind === 'video' || kind === 'audio') {
          // Resume where playback left off last time this file was opened, instead of always starting
          // over from 0 — qlPlaybackPos is keyed by file id and survives across stepping to other files.
          media.addEventListener('loadedmetadata', () => {
            const pos = qlPlaybackPos.get(entry.id)
            if (pos && Number.isFinite(media.duration) && pos < media.duration - 0.5) media.currentTime = pos
          }, { once: true })
          media.addEventListener('timeupdate', () => { qlPlaybackPos.set(entry.id, media.currentTime) })
          media.addEventListener('ended', () => { qlPlaybackPos.delete(entry.id) })
        }
        media.classList.add('is-loading')
        media.src = qlUrl
        if (kind === 'video') holder.append(buildVideoControls(media))
        else holder.append(media)
        const reveal = () => { media.classList.remove('is-loading'); if (quick) quick.remove() }
        if (kind === 'image') { await new Promise((resolve) => { media.onload = resolve; media.onerror = resolve }); if (abort.signal.aborted) return; reveal() }
        else reveal()
        qlMedia = media
        captureMediaFit()
        qlZoom = 1
        qlZoomBar.hidden = kind !== 'image'
        applyZoom()
      } catch (error) {
        if (abort.signal.aborted) return
        progress.remove()
        console.warn(LOG, 'Preview failed', error)
        qlStage.append(qlMessage(actionFailMessage(error, 'preview'), entry))
      }
    }

    function openPreview(entry) {
      qlList = pickerItems.filter((item) => item.kind === 'file')
      qlIndex = qlList.findIndex((item) => item.id === entry.id)
      if (qlIndex < 0) return
      closeMenu()
      clearTimeout(qlHideTimer)
      const from = contentHeight()
      previewOpen = true
      animateResize(from, contentHeight()) // eases the window open instead of snapping straight to 600px
      qlEl.hidden = false
      void qlEl.offsetWidth
      qlEl.classList.add('is-open')
      void showPreview()
    }
    function closePreview() {
      if (!previewOpen) return
      const from = contentHeight()
      previewOpen = false
      qlEl.classList.remove('is-open')
      qlCleanup()
      qlHideTimer = setTimeout(() => { if (!previewOpen) { qlEl.hidden = true; animateResize(from, contentHeight()) } }, 200)
      const el = qlList[qlIndex] && elById.get(qlList[qlIndex].id)
      if (el) el.focus({ preventScroll: true })
    }
    function stepPreview(delta) {
      const next = qlIndex + delta
      if (next < 0 || next >= qlList.length) return
      qlIndex = next
      selectOnly(qlList[qlIndex].id)
      void showPreview()
    }
    document.getElementById('ql-close').addEventListener('click', closePreview)
    qlNavPrev.addEventListener('click', () => stepPreview(-1))
    qlNavNext.addEventListener('click', () => stepPreview(1))
    document.getElementById('ql-open').addEventListener('click', () => { const entry = qlList[qlIndex]; if (entry) post({ type: 'open-url', url: driveUrl(entry) }) })
    document.getElementById('ql-download').addEventListener('click', () => { const entry = qlList[qlIndex]; if (entry) void downloadEntries([entry]) })
    window.addEventListener('keydown', (event) => {
      if (!previewOpen || modalResolve) return
      // Space used to always close the preview, the same as Escape — including while a video was open,
      // where every video player trains people to expect Space to pause/resume instead. It's handled
      // directly here (play()/pause() on the actual element) rather than left to the browser's own
      // keyboard shortcut for a focused <video>, which doesn't reliably fire in every host environment
      // this runs in, and wouldn't fire at all when focus never lands on the video itself.
      const onControl = event.target && /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)
      if (event.key === ' ') {
        if (onControl) return // let a focused button/slider/etc handle its own Space as usual
        event.preventDefault(); event.stopImmediatePropagation()
        if (qlMedia && qlMedia.tagName === 'VIDEO') { if (qlMedia.paused) qlMedia.play(); else qlMedia.pause(); return }
        closePreview()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); closePreview()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (event.target && /^(VIDEO|AUDIO)$/.test(event.target.tagName)) return
        event.preventDefault(); event.stopImmediatePropagation(); stepPreview(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }, true)

