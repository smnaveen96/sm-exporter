    // ===================== Google Drive upload =====================
    // OAuth 2.0 authorization-code flow (with PKCE when WebCrypto is available), run
    // entirely by the plugin. The OAuth client and the tokens are kept in
    // figma.clientStorage on this machine — nothing is embedded in the source.
    const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
    const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
    const DRIVE_API = 'https://www.googleapis.com/drive/v3'
    const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
    const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
    const DEFAULT_REDIRECT_URI = DEFAULT_GOOGLE_REDIRECT_URI
    const STORAGE_CLIENT_KEY = 'tier2-google-oauth-client'
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

    // The pointer is matched against the element actually under it (not just a button's box), because
    // a disabled button has pointer-events:none (so the hit lands on its parent pill — still a match),
    // while the export/upload row itself can be geometrically "behind" an open Drive drawer or the Quick
    // Look preview even though its box technically overlaps that area (it's collapsed to 0 height, or
    // covered by a fixed-position overlay). Going by paint order rather than raw box math keeps the
    // tooltip from firing over content that only happens to share the same coordinates.
    function targetAt(event) {
      // The "contains" check below is DOM structure, not paint order — when the Drive drawer is open it
      // visually covers the Export/upload row underneath, but since that row still lives inside the same
      // wrapper the drawer sits in, the hit element can structurally "contain" driveSubmit/exportButton
      // even while they're hidden behind the drawer, firing their tooltip ("Select frames first") right
      // on top of the drawer's own controls. Nothing in the drawer should trigger those tooltips at all.
      if (driveDrawer.classList.contains('is-open')) return null
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      if (!hit) return null
      return tipTargets.find((target) => target === hit || target.contains(hit) || hit.contains(target)) || null
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
    const drawerSettings = document.getElementById('drawer-settings')
    const drawerAuth = document.getElementById('drawer-auth')
    const clientIdInput = document.getElementById('client-id')
    const clientSecretInput = document.getElementById('client-secret')
    const disconnectButton = document.getElementById('disconnect-button')
    const accountCard = document.getElementById('account-card')
    const accountKicker = document.getElementById('account-kicker')
    const accountEmail = document.getElementById('account-email')
    const connectBlock = document.getElementById('connect-block')
    const connectButton = document.getElementById('connect-google')
    const connectHint = document.getElementById('connect-hint')
    const authLink = document.getElementById('auth-link')
    const authCodeInput = document.getElementById('auth-code')
    const authContinue = document.getElementById('auth-continue')
    const authCancel = document.getElementById('auth-cancel')
    const authEditClient = document.getElementById('auth-edit-client')
    const authError = document.getElementById('auth-error')
    const settingsMsg = document.getElementById('settings-msg')
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
    const clientSaveButton = document.getElementById('client-save')
    const clientDeleteButton = document.getElementById('client-delete')
    const modalEl = document.getElementById('modal')
    const modalTitle = document.getElementById('modal-title')
    const modalText = document.getElementById('modal-text')
    const modalOk = document.getElementById('modal-ok')
    const modalCancel = document.getElementById('modal-cancel')
    const TRANSITION_MS = 320 // keep in step with --dur in the CSS
    const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v6M14 11v6"/></svg>'
    const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

    let drawerMode = null            // null | 'settings' | 'auth'
    let oauthClient = null           // { clientId, clientSecret, redirectUri }
    let tokens = null                // { accessToken, refreshToken, expiresAt, account }
    let accounts = []                // tokens of every connected Google account; `tokens` is the active one
    let pendingAuth = null           // { state, timer, resolve, reject } while waiting for the pasted code
    let checkingClient = false       // true while the Client ID / secret is being checked with Google
    let autosaveTimer = 0, autosaveRun = 0, settingsMsgTimer = 0
    const AUTH_TIMEOUT_MS = 10 * 60 * 1000
    let pendingExport = null         // { resolve, reject } while waiting for the sandbox's export-ready
    let uploadedKey = ''             // fingerprint of what the tick on the cloud button stands for
    let selectedIds = []             // ids of the selected frames, as last reported by the plugin
    let uploadRun = null             // { cancelled, controller, uploaded, total } while an upload to Drive runs
    let downloadRun = null           // { cancelled, controller } while a download (or multi-download zip) is in flight
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

    // The bottom drawer holds only the folder picker. The client settings and the paste-the-redirect step of
    // signing in open inside the account panel at the top.
    function setPickingState(on) {
      document.body.classList.toggle('is-picking', on) // folds the export options away while a folder is chosen
      driveDrawer.classList.toggle('is-open', on)
    }

    function showDrawer(mode) {
      const wasInMenu = drawerMode === 'settings' || drawerMode === 'auth'
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
      if (mode === 'settings' || mode === 'auth') openAccountMenu(mode)
      else if (wasInMenu) closeAccountMenu()
      syncHeight()
    }

    // The client baked into this file (see TEAM SETUP at the top), if any.
    function builtInClient() {
      const clientId = DEFAULT_GOOGLE_CLIENT_ID.trim()
      if (!clientId) return null
      return { clientId, clientSecret: DEFAULT_GOOGLE_CLIENT_SECRET.trim(), redirectUri: DEFAULT_GOOGLE_REDIRECT_URI.trim() || 'http://127.0.0.1:53682/', builtIn: true }
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

    // The bottom of the settings panel: who is connected, or the way to connect.
    function refreshAccountLabel() {
      renderAccountSwitcher()
      updateClientButtons()
      const connected = Boolean(tokens)
      accountCard.hidden = !connected
      connectBlock.hidden = connected
      if (connected) {
        accountKicker.textContent = tokens.account ? 'Connected as' : 'Connected to'
        accountEmail.textContent = tokens.account || 'Google Drive'
      } else {
        connectButton.disabled = !oauthClient || checkingClient
        connectHint.textContent = oauthClient
          ? 'Opens Google in your browser. Allow access, then copy the URL and paste it here.'
          : 'Add your Client ID and secret above first.'
      }
      syncHeight()
    }

    // Inline messages: shown next to the fields they are about, not only in the status line.
    function revealMessage(element) {
      if (!element.hidden && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
      syncHeight()
    }

    function setSettingsMessage(state, text, invalidInputs) {
      clearTimeout(settingsMsgTimer)
      settingsMsg.hidden = !text
      settingsMsg.textContent = text || ''
      settingsMsg.classList.remove('is-error', 'is-busy', 'is-ok')
      if (state && text) settingsMsg.classList.add(`is-${state}`)
      for (const input of [clientIdInput, clientSecretInput]) {
        const invalid = Boolean(text) && state === 'error' && (invalidInputs || []).includes(input)
        input.classList.toggle('is-invalid', invalid)
        if (invalid) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid')
      }
      if (state === 'ok' && text) settingsMsgTimer = setTimeout(() => setSettingsMessage('', ''), Math.max(2400, 1500 + text.length * 45))
      if (text) revealMessage(settingsMsg); else syncHeight()
    }

    function setAuthError(text) {
      authError.hidden = !text
      authError.textContent = text || ''
      authCodeInput.classList.toggle('is-invalid', Boolean(text))
      if (text) authCodeInput.setAttribute('aria-invalid', 'true'); else authCodeInput.removeAttribute('aria-invalid')
      if (text) revealMessage(authError); else syncHeight()
    }

    function setAuthBusy(isBusy) {
      authContinue.disabled = isBusy
      authCancel.disabled = isBusy
      authContinue.textContent = isBusy ? 'Connecting…' : 'Continue'
    }

    function fillSettingsFields() {
      clientIdInput.value = oauthClient ? oauthClient.clientId : ''
      clientSecretInput.value = oauthClient ? oauthClient.clientSecret : ''
      setSettingsMessage('', '')
      refreshAccountLabel()
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
      if (busy || !oauthClient) return
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

    const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.apps\.googleusercontent\.com$/i
    const stripQuotes = (value) => String(value || '').trim().replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '')

    // Asks Google whether this Client ID + secret pair exists. A made-up code is sent on purpose:
    // a wrong ID or secret comes back as invalid_client, a right pair as invalid_grant (bad code).
    async function verifyOAuthClient(clientId, clientSecret, redirectUri) {
      try {
        const response = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: 'verify', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
        })
        const data = await response.json().catch(() => ({}))
        if (data.error === 'invalid_client') {
          const description = String(data.error_description || '').toLowerCase()
          if (description.includes('not found') || description.includes('deleted')) return { status: 'bad-id', message: 'Google doesn’t recognise this Client ID. Check it for typos.' }
          return { status: 'bad-secret', message: 'Google rejected the Client ID or secret. Check the secret for typos, and that it belongs to this Client ID.' }
        }
        return { status: 'ok' }
      } catch (error) {
        console.warn(LOG, 'Could not verify the OAuth client', error)
        return { status: 'offline' }
      }
    }

