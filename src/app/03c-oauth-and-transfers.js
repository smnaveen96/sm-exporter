    // ---- Connect Google through the OAuth Worker ------------------------------------------------
    async function connectGoogleAccount() {
      if (busy) return
      busy = true
      updateButton()
      refreshAccountLabel()
      let connected = false
      try {
        await interactiveSignIn()
        connected = true
        setDriveStatus('', '')
      } catch (error) {
        if (error && error.cancelled) {
          setDriveStatus('', error.userMessage || '')
        } else {
          console.error(LOG, 'Google sign-in failed', error)
          showDrawer(null)
          failDrive(friendlyDriveMessage(error))
        }
      } finally {
        busy = false
        updateButton()
        refreshAccountLabel()
        if (connected && tokens) {
          showDrawer(null)
          flashDriveStatus(tokens.account ? `Connected as ${tokens.account}` : 'Connected to Google Drive', 3500)
        }
      }
    }

    connectButton.addEventListener('click', () => { void connectGoogleAccount() })
    authCancel.addEventListener('click', () => cancelSignIn())

    let oauthCancelRequested = false
    let oauthRequestController = null
    function cancelSignIn() {
      oauthCancelRequested = true
      if (oauthRequestController) oauthRequestController.abort()
      setAuthError('')
      drawerMode = null
      openAccountMenu('list')
    }

    driveOpenFolder.addEventListener('click', (event) => {
      event.preventDefault()
      if (driveOpenFolder.dataset.url) post({ type: 'open-url', url: driveOpenFolder.dataset.url })
    })
    authLink.addEventListener('click', (event) => {
      event.preventDefault()
      if (authLink.dataset.url) post({ type: 'open-url', url: authLink.dataset.url })
    })

    function parseDriveFolderId(rawValue) {
      const value = String(rawValue || '').trim()
      if (!value) return null
      let match = value.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
      if (match) return match[1]
      match = value.match(/[?&#]id=([A-Za-z0-9_-]{10,})/)
      if (match) return match[1]
      if (/^[A-Za-z0-9_-]{19,}$/.test(value)) return value
      return null
    }

    async function workerRequest(path, options = {}) {
      const response = await fetch(`${OAUTH_WORKER_URL}${path}`, options)
      let data
      try {
        data = await response.json()
      } catch {
        throw new DriveError('OAuth service returned an invalid response', 'Could not connect to Google. Please try again.', response.status)
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new DriveError('OAuth service returned an invalid response', 'Could not connect to Google. Please try again.', response.status)
      }
      if (!response.ok) {
        const detail = data.message || data.error || `OAuth service error (${response.status})`
        const error = new DriveError(detail, data.message || 'Could not connect to Google. Please try again.', response.status)
        error.oauthError = data.error || ''
        throw error
      }
      return data
    }

    async function interactiveSignIn() {
      oauthCancelRequested = false
      setAuthError('')
      showDrawer('auth')
      setDriveStatus('busy', 'Starting secure Google sign-in…')
      let transaction
      let data
      try {
        oauthRequestController = new AbortController()
        try {
          transaction = await workerRequest('/oauth/init', { method: 'POST', signal: oauthRequestController.signal })
        } catch (error) {
          if (oauthCancelRequested) {
            const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
            cancelled.cancelled = true
            throw cancelled
          }
          throw error
        } finally {
          oauthRequestController = null
        }
        if (oauthCancelRequested) {
          const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
          cancelled.cancelled = true
          throw cancelled
        }
        if (!transaction.writeKey || !transaction.readKey || !transaction.startUrl) {
          throw new DriveError('OAuth service returned an incomplete session', 'Could not start Google sign-in. Please try again.')
        }
        const startUrl = new URL(transaction.startUrl)
        if (startUrl.protocol !== 'https:') {
          throw new DriveError('OAuth service returned an insecure sign-in URL', 'Could not start Google sign-in. Please try again.')
        }
        authLink.dataset.url = startUrl.href
        authLink.href = startUrl.href
        post({ type: 'open-url', url: startUrl.href })
        setDriveStatus('busy', 'Waiting for Google sign-in…')
        const deadline = Date.now() + AUTH_TIMEOUT_MS
        while (Date.now() < deadline) {
          if (oauthCancelRequested) {
            const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
            cancelled.cancelled = true
            throw cancelled
          }
          await new Promise((resolve) => setTimeout(resolve, 1800))
          if (oauthCancelRequested) {
            const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
            cancelled.cancelled = true
            throw cancelled
          }
          oauthRequestController = new AbortController()
          try {
            data = await workerRequest(`/oauth/poll?read=${encodeURIComponent(transaction.readKey)}`, { signal: oauthRequestController.signal })
          } catch (error) {
            if (oauthCancelRequested) {
              const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
              cancelled.cancelled = true
              throw cancelled
            }
            throw error
          } finally {
            oauthRequestController = null
          }
          if (data.status === 'complete') break
          if (data.status === 'cancelled' || data.status === 'canceled') {
            const cancelled = new DriveError('Google sign-in was cancelled', 'Google sign-in was cancelled.')
            cancelled.cancelled = true
            throw cancelled
          }
          if (data.status === 'denied') {
            throw new DriveError(data.message || 'Google access was denied', data.message || 'Google access was denied. Please try again.')
          }
          if (data.status === 'failed' || data.status === 'expired') {
            throw new DriveError(data.message || 'Google sign-in expired', data.message || 'Google sign-in expired. Please try again.')
          }
          if (data.status === 'error') {
            throw new DriveError(data.message || 'Google sign-in failed', data.message || 'Google sign-in failed. Please try again.')
          }
          if (!data.status) {
            throw new DriveError(`Unexpected OAuth status: ${data.status || 'missing'}`, 'Google sign-in returned an unexpected response. Please try again.')
          }
          data = null
        }
        if (!data || data.status !== 'complete') {
          throw new DriveError('Google sign-in timed out', 'Google sign-in timed out. Please try again.')
        }
        if (!data.access_token) {
          throw new DriveError('OAuth response did not contain an access token', 'Google sign-in did not return an access token. Please try again.')
        }
      } catch (error) {
        if (oauthCancelRequested && !(error && error.cancelled)) {
          const cancelled = new DriveError('Sign-in cancelled', 'Sign-in cancelled.')
          cancelled.cancelled = true
          throw cancelled
        }
        if (error && !error.cancelled) setAuthError(friendlyDriveMessage(error))
        throw error
      }
      showDrawer(null)
      setDriveStatus('busy', 'Connecting to Google Drive…')
      tokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        account: null,
      }
      try {
        const about = await fetch(`${DRIVE_API}/about?fields=user(emailAddress,photoLink)`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
        if (about.ok) {
          const user = (await about.json()).user || {}
          tokens.account = user.emailAddress || null
          tokens.photo = user.photoLink || null
        }
      } catch (error) {
        console.warn(LOG, 'Could not read the connected account', error)
      }
      const prior = accounts.find((entry) => entry !== tokens && tokens.account && entry.account === tokens.account)
      if (prior) { // same account signing in again: replace its entry
        if (!tokens.refreshToken) tokens.refreshToken = prior.refreshToken
        accounts = accounts.filter((entry) => entry !== prior)
      }
      saveTokens()
      console.log(LOG, 'Connected to Google Drive through OAuth Worker', tokens.account || '')
    }

    async function refreshAccessToken() {
      if (!tokens || !tokens.refreshToken) throw new DriveError('No refresh token', 'Please reconnect Google Drive.')
      const data = await workerRequest('/oauth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      })
      if (!data.access_token) throw new DriveError('OAuth refresh response did not contain an access token', 'Google Drive needs to reconnect. Please try again.')
      Object.assign(tokens, {
        accessToken: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      })
      saveTokens()
      console.log(LOG, 'Access token refreshed through OAuth Worker')
    }

    async function ensureAccessToken(forceRefresh) {
      if (tokens && tokens.accessToken && !forceRefresh && Date.now() < tokens.expiresAt - 60000) return tokens.accessToken
      if (tokens && tokens.refreshToken) {
        try {
          await refreshAccessToken()
          return tokens.accessToken
        } catch (error) {
          console.warn(LOG, 'Token refresh failed, signing in again', error)
          if (error instanceof DriveError && error.status && error.status < 500) {
            accounts = accounts.filter((entry) => entry !== tokens)
            tokens = null
            saveTokens()
          } else {
            throw error
          }
        }
      }
      await interactiveSignIn()
      return tokens.accessToken
    }

    async function driveFetch(url, init, allowRetry = true) {
      const token = await ensureAccessToken()
      const options = Object.assign({}, init || {})
      options.headers = Object.assign({}, options.headers || {}, { Authorization: `Bearer ${token}` })
      if (uploadRun && !options.signal) options.signal = uploadRun.controller.signal
      const response = await fetch(url, options)
      if (response.status === 401 && allowRetry && tokens && tokens.refreshToken) {
        console.warn(LOG, 'Drive returned 401, refreshing token and retrying once')
        await ensureAccessToken(true)
        return driveFetch(url, init, false)
      }
      return response
    }

    async function driveError(response, action) {
      let detail = ''
      try { detail = JSON.stringify((await response.json()).error || {}) } catch { /* no JSON body */ }
      const message = `Google Drive ${action} failed (${response.status}) ${detail}`
      if (response.status === 404) return new DriveError(message, 'Folder not found — check the link and that you have access to it.', 404)
      if (response.status === 401 || response.status === 403) return new DriveError(message, 'You don’t have permission to add files to this folder.', response.status)
      return new DriveError(message, 'Upload failed — please check the Drive link and permissions.', response.status)
    }

    async function verifyFolder(folderId) {
      const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,capabilities/canAddChildren&supportsAllDrives=true`)
      if (!response.ok) throw await driveError(response, 'folder lookup')
      const folder = await response.json()
      if (folder.mimeType !== 'application/vnd.google-apps.folder') {
        throw new DriveError(`Target ${folderId} is ${folder.mimeType}, not a folder`, 'That link points to a file, not a folder.')
      }
      if (folder.capabilities && folder.capabilities.canAddChildren === false) {
        throw new DriveError(`No canAddChildren on ${folderId}`, 'You don’t have permission to add files to this folder.', 403)
      }
      return folder
    }

    // Files already in the folder, newest first per name, so re-uploads replace instead of duplicating.
    async function listFolderFiles(folderId) {
      const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
      const response = await driveFetch(`${DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=1000&orderBy=modifiedTime%20desc&supportsAllDrives=true&includeItemsFromAllDrives=true`)
      if (!response.ok) throw await driveError(response, 'folder listing')
      // Keyed case-insensitively: "test.pdf" replaces "Test.pdf" (and keeps that spelling).
      const byName = new Map()
      for (const entry of ((await response.json()).files || [])) {
        const key = entry.name.toLowerCase()
        if (!byName.has(key)) byName.set(key, [])
        byName.get(key).push({ id: entry.id, name: entry.name })
      }
      return byName
    }

    async function trashFile(fileId) {
      const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ trashed: true }),
      })
      if (!response.ok) console.warn(LOG, `Could not move duplicate ${fileId} to the bin (${response.status})`)
    }

    // Creates the file in the folder, or — when existingId is given — overwrites that file
    // in place so its ID, links and version history are kept.
    async function uploadFile(file, folderId, existing) {
      const existingId = existing ? existing.id : null
      const metadata = JSON.stringify(existingId
        ? { name: existing.name, mimeType: file.mime } // keep the spelling already in Drive
        : { name: file.name, parents: [folderId], mimeType: file.mime })
      const method = existingId ? 'PATCH' : 'POST'
      const target = existingId ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingId)}` : DRIVE_UPLOAD_API
      const start = await driveFetch(`${target}?uploadType=resumable&supportsAllDrives=true`, {
        method,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': file.mime,
          'X-Upload-Content-Length': String(file.bytes.length),
        },
        body: metadata,
      })
      if (!start.ok) throw await driveError(start, 'upload start')
      const sessionUrl = start.headers.get('Location')
      if (sessionUrl) {
        console.log(LOG, `${existingId ? 'Replacing' : 'Uploading'} ${file.name} (${file.bytes.length} bytes)`)
        const put = await fetch(sessionUrl, { method: 'PUT', headers: { 'Content-Type': file.mime }, body: file.bytes, signal: uploadRun ? uploadRun.controller.signal : undefined })
        if (!put.ok) throw await driveError(put, 'upload')
        return put.json()
      }
      // The session URL header was not exposed to this iframe; fall back to a single
      // multipart request, which Drive caps at 5 MB.
      console.warn(LOG, `Resumable session URL unavailable, using multipart upload for ${file.name}`)
      if (file.bytes.length > MULTIPART_LIMIT) {
        throw new DriveError(`${file.name} exceeds the multipart limit`, `${file.name} is larger than 5 MB and could not be uploaded from here.`)
      }
      const boundary = `smexporter_${randomString(20)}`
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`,
        file.bytes,
        `\r\n--${boundary}--`,
      ])
      const response = await driveFetch(`${target}?uploadType=multipart&supportsAllDrives=true`, {
        method,
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
      if (!response.ok) throw await driveError(response, 'multipart upload')
      return response.json()
    }

    // Asks the sandbox to render the selected frames (same export path as EXPORT)
    // and resolves with the generated files once export-ready arrives.
    function renderFilesForUpload() {
      return new Promise((resolve, reject) => {
        pendingExport = { resolve, reject }
        post({ type: 'export', options: exportOptions() })
      })
    }

    function friendlyDriveMessage(error) {
      if (error instanceof DriveError && error.userMessage) return error.userMessage
      if (error instanceof TypeError) return 'Couldn’t reach Google Drive — check your connection and try again.'
      return 'Upload failed — please check the Drive link and permissions.'
    }

    // ---- Cancelling an upload ------------------------------------------------------------------
    function uploadCancelledError() {
      const error = new DriveError('Upload cancelled by user', '')
      error.cancelled = true
      return error
    }

    function throwIfUploadCancelled() {
      if (uploadRun && uploadRun.cancelled) throw uploadCancelledError()
    }

    // Shared by uploads, downloads and canvas placement — they use the one "Cancel" control next to the status line.
    function showUploadCancel(visible) {
      driveCancel.hidden = !visible
      syncHeight()
    }

    function uploadCancelledMessage() {
      const done = uploadRun ? uploadRun.uploaded : 0
      const total = uploadRun ? uploadRun.total : 0
      if (!done) return 'Cancelled. Nothing was uploaded.'
      return `Cancelled. ${done} of ${total} file${total === 1 ? '' : 's'} already uploaded.`
    }

    // ---- Cancelling a download ------------------------------------------------------------------
    function downloadCancelledError() {
      const error = new DriveError('Download cancelled by user', '')
      error.cancelled = true
      return error
    }

    function throwIfDownloadCancelled() {
      if (downloadRun && downloadRun.cancelled) throw downloadCancelledError()
    }

    // Stops at once if a Drive request is in flight. While frames are still being rendered in Figma
    // (which can't be interrupted) it waits for that render to finish and then stops.
    driveCancel.addEventListener('click', () => {
      if (uploadRun && !uploadRun.cancelled) {
        uploadRun.cancelled = true
        showUploadCancel(false)
        setDriveStatus('busy', 'Cancelling...')
        uploadRun.controller.abort()
      } else if (downloadRun && !downloadRun.cancelled) {
        downloadRun.cancelled = true
        showUploadCancel(false)
        setDriveStatus('busy', 'Cancelling...')
        downloadRun.controller.abort()
      } else if (canvasPlaceRun && !canvasPlaceRun.cancelled) {
        canvasPlaceRun.cancelled = true
        showUploadCancel(false)
        setDriveStatus('busy', 'Cancelling...')
        canvasPlaceRun.controller.abort()
      }
    })

    async function startDriveUpload(folderOverride) {
      if (busy) return
      if (selectedCount === 0) { failDrive('Select frames to upload.'); return }
      if (!anyFormatSelected()) { failDrive('Choose at least one format to upload.'); return }
      const folderId = folderOverride || parseDriveFolderId(driveUrlInput.value)
      if (!folderId) {
        failDrive('That doesn’t look like a Google Drive folder link.')
        driveUrlInput.focus()
        return
      }
      busy = true
      activeDestination = 'drive'
      uploadRun = { cancelled: false, controller: new AbortController(), uploaded: 0, total: 0 }
      const signature = uploadSignature() // what this upload is made of
      hideTooltip()
      updateButton()
      setButtonState('', 'EXPORT')
      try {
        setDriveStatus('busy', 'Connecting to Google Drive...')
        await ensureAccessToken()
        showUploadCancel(true) // signed in: from here on the upload can be cancelled from the status line
        throwIfUploadCancelled()
        const folder = await verifyFolder(folderId)
        uploadRun.folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`
        saveLastFolder(folder.id, folder.name)
        throwIfUploadCancelled()
        console.log(LOG, `Uploading to folder "${folder.name}" (${folder.id})`)
        setDriveStatus('busy', 'Preparing files...')
        const files = await renderFilesForUpload()
        uploadRun.total = files.length
        throwIfUploadCancelled()
        const existing = await listFolderFiles(folder.id)
        let replaced = 0
        const uploadedIds = [] // so the drawer can flash exactly the files that just landed, see revealUploadedFiles
        for (let index = 0; index < files.length; index += 1) {
          throwIfUploadCancelled()
          const file = files[index]
          const matches = existing.get(file.name.toLowerCase()) || []
          setDriveStatus('busy', `${matches.length ? 'Replacing' : 'Uploading'} ${index + 1} of ${files.length}...`)
          const uploaded = await uploadFile(file, folder.id, matches[0])
          if (uploaded && uploaded.id) uploadedIds.push(uploaded.id)
          uploadRun.uploaded += 1
          if (matches.length) replaced += 1
          for (const duplicate of matches.slice(1)) { // older duplicates → bin
            try { await trashFile(duplicate.id) } catch (error) { if (!uploadRun.cancelled) throw error }
          }
        }
        setDriveStatus('success', `Uploaded to “${folder.name}”`, `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`)
        uploadedKey = signature
        dropStaleTick() // if the options were changed mid-upload, the tick would already be untrue
        void revealUploadedFiles(folder, uploadedIds)
        console.log(LOG, `Upload complete: ${files.length} files, ${replaced} replaced`)
      } catch (error) {
        const stoppedByUser = Boolean(uploadRun && uploadRun.cancelled)
        if (stoppedByUser) console.log(LOG, 'Upload cancelled'); else if (error && error.cancelled) console.log(LOG, 'Sign-in cancelled'); else console.error(LOG, 'Google Drive upload failed', error)
        if (stoppedByUser) {
          setDriveStatus('', uploadCancelledMessage(), uploadRun.uploaded ? uploadRun.folderUrl : '')
        } else if (error && error.cancelled) {
          setDriveStatus('', error.userMessage || '') // cancelling is a choice, not an error
        } else {
          failDrive(friendlyDriveMessage(error))
        }
      } finally {
        pendingExport = null
        showUploadCancel(false)
        uploadRun = null
        if (drawerMode === 'auth') showDrawer(null) // never leave the sign-in panel stranded open
        busy = false
        activeDestination = 'download'
        setButtonState('', 'EXPORT') // the EXPORT button never keeps a busy look after an upload
        updateButton()
        setTimeout(() => uploadPill.classList.remove('is-error'), 1800) // the tick stays: see dropStaleTick
      }
    }

    // After an upload finishes, open (or refresh) the picker drawer on the destination folder and flash
    // the tiles that just landed there — rather than the upload finishing invisibly behind a closed
    // drawer (or a drawer that was already open getting yanked shut the moment the upload began), with no
    // way to see which files actually went up. Shared by both the drawer's own "Upload here" and pasting
    // a folder link into the link field and hitting EXPORT, since both end up here through the same
    // startDriveUpload. A move already in progress is left alone rather than hijacked out from under it.
    async function revealUploadedFiles(folder, fileIds) {
      if (!fileIds.length || pickerMove) return
      pickerTab = 'mine'
      pickerStack = [{ id: folder.id, name: folder.name }]
      pickerRedoStack = []
      pickerSearch.value = ''
      showDrawer('picker')
      await renderPicker()
      for (const id of fileIds) {
        const el = elById.get(id)
        if (el) el.classList.add('is-flash')
      }
    }
