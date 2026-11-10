    // ---- Dragging images onto the Figma canvas ---------------------------------------------------------------
    // The plugin's code side answers a canvas drop with 'drive-drop'; the images are fetched here and sent back.
    async function handleCanvasDrop(message) {
      let payload
      try { payload = JSON.parse(message.data) } catch (error) { console.warn(LOG, 'Canvas drop payload was not valid JSON', error); return }
      const wanted = (payload && payload.smDriveImages) || []
      const images = wanted.map((item) => entryById.get(item.id) || Object.assign({ kind: 'file' }, item))
      console.log(LOG, 'Canvas drop received', { wanted: wanted.length, resolved: images.length })
      if (images.length) await placeOnCanvas(images, { x: message.x, y: message.y })
    }

    // Load the stored OAuth client and tokens from figma.clientStorage via the sandbox.
    post({ type: 'storage-get', keys: [STORAGE_CLIENT_KEY, STORAGE_TOKENS_KEY, STORAGE_ACCOUNTS_KEY, STORAGE_SETTINGS_KEY, STORAGE_LAST_FOLDER_KEY] })

    window.addEventListener('message', (event) => {
      const message = event.data && event.data.pluginMessage
      if (!message) return
      if (message.type === 'selection') {
        selectedCount = message.count
        selectionCount.textContent = selectedCount > 0
          ? `${selectedCount} frame${selectedCount === 1 ? '' : 's'} selected`
          : 'Select frames to export'
        latestSelectionVersion = message.version
        renderThumbnails(message.thumbnails || [], message.ids, message.names, Boolean(message.pending))
        selectedIds = message.ids || []
        updateButton()
        dropStaleTick()
        if (!accountMenu.hidden && accountMenu.dataset.view === 'list') closeAccountMenu()
      } else if (message.type === 'thumbnail') {
        if (message.version === latestSelectionVersion) applyThumbnail(message.id, message.bytes)
      } else if (message.type === 'progress') {
        exportPhase(`Rendering ${message.current} of ${message.total}…`)
      } else if (message.type === 'export-cancelled') {
        if (activeDestination === 'download' && exportRun) finishCancelledExport() // the main thread stopped rendering on request
      } else if (message.type === 'export-ready') {
        if (activeDestination === 'drive') {
          const waiting = pendingExport
          pendingExport = null
          if (waiting) {
            if (uploadRun && uploadRun.cancelled) waiting.reject(uploadCancelledError()) // cancelled during the render: skip building the files
            else generateFiles(message).then(waiting.resolve, waiting.reject)
          }
          return
        }
        if (exportRun && exportRun.cancelled) { finishCancelledExport(); return } // cancel landed after the last frame was already rendered
        exportPhase('Preparing files…')
        finishExport(message).catch((error) => {
          if (error && error.cancelled) { finishCancelledExport(); return }
          console.error(LOG, 'Export failed', error)
          exportRun = null
          busy = false
          setButtonState('error', 'TRY AGAIN')
          setExportStatus('', '')
          updateButton()
        })
      } else if (message.type === 'error') {
        if (activeDestination === 'drive') {
          const waiting = pendingExport
          pendingExport = null
          if (waiting) waiting.reject(new DriveError(message.message, message.message === 'Select frames to export.' ? 'Select frames to upload.' : 'Export failed — please try again.'))
          return
        }
        exportRun = null
        busy = false
        setButtonState('error', message.message === 'Select frames to export.' ? 'SELECT FRAMES' : 'TRY AGAIN')
        setExportStatus('', '')
        updateButton()
      } else if (message.type === 'drive-drop') {
        void handleCanvasDrop(message)
      } else if (message.type === 'storage') {
        const values = message.values || {}
        oauthClient = values[STORAGE_CLIENT_KEY] || builtInClient()
        accounts = Array.isArray(values[STORAGE_ACCOUNTS_KEY]) ? values[STORAGE_ACCOUNTS_KEY] : []
        tokens = values[STORAGE_TOKENS_KEY] || null
        if (tokens) { // the active account is one of the list (an older single-account save is added to it)
          // Matched by email, or — for an account whose email never loaded — by its tokens, so such an
          // account isn't pushed again as a new "Google Drive" row on every launch.
          const same = accounts.find((entry) => (tokens.account && entry.account === tokens.account)
            || (tokens.refreshToken && entry.refreshToken === tokens.refreshToken)
            || (!tokens.account && !tokens.refreshToken && entry.accessToken === tokens.accessToken))
          if (same) tokens = same; else accounts.push(tokens)
        }
        if (!settingsLoaded) applySettings(values[STORAGE_SETTINGS_KEY])
        const savedFolder = values[STORAGE_LAST_FOLDER_KEY]
        // Remembering the last folder is for the "Drive folders" picker drawer to reopen where you left
        // off (lastFolderApplied, above) — it should NOT also silently paste that folder's link into the
        // URL box, which looked like the box was remembering whatever link was last pasted into it.
        if (savedFolder && savedFolder.id) lastFolder = savedFolder
        fillSettingsFields()
        if (!busy) setDriveStatus('', idleStatusText())
        if (oauthClient && accounts.length) void loadProfilePhotos()
        console.log(LOG, 'Settings loaded', oauthClient ? 'client configured' : 'no client', tokens ? 'signed in' : 'not signed in')
        resolveStorageReady()
      }
    })
  