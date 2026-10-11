    // ===================== Google Drive upload =====================
    const DRIVE_API = 'https://www.googleapis.com/drive/v3'
    const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
    const STORAGE_TOKENS_KEY = 'tier2-google-tokens'   // the active account
    const STORAGE_ACCOUNTS_KEY = 'tier2-google-accounts' // every connected account
    const STORAGE_LAST_FOLDER_KEY = 'tier2-last-drive-folder' // the folder last used, so the plugin reopens there
    const MULTIPART_LIMIT = 5 * 1024 * 1024

    const uploadPill = document.getElementById('upload-pill')
    // ---- Button tooltips -------------------------------------------------------------------------
    // Custom rather than the native title: it appears quickly, goes away on click, and can say WHY a
    // button is off. A greyed-out Export or cloud button explains itself on hover and on click; an
    // enabled Export button needs none (it has a label), an enabled cloud button says what it does.
    // The PDF — Image / PDF (vector) info icons ride the same shared, fixed-position tooltip element —
    // their own small CSS tooltip used to get clipped by #export-panel's .collapse-inner (always
    // overflow:hidden, for the collapse height animation), however it was aimed; a position:fixed tip
    // isn't inside that box at all, so it just renders wherever there's room, flipping above/below by
    // the same rule the Export/upload buttons already use.
    tooltipEl = document.getElementById('tooltip')
    const pdfImageInfo = document.getElementById('pdf-image-info')
    const pdfVectorInfo = document.getElementById('pdf-vector-info')
    const tipTargets = [exportButton, driveSubmit, pdfImageInfo, pdfVectorInfo]
    let tipHoldTimer = 0

    function tooltipTextFor(target) {
      if (target === pdfImageInfo || target === pdfVectorInfo) {
        const tip = target.querySelector('.info-tip')
        return tip ? tip.textContent : ''
      }
      if (busy) return ''
      if (selectedCount === 0) return 'Select frames first'
      if (!anyFormatSelected()) return 'Choose a format first'
      if (target !== driveSubmit) return ''
      if (!driveUrlInput.value.trim()) return 'Choose a Drive folder'
      return uploadPill.classList.contains('is-success') ? 'Uploaded · click to upload again' : 'Upload to Google Drive'
    }

    function showTooltip(target) {
      const text = tooltipTextFor(target)
      if (!text) { hideTooltip(); return }
      tooltipEl.textContent = text
      const box = target.getBoundingClientRect()
      const width = tooltipEl.offsetWidth
      const height = tooltipEl.offsetHeight
      // Cloud button sits at the window's right edge, so its tooltip is right-aligned to it; Export's is centred.
      const wanted = target === driveSubmit ? box.right - width : box.left + (box.width - width) / 2
      const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8))
      const top = box.top - height - 8 >= 8 ? box.top - height - 8 : box.bottom + 8
      tooltipEl.style.left = `${Math.round(left)}px`
      tooltipEl.style.top = `${Math.round(top)}px`
      tooltipEl.classList.add('is-visible')
      tooltipEl.dataset.target = target.id
      target.setAttribute('aria-describedby', 'tooltip')
    }

    function hideTooltip() {
      clearTimeout(tooltipTimer)
      clearTimeout(tipHoldTimer)
      if (!tooltipEl) return
      tooltipEl.classList.remove('is-visible')
      for (const target of tipTargets) target.removeAttribute('aria-describedby')
    }

    // Keeps the tooltip truthful if frames or formats change while it is showing.
    function refreshTooltip() {
      if (!tooltipEl || !tooltipEl.classList.contains('is-visible')) return
      const target = tipTargets.find((candidate) => candidate.id === tooltipEl.dataset.target)
      if (target) showTooltip(target)
    }

    // Match the element actually under the pointer so covered controls don't trigger tooltips. Disabled
    // buttons have pointer-events:none, so allow their direct parent as the hit only within the button's
    // own bounds.
    function targetAt(event) {
      if (driveDrawer.classList.contains('is-open')) return null
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      if (!hit) return null
      return tipTargets.find((target) => {
        if (target === hit || target.contains(hit)) return true
        if (!target.disabled || target.parentElement !== hit) return false
        const box = target.getBoundingClientRect()
        return event.clientX >= box.left && event.clientX <= box.right &&
          event.clientY >= box.top && event.clientY <= box.bottom
      }) || null
    }

    document.addEventListener('pointermove', (event) => {
      const target = targetAt(event)
      if (target === overTarget) return
      overTarget = target
      hideTooltip()
      if (target) tooltipTimer = setTimeout(() => showTooltip(target), 450)
    })
    document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) { overTarget = null; hideTooltip() } })
    document.addEventListener('pointerdown', (event) => {
      const target = targetAt(event)
      hideTooltip()
      // Pressing a greyed-out button answers at once and stays up long enough to read.
      if (target && target.disabled && tooltipTextFor(target)) {
        showTooltip(target)
        tipHoldTimer = setTimeout(hideTooltip, 2000)
      }
    })
    driveSubmit.addEventListener('focus', () => { if (driveSubmit.matches(':focus-visible')) { clearTimeout(tooltipTimer); tooltipTimer = setTimeout(() => showTooltip(driveSubmit), 250) } })
    driveSubmit.addEventListener('blur', hideTooltip)
    window.addEventListener('blur', hideTooltip)
    window.addEventListener('resize', hideTooltip)
    const driveForm = document.getElementById('drive-form')
    const driveUrlInput = document.getElementById('drive-url')
    const driveArea = document.getElementById('drive-area')
    const driveStatus = document.getElementById('drive-status')
    const driveStatusText = document.getElementById('drive-status-text')
    const driveOpenFolder = document.getElementById('drive-open-folder')
    const driveOpenText = document.getElementById('drive-open-text')
    const driveCancel = document.getElementById('drive-cancel')
    const driveDrawer = document.getElementById('drive-drawer')
    const drawerAuth = document.getElementById('drawer-auth')
    const connectBlock = document.getElementById('connect-block')
    const connectButton = document.getElementById('connect-google')
    const authLink = document.getElementById('auth-link')
    const authCancel = document.getElementById('auth-cancel')
    const authError = document.getElementById('auth-error')
    const accountSwitch = document.getElementById('account-switch')
    const accountChip = document.getElementById('account-chip')
    const accountMenu = document.getElementById('account-menu')
    const drawerPicker = document.getElementById('drawer-picker')
    const pickerBack = document.getElementById('picker-back')
    const pickerHome = document.getElementById('picker-home')
    const pickerPath = document.getElementById('picker-path')
    const pickerList = document.getElementById('picker-list')
    const pickerCancel = document.getElementById('picker-cancel')
    const pickerSelect = document.getElementById('picker-select')
    const pickerNew = document.getElementById('picker-new')
    const driveFolderButton = document.getElementById('drive-toggle')
    const modalEl = document.getElementById('modal')
    const modalTitle = document.getElementById('modal-title')
    const modalText = document.getElementById('modal-text')
    const modalOk = document.getElementById('modal-ok')
    const modalCancel = document.getElementById('modal-cancel')
    const TRANSITION_MS = 320 // keep in step with --dur in the CSS
    const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v6M14 11v6"/></svg>'
    const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

    let drawerMode = null            // null | 'auth' | 'picker'
    let tokens = null                // { accessToken, refreshToken, expiresAt, account }
    let accounts = []                // tokens of every connected Google account; `tokens` is the active one
    const AUTH_TIMEOUT_MS = 10 * 60 * 1000
    let pendingExport = null         // { resolve, reject } while waiting for the sandbox's export-ready
    let uploadedKey = ''             // fingerprint of what the tick on the cloud button stands for
    let selectedIds = []             // ids of the selected frames, as last reported by the plugin
    let uploadRun = null             // { cancelled, controller, uploaded, total } while an upload to Drive runs
    let downloadRun = null           // { cancelled, controller } while a download (or multi-download zip) is in flight
    let canvasPlaceRun = null        // { cancelled, controller } while files are fetched for canvas placement
    let statusFadeTimer = 0          // fades quiet status messages away
    let resizeFrame = 0

    class DriveError extends Error {
      constructor(message, userMessage, status) {
        super(message)
        this.userMessage = userMessage
        this.status = status
      }
    }

    // The window is resized with Figma's own (instant) resize call, so it can't be handed a CSS transition
    // directly. Earlier this jumped the window to the taller of the two layouts up front, held it there for
    // the whole motion, then snapped to the exact final size — two sudden jumps bookending an otherwise
    // smooth CSS animation, which read as jerky. Instead the height is driven frame by frame along the same
    // easing the content uses, so the window grows or shrinks in step with the drawer instead of jumping.
    let resizeLocked = false, resizeHoldTimer = 0, pickerHideTimer = 0
    var drawerSettled = Promise.resolve() // resolves when the drawer has finished moving
    var previewOpen = false
    // The preview's own window height was a flat 600 — tight enough that the plugin window's own bottom
    // edge (outside anything this page draws, so there's no overflow or scroll fix for it here) clipped
    // the last few pixels of the preview, visible as the media's rounded bottom corners getting cut off
    // while the top ones showed fine. 640 gives that edge some breathing room.
    function contentHeight() { return Math.max(Math.ceil(driveArea.getBoundingClientRect().bottom + 15), typeof previewOpen !== 'undefined' && previewOpen ? 640 : 0) }
    function syncHeight() {
      if (resizeLocked) return
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (resizeLocked) return
        post({ type: 'resize', height: contentHeight() })
      })
    }
    let settleResolve = null
    // Matches the CSS --ease curve (an expo-out: fast off the mark, long soft landing) so the window's own
    // resize tracks the drawer's visual height instead of racing ahead of or lagging behind it. Kept
    // monotonic (no overshoot) — unlike the little spring-pop used for menus and modals — because
    // overshooting the window's real size would clip the drawer content it's supposed to be following.
    function springEase(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t) }
    function animateResize(from, to) {
      resizeLocked = true
      drawerSettled = new Promise((resolve) => { settleResolve = resolve })
      cancelAnimationFrame(resizeFrame)
      clearTimeout(resizeHoldTimer)
      if (from === to) {
        resizeLocked = false
        if (settleResolve) { settleResolve(); settleResolve = null }
        post({ type: 'resize', height: to })
        return
      }
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / TRANSITION_MS)
        const eased = t >= 1 ? 1 : springEase(t)
        post({ type: 'resize', height: Math.round(from + (to - from) * eased) })
        if (t < 1) {
          resizeFrame = requestAnimationFrame(step)
        } else {
          resizeLocked = false
          if (settleResolve) { settleResolve(); settleResolve = null }
          post({ type: 'resize', height: contentHeight() })
        }
      }
      resizeFrame = requestAnimationFrame(step)
    }
    // Watch every block above the drive area as well: when the thumbnails strip grows or shrinks, the drive area
    // moves without changing its own size, so observing it alone left the window too tall (or too short).
    const heightObserver = new ResizeObserver(syncHeight)
    heightObserver.observe(driveArea)
    for (const el of document.body.children) if (el.tagName !== 'SCRIPT' && el !== driveArea) heightObserver.observe(el)
    window.addEventListener('load', syncHeight)

    // Quiet messages (saved, disconnected) fade away on their own. Errors, progress and any line
    // that carries the folder link (the upload result, a cancel after some files went up) stay until the next action.
    function setDriveStatus(state, text, folderUrl) {
      clearTimeout(statusFadeTimer)
      driveStatus.classList.remove('is-fading')
      // After an upload (or a cancel that left files behind) the line is one link — the text and the icon open the folder together.
      const asLink = (state === 'success' || !state) && Boolean(folderUrl)
      driveOpenFolder.hidden = !asLink
      driveStatusText.hidden = asLink
      if (folderUrl) driveOpenFolder.dataset.url = folderUrl
      driveStatus.classList.remove('is-busy', 'is-success', 'is-error')
      uploadPill.classList.remove('is-busy', 'is-success', 'is-error')
      if (state) {
        driveStatus.classList.add(`is-${state}`)
        void uploadPill.offsetWidth // restart the shake animation on repeated errors
        uploadPill.classList.add(`is-${state}`)
      }
      driveStatusText.textContent = asLink ? '' : text
      driveStatus.classList.toggle('is-empty', !text)
      if (asLink) {
        driveOpenText.textContent = text
        driveOpenFolder.setAttribute('aria-label', `${text}. Open the folder in Google Drive`)
      }
      if (state === 'success') hideTooltip() // the tick has said it all
      driveSubmit.setAttribute('aria-label', state === 'success' ? 'Uploaded to Google Drive. Upload again' : 'Upload to Google Drive')
      if (!state && text && !asLink) {
        statusFadeTimer = setTimeout(() => {
          driveStatus.classList.add('is-fading')
          statusFadeTimer = setTimeout(() => setDriveStatus('', ''), 380)
        }, Math.max(4000, 2500 + text.length * 50))
      }
      syncHeight()
    }

    // A short confirmation in the status line (blue, no tick on the upload button) that fades after `ms`.
    function flashDriveStatus(text, ms) {
      setDriveStatus('', text)
      clearTimeout(statusFadeTimer)
      driveStatus.classList.add('is-success')
      statusFadeTimer = setTimeout(() => {
        driveStatus.classList.add('is-fading')
        statusFadeTimer = setTimeout(() => setDriveStatus('', ''), 380)
      }, ms)
    }

    function failDrive(text) {
      setDriveStatus('error', text)
    }

    // The bottom drawer holds only the folder picker; OAuth status stays in the account menu.
    function setPickingState(on) {
      document.body.classList.toggle('is-picking', on) // folds the export options away while a folder is chosen
      driveDrawer.classList.toggle('is-open', on)
    }

    function showDrawer(mode) {
      const wasInMenu = drawerMode === 'auth'
      const picking = mode === 'picker'
      const wasPicking = document.body.classList.contains('is-picking')
      drawerMode = mode
      driveFolderButton.setAttribute('aria-expanded', String(picking))
      if (picking) {
        drawerPicker.hidden = false
        updatePickerSummary()
        if (!accountMenu.hidden) closeAccountMenu()
      } else {
        // Keep the picker in place while the drawer collapses, then hide it.
        clearTimeout(pickerHideTimer)
        pickerHideTimer = setTimeout(() => { if (drawerMode !== 'picker') drawerPicker.hidden = true }, TRANSITION_MS + 20)
      }
      if (picking !== wasPicking) {
        // Measure the finished layout without painting it, rewind, then play the transition. The window is
        // sized once, up front, to whichever layout is taller, so nothing is clipped and nothing resizes mid-motion.
        const from = contentHeight()
        document.body.classList.add('no-anim')
        setPickingState(picking)
        const to = contentHeight()
        setPickingState(wasPicking)
        void document.body.offsetHeight
        document.body.classList.remove('no-anim')
        setPickingState(picking)
        animateResize(from, to)
      }
      if (mode === 'auth') openAccountMenu(mode)
      else if (wasInMenu) closeAccountMenu()
      syncHeight()
    }

    // The status line stays empty until something happens (progress, success or an error).
    function idleStatusText() {
      return ''
    }

    // The tick on the cloud button means "this exact set is in Drive". It stays until that stops being
    // true — different frames, formats, sizes or file name — and then the button goes back to the cloud.
    // (Editing the link field clears it too, through setDriveStatus.) The "Uploaded to …" link line is a
    // record of what happened, so it stays.
    function uploadSignature() {
      return JSON.stringify([selectedIds, currentSettings(), fileNameInput.value.trim(), tokens && tokens.account])
    }

    function dropStaleTick() {
      if (!uploadPill.classList.contains('is-success') || uploadSignature() === uploadedKey) return
      uploadPill.classList.remove('is-success')
      driveSubmit.setAttribute('aria-label', 'Upload to Google Drive')
      refreshTooltip()
    }
    fileNameInput.addEventListener('input', dropStaleTick)

    // Keep the account menu and its connection action in sync with active account state.
    function refreshAccountLabel() {
      renderAccountSwitcher()
      connectButton.disabled = busy
      connectButton.querySelector('span').textContent = accounts.length ? 'Add account' : 'Connect Google'
      syncHeight()
    }

    // Inline messages: shown next to the fields they are about, not only in the status line.
    function revealMessage(element) {
      if (!element.hidden && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
      syncHeight()
    }

    function setAuthError(text) {
      authError.hidden = !text
      authError.textContent = text || ''
      if (text) revealMessage(authError); else syncHeight()
    }

    function saveTokens() {
      if (tokens) {
        const at = accounts.findIndex((entry) => entry === tokens || (tokens.account && entry.account === tokens.account))
        if (at >= 0) accounts[at] = tokens; else accounts.push(tokens)
      }
      post({ type: 'storage-set', values: { [STORAGE_TOKENS_KEY]: tokens, [STORAGE_ACCOUNTS_KEY]: accounts } })
      refreshAccountLabel()
    }

    driveUrlInput.addEventListener('focus', () => uploadPill.classList.add('is-focused'))
    driveUrlInput.addEventListener('blur', () => uploadPill.classList.remove('is-focused'))
    driveUrlInput.addEventListener('input', () => {
      if (busy) return
      if (driveStatus.classList.contains('is-error') || driveStatus.classList.contains('is-success') || !driveOpenFolder.hidden) setDriveStatus('', idleStatusText())
    })
    driveForm.addEventListener('submit', (event) => {
      event.preventDefault()
      if (!driveUrlInput.value.trim()) { nudgeFolderButton(); return }
      void startDriveUpload()
    })

    function nudgeFolderButton() {
      driveFolderButton.classList.remove('is-nudge')
      void driveFolderButton.offsetWidth
      driveFolderButton.classList.add('is-nudge')
      flashDriveStatus('Paste a folder link, or open Drive folders', 2800)
      setTimeout(() => driveFolderButton.classList.remove('is-nudge'), 700)
    }
