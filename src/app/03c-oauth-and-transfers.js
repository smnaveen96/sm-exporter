    // ---- Continue with Google (from the settings panel) -------------------------------------------
    // The same sign-in an upload would trigger, started on purpose. Afterwards the settings panel
    // comes back so the connected account is right there.
    async function connectFromSettings() {
      busy = true
      updateButton()
      let justConnected = false
      try {
        await interactiveSignIn()
        justConnected = true
        setDriveStatus('', '')
      } catch (error) {
        if (error && error.cancelled) {
          setDriveStatus('', error.userMessage || '')
        } else if (error && error.oauthError === 'invalid_client') {
          fillSettingsFields()
          showDrawer('settings')
          setSettingsMessage('error', 'Google rejected this Client ID or secret. Check both for typos.', [clientIdInput, clientSecretInput])
          setDriveStatus('', '')
        } else {
          console.error(LOG, 'Google sign-in failed', error)
          failDrive(friendlyDriveMessage(error))
        }
      } finally {
        if (pendingAuth) { clearTimeout(pendingAuth.timer); pendingAuth = null }
        setAuthBusy(false)
        busy = false
        updateButton()
        if (justConnected && tokens) {
          // Signed in: fold the panel away and flash who is connected for a moment, instead of leaving the form open.
          showDrawer(null)
          flashDriveStatus(tokens.account ? `Connected as ${tokens.account}` : 'Connected to Google Drive', 3500)
        }
      }
    }

    connectButton.addEventListener('click', async () => {
      if (busy || checkingClient || tokens) return
      const missingId = !stripQuotes(clientIdInput.value)
      const missingSecret = !stripQuotes(clientSecretInput.value)
      if (missingId || missingSecret) {
        const what = missingId && missingSecret ? 'Client ID and Client secret' : missingId ? 'Client ID' : 'Client secret'
        setSettingsMessage('error', `Enter your ${what} to continue.`, [missingId && clientIdInput, missingSecret && clientSecretInput])
        ;(missingId ? clientIdInput : clientSecretInput).focus()
        return
      }
      const ready = await autosaveClient(true) // anything still being typed is checked and saved first
      if (!ready || !oauthClient || busy || tokens) return
      await connectFromSettings()
    })

    disconnectButton.addEventListener('click', () => { void confirmRemoveAccount(tokens) })

    authContinue.addEventListener('click', submitAuthCode)
    authCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submitAuthCode() }
    })
    authCodeInput.addEventListener('input', () => setAuthError(''))
    authCancel.addEventListener('click', () => cancelSignIn())
    authEditClient.addEventListener('click', (event) => {
      event.preventDefault()
      if (pendingAuth) cancelSignIn({ openSettings: true })
    })

    // Backing out of sign-in is a choice, not a failure: close the panel and show no error.
    function cancelSignIn(options) {
      const openSettings = Boolean(options && options.openSettings)
      const waiting = pendingAuth
      if (!waiting) { if (drawerMode === 'auth' && !authCancel.disabled) showDrawer(null); return }
      pendingAuth = null
      setAuthError('')
      showDrawer(null)
      const error = new DriveError('Sign-in cancelled by user', openSettings ? '' : 'Sign-in cancelled.')
      error.cancelled = true
      waiting.reject(error)
      if (openSettings) {
        fillSettingsFields()
        showDrawer('settings')
        setTimeout(() => clientIdInput.focus(), 360)
      }
    }

    // Resolves with the pasted code. Gives up after AUTH_TIMEOUT_MS so the buttons never stay locked.
    function waitForAuthCode(state) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pendingAuth) return
          pendingAuth = null
          setAuthError('')
          showDrawer(null)
          reject(new DriveError('Sign-in timed out', 'Sign-in timed out. Please try again.'))
        }, AUTH_TIMEOUT_MS)
        pendingAuth = {
          state,
          timer,
          resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) },
        }
      })
    }

    function submitAuthCode() {
      if (!pendingAuth) return
      const parsed = extractAuthCode(authCodeInput.value, pendingAuth.state)
      if (parsed.error) {
        setAuthError(parsed.error)
        authCodeInput.focus()
        return
      }
      setAuthError('')
      const waiting = pendingAuth
      pendingAuth = null
      waiting.resolve(parsed.code)
    }

    // Accepts the bare authorization code or the full redirect URL (…?code=…&state=…), which is
    // what the browser address bar shows after consent. Returns { code } or { error } in plain words.
    function extractAuthCode(rawValue, expectedState) {
      const value = stripQuotes(rawValue)
      if (!value) return { error: 'Paste the address from the browser (or the code) to continue.' }
      if (/^https?:\/\//i.test(value) || /(^|[?&#])(code|error)=/.test(value)) {
        let url
        try {
          url = new URL(value.includes('://') ? value : `http://x/?${value.replace(/^[?#]/, '')}`)
        } catch {
          return { error: 'That address couldn’t be read. Copy it again from the browser, or paste just the code.' }
        }
        if (/(^|\.)accounts\.google\.com$/i.test(url.hostname)) return { error: 'That’s the sign-in page. Approve access first, then copy the address of the page that opens next.' }
        const params = new URLSearchParams(url.search || url.hash.replace(/^#/, '?'))
        const problem = params.get('error')
        if (problem) {
          return { error: problem === 'access_denied'
            ? 'Access wasn’t allowed in Google. Open the sign-in page again and approve it.'
            : `Google reported “${problem}”. Open the sign-in page again and retry.` }
        }
        const code = params.get('code')
        if (!code) return { error: 'That address has no code in it. Approve access first, then copy the address of the page that opens next.' }
        const state = params.get('state')
        if (state && expectedState && state !== expectedState) return { error: 'That address is from a different sign-in attempt. Use the link above to sign in again.' }
        return { code }
      }
      // A bare code: tidy common copy artefacts (%2F, trailing &scope=…) and check it looks like one.
      let code = value.split(/[&\s]/)[0]
      try { code = decodeURIComponent(code) } catch { /* keep as pasted */ }
      if (!/^[A-Za-z0-9_\-/.~]{20,}$/.test(code)) {
        return { error: 'That doesn’t look like a Google code. After approving, copy the full address from the browser bar.' }
      }
      return { code }
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

    function randomString(length) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
      const bytes = new Uint8Array(length)
      crypto.getRandomValues(bytes)
      let output = ''
      for (const byte of bytes) output += alphabet[byte % alphabet.length]
      return output
    }

    async function pkceChallenge(verifier) {
      if (!(crypto.subtle && crypto.subtle.digest)) return null
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      } catch (error) {
        console.warn(LOG, 'PKCE unavailable, continuing without it', error)
        return null
      }
    }

    async function tokenRequest(fields) {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const failure = new DriveError(
          `Token request failed (${response.status}): ${data.error || ''} ${data.error_description || ''}`.trim(),
          `Google sign-in failed (${data.error || 'HTTP ' + response.status}${data.error === 'invalid_client' ? ': check Client ID and secret' : data.error === 'invalid_grant' ? ': code used or expired, sign in again' : data.error === 'redirect_uri_mismatch' ? ': redirect address differs' : ''}).`,
          response.status,
        )
        failure.oauthError = data.error || ''
        throw failure
      }
      return data
    }

    async function interactiveSignIn() {
      if (!oauthClient) throw new DriveError('No OAuth client configured', 'Add your Google OAuth client to continue.')
      const state = randomString(24)
      const verifier = randomString(64)
      const challenge = await pkceChallenge(verifier)
      const params = new URLSearchParams({
        client_id: oauthClient.clientId,
        redirect_uri: oauthClient.redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent select_account',
        state,
      })
      if (challenge) {
        params.set('code_challenge', challenge)
        params.set('code_challenge_method', 'S256')
      }
      const url = `${GOOGLE_AUTH_URL}?${params.toString()}`
      authLink.dataset.url = url
      authLink.href = url
      console.log(LOG, 'Opening Google sign-in', challenge ? '(PKCE S256)' : '(no PKCE)')
      post({ type: 'open-url', url })
      authCodeInput.value = ''
      setAuthError('')
      setAuthBusy(false)
      showDrawer('auth')
      setDriveStatus('busy', 'Waiting for Google sign-in...')
      setTimeout(() => authCodeInput.focus(), 360)
      let data = null
      while (!data) {
        const code = await waitForAuthCode(state)
        const fields = {
          code,
          client_id: oauthClient.clientId,
          client_secret: oauthClient.clientSecret,
          redirect_uri: oauthClient.redirectUri,
          grant_type: 'authorization_code',
        }
        if (challenge) fields.code_verifier = verifier
        setAuthBusy(true)
        try {
          data = await tokenRequest(fields)
        } catch (error) {
          setAuthBusy(false)
          // A bad or used code, or a dropped connection: keep the panel open so it can be fixed in place.
          if (error instanceof DriveError && error.oauthError === 'invalid_grant') {
            setAuthError('Google didn’t accept that code. It may be incomplete, already used or expired. Copy the address again, or open the sign-in page again.')
          } else if (error instanceof TypeError) {
            setAuthError('Couldn’t reach Google. Check your connection, then press Continue.')
          } else {
            throw error
          }
          authCodeInput.focus()
          authCodeInput.select()
        }
      }
      setAuthBusy(false)
      showDrawer(null)
      setDriveStatus('busy', 'Connecting to Google Drive...')
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
      console.log(LOG, 'Connected to Google Drive', tokens.account || '')
    }

    async function refreshAccessToken() {
      const data = await tokenRequest({
        refresh_token: tokens.refreshToken,
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        grant_type: 'refresh_token',
      })
      Object.assign(tokens, {
        accessToken: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      })
      saveTokens()
      console.log(LOG, 'Access token refreshed')
    }

    async function ensureAccessToken(forceRefresh) {
      if (!oauthClient) throw new DriveError('No OAuth client configured', 'Add your Google OAuth client to continue.')
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

    // Shared by uploads and downloads — they never run at the same time, and both just need the one
    // "Cancel" control next to the status line.
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
      if (!oauthClient) {
        fillSettingsFields()
        showDrawer('settings')
        failDrive('Add your Google OAuth client to continue.')
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
        } else if (error && error.oauthError === 'invalid_client') {
          // Google doesn’t accept the saved client: take the user straight to the fields to fix it.
          fillSettingsFields()
          showDrawer('settings')
          failDrive('Google rejected the Client ID or secret.')
          setSettingsMessage('error', 'Google rejected this Client ID or secret. Check both for typos, then Save.', [clientIdInput, clientSecretInput])
        } else {
          failDrive(friendlyDriveMessage(error))
        }
      } finally {
        pendingExport = null
        showUploadCancel(false)
        uploadRun = null
        if (pendingAuth) { clearTimeout(pendingAuth.timer); pendingAuth = null }
        setAuthBusy(false)
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

