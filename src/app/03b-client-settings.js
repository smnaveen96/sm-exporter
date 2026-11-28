    // ---- Confirmation pop-up -------------------------------------------------------------------------
    // Resolves true on the confirm button, false on Cancel, Esc or a click outside. Esc closes ONLY the pop-up.
    let modalResolve = null, modalReturnFocus = null, modalHideTimer = 0, modalHasInput = false
    const modalInput = document.getElementById('modal-input')
    // selectEnd: how much of a pre-filled input to select (from the start) instead of all of it — the
    // Rename dialog uses it to leave a file's extension out of the selection, so typing replaces just
    // the name part the way Drive's and Finder's own rename do.
    function confirmDialog({ title, message, confirmLabel, input, danger, selectEnd }) {
      if (modalResolve) closeModal(false)
      modalTitle.textContent = title
      modalText.textContent = message || ''
      modalText.hidden = !message
      modalOk.textContent = confirmLabel || 'Delete'
      modalOk.classList.toggle('is-danger-solid', danger !== false)
      modalOk.classList.toggle('is-primary', danger === false)
      modalHasInput = typeof input === 'string'
      modalInput.hidden = !modalHasInput
      if (modalHasInput) modalInput.value = input
      modalReturnFocus = document.activeElement
      clearTimeout(modalHideTimer)
      modalEl.hidden = false
      void modalEl.offsetWidth
      modalEl.classList.add('is-open')
      if (modalHasInput) {
        modalInput.focus()
        if (Number.isInteger(selectEnd) && selectEnd > 0 && selectEnd < input.length) modalInput.setSelectionRange(0, selectEnd)
        else modalInput.select()
      } else modalCancel.focus() // the safe choice is the default one
      return new Promise((resolve) => { modalResolve = resolve })
    }
    function closeModal(result) {
      const resolve = modalResolve
      modalResolve = null
      let value = result
      if (modalHasInput && result) value = modalInput.value.trim() || false
      modalEl.classList.remove('is-open')
      modalHideTimer = setTimeout(() => { if (!modalResolve) modalEl.hidden = true }, 200)
      const back = modalReturnFocus
      modalReturnFocus = null
      if (back && back.isConnected && typeof back.focus === 'function' && !back.disabled) back.focus({ preventScroll: true })
      if (resolve) resolve(value)
    }
    modalInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); closeModal(true) } })
    modalOk.addEventListener('click', () => closeModal(true))
    modalCancel.addEventListener('click', () => closeModal(false))
    modalEl.addEventListener('pointerdown', (event) => { if (event.target === modalEl) closeModal(false) })
    window.addEventListener('keydown', (event) => {
      if (!modalResolve) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeModal(false) }
      else if (event.key === 'Tab') { // keep focus inside the pop-up
        event.preventDefault()
        const order = (modalHasInput ? [modalInput] : []).concat([modalCancel, modalOk])
        const at = order.indexOf(document.activeElement)
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length].focus()
      }
    }, true)

    // ---- Your own Client ID and secret ----------------------------------------------------------------
    // For people who'd rather not sign in through SM exporter's OAuth service: they add a client from their
    // own Google Cloud project, and signing in runs between the plugin and Google only. Save checks the pair
    // with Google first. Delete forgets it and signs out the accounts that were connected with it (their
    // tokens only work with that client); accounts connected the quick way stay.
    function ownAccounts() { return accounts.filter((entry) => entry.via === 'own') }

    function updateClientButtons() {
      clientSaveButton.disabled = checkingClient
      clientSaveButton.textContent = checkingClient ? 'Checking…' : 'Save'
      const hasText = Boolean(clientIdInput.value.trim() || clientSecretInput.value.trim())
      clientDeleteButton.disabled = checkingClient || !(oauthClient || hasText)
      const blocked = (busy && !signInWaiters.length) || checkingClient
      ownConnectButton.disabled = blocked
      ownConnectHint.textContent = oauthClient
        ? 'Opens Google in your browser. Allow access, then copy the address of the page that opens and paste it here.'
        : 'Add your Client ID and secret above first.'
    }

    function openOwnClientSettings(message) {
      fillSettingsFields()
      showDrawer('settings')
      if (message) setSettingsMessage('error', message, [clientIdInput, clientSecretInput])
      setTimeout(() => { if (drawerMode === 'settings' && !oauthClient) clientIdInput.focus() }, 360)
    }
    ownClientOpen.addEventListener('click', () => openOwnClientSettings())
    setupGuideLink.href = SETUP_GUIDE_URL
    setupGuideLink.addEventListener('click', (event) => { event.preventDefault(); post({ type: 'open-url', url: SETUP_GUIDE_URL }) })

    for (const input of [clientIdInput, clientSecretInput]) {
      input.addEventListener('input', () => { setSettingsMessage('', ''); updateClientButtons() })
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); clientSaveButton.click() } })
    }

    // Saves what's in the fields if it's new and Google accepts it. Resolves true when the client in the
    // fields is the one in effect (saved now, or already saved).
    async function saveOwnClient(report) {
      const run = ++clientCheckRun
      if (checkingClient) { checkingClient = false; refreshAccountLabel() } // an older check is superseded
      const clientId = stripQuotes(clientIdInput.value)
      const clientSecret = stripQuotes(clientSecretInput.value)
      const redirectUri = (oauthClient && oauthClient.redirectUri) || DEFAULT_REDIRECT_URI
      if (settingsMsg.classList.contains('is-busy')) setSettingsMessage('', '')
      if (!clientId && !clientSecret) return false
      if (oauthClient && oauthClient.clientId === clientId && oauthClient.clientSecret === clientSecret) return true // nothing new

      const idProblem = clientId && (/\s/.test(clientId) || !CLIENT_ID_PATTERN.test(clientId))
      const secretProblem = clientSecret && /\s/.test(clientSecret)
      if (idProblem || secretProblem || !clientId || !clientSecret) {
        if (report && idProblem) setSettingsMessage('error', 'That doesn’t look like a Google Client ID. It should end with .apps.googleusercontent.com.', [clientIdInput])
        else if (report && secretProblem) setSettingsMessage('error', 'The Client secret can’t contain spaces. Copy it again from Google Cloud.', [clientSecretInput])
        return false
      }

      checkingClient = true
      refreshAccountLabel()
      setSettingsMessage('busy', 'Checking with Google…')
      const check = await verifyOAuthClient(clientId, clientSecret, redirectUri)
      if (run !== clientCheckRun) return false // the fields changed meanwhile: the newer run owns the result
      checkingClient = false
      if (check.status === 'bad-id' || check.status === 'bad-secret') {
        setSettingsMessage('error', check.message, [check.status === 'bad-id' ? clientIdInput : clientSecretInput])
        refreshAccountLabel()
        return false
      }

      const values = { [STORAGE_CLIENT_KEY]: { clientId, clientSecret, redirectUri } }
      const signedOut = oauthClient ? ownAccounts() : [] // a different client: its accounts' tokens stop working
      oauthClient = values[STORAGE_CLIENT_KEY]
      post({ type: 'storage-set', values })
      if (signedOut.length) dropAccounts(signedOut)
      setSettingsMessage('ok', check.status === 'offline' ? 'Saved. Couldn’t reach Google to check it; it will be checked when you sign in.' : 'Saved')
      refreshAccountLabel()
      console.log(LOG, 'OAuth client saved', check.status === 'offline' ? '(not verified, offline)' : '(verified)')
      return true
    }

    clientSaveButton.addEventListener('click', async () => {
      if (checkingClient) return
      const missingId = !stripQuotes(clientIdInput.value)
      const missingSecret = !stripQuotes(clientSecretInput.value)
      if (missingId || missingSecret) {
        const what = missingId && missingSecret ? 'Client ID and Client secret' : missingId ? 'Client ID' : 'Client secret'
        setSettingsMessage('error', `Enter your ${what} to save.`, [missingId && clientIdInput, missingSecret && clientSecretInput])
        ;(missingId ? clientIdInput : clientSecretInput).focus()
        return
      }
      const ok = await saveOwnClient(true)
      if (ok && settingsMsg.hidden) setSettingsMessage('ok', 'Saved')
    })

    // Takes these accounts out of the list (signing out); the active one moves to whichever is left.
    function dropAccounts(gone) {
      if (!gone.length) return
      const wasActive = gone.includes(tokens)
      accounts = accounts.filter((entry) => !gone.includes(entry))
      if (wasActive) {
        tokens = accounts[0] || null
        resetPickerLocation()
        if (drawerMode === 'picker') showDrawer(null)
      }
      saveTokens()
      dropStaleTick()
    }

    async function deleteOwnClient() {
      if (!oauthClient) { // only typed text: just clear it
        clientIdInput.value = ''
        clientSecretInput.value = ''
        setSettingsMessage('', '')
        updateClientButtons()
        clientIdInput.focus()
        return
      }
      const count = ownAccounts().length
      const ok = await confirmDialog({
        title: 'Delete Client ID & secret?',
        message: (count ? `They’ll be removed, and ${count === 1 ? 'the account connected with them' : `the ${count} accounts connected with them`} signed out. ` : 'They’ll be removed. ')
          + 'Accounts connected with “Sign in with Google” stay connected.',
        confirmLabel: 'Delete',
      })
      if (!ok) return
      clientCheckRun++
      checkingClient = false
      oauthClient = null
      post({ type: 'storage-set', values: { [STORAGE_CLIENT_KEY]: null } })
      dropAccounts(ownAccounts())
      fillSettingsFields()
      setSettingsMessage('ok', 'Deleted')
      console.log(LOG, 'OAuth client deleted')
    }
    clientDeleteButton.addEventListener('click', () => { void deleteOwnClient() })

    // "Continue with Google": anything still being typed is checked and saved first.
    ownConnectButton.addEventListener('click', async () => {
      if (checkingClient) return
      const missingId = !stripQuotes(clientIdInput.value)
      const missingSecret = !stripQuotes(clientSecretInput.value)
      if (missingId || missingSecret) {
        const what = missingId && missingSecret ? 'Client ID and Client secret' : missingId ? 'Client ID' : 'Client secret'
        setSettingsMessage('error', `Enter your ${what} to continue.`, [missingId && clientIdInput, missingSecret && clientSecretInput])
        ;(missingId ? clientIdInput : clientSecretInput).focus()
        return
      }
      const ready = await saveOwnClient(true)
      if (!ready || !oauthClient) return
      await connectWith('own')
    })

    // ---- Signing in with your own client: authorization code + PKCE, the redirect pasted back in ---------
    authContinue.addEventListener('click', submitAuthCode)
    authCodeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submitAuthCode() } })
    authCodeInput.addEventListener('input', () => setOwnAuthError(''))
    authOwnCancel.addEventListener('click', () => cancelOwnSignIn())
    authEditClient.addEventListener('click', (event) => {
      event.preventDefault()
      if (pendingAuth) cancelOwnSignIn({ openSettings: true })
    })
    authOwnLink.addEventListener('click', (event) => {
      event.preventDefault()
      if (authOwnLink.dataset.url) post({ type: 'open-url', url: authOwnLink.dataset.url })
    })

    // Backing out is a choice, not a failure: no error is shown.
    function cancelOwnSignIn(options) {
      const openSettings = Boolean(options && options.openSettings)
      const waiting = pendingAuth
      if (!waiting) return
      pendingAuth = null
      setOwnAuthError('')
      const error = new DriveError('Sign-in cancelled by user', openSettings ? '' : 'Sign-in cancelled.')
      error.cancelled = true
      error.openSettings = openSettings
      waiting.reject(error)
    }

    // Resolves with the pasted code. Gives up after AUTH_TIMEOUT_MS so the buttons never stay locked.
    function waitForAuthCode(state) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pendingAuth) return
          pendingAuth = null
          setOwnAuthError('')
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
        setOwnAuthError(parsed.error)
        authCodeInput.focus()
        return
      }
      setOwnAuthError('')
      const waiting = pendingAuth
      pendingAuth = null
      waiting.resolve(parsed.code)
    }

    // Accepts the bare authorization code or the full redirect URL (…?code=…&state=…), which is what the
    // browser address bar shows after consent. Returns { code } or { error } in plain words.
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

    // Signs in with the saved own client. Returns the token response; the caller turns it into an account.
    async function ownClientGrant() {
      if (!oauthClient) throw new DriveError('No OAuth client configured', 'Add your Client ID and secret to continue.')
      const client = oauthClient
      const state = randomString(24)
      const verifier = randomString(64)
      const challenge = await pkceChallenge(verifier)
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
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
      authOwnLink.dataset.url = url
      authOwnLink.href = url
      console.log(LOG, 'Opening Google sign-in with your own client', challenge ? '(PKCE S256)' : '(no PKCE)')
      post({ type: 'open-url', url })
      authCodeInput.value = ''
      setOwnAuthError('')
      setOwnAuthBusy(false)
      showDrawer('auth-own')
      setDriveStatus('busy', 'Waiting for Google sign-in…')
      setTimeout(() => authCodeInput.focus(), 360)
      try {
        while (true) {
          const code = await waitForAuthCode(state)
          const fields = { code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri, grant_type: 'authorization_code' }
          if (challenge) fields.code_verifier = verifier
          setOwnAuthBusy(true)
          try {
            return await tokenRequest(fields)
          } catch (error) {
            setOwnAuthBusy(false)
            // A bad or used code, or a dropped connection: keep the panel open so it can be fixed in place.
            if (error instanceof DriveError && error.oauthError === 'invalid_grant') {
              setOwnAuthError('Google didn’t accept that code. It may be incomplete, already used or expired. Copy the address again, or open the sign-in page again.')
            } else if (error instanceof TypeError) {
              setOwnAuthError('Couldn’t reach Google. Check your connection, then press Continue.')
            } else {
              throw error
            }
            authCodeInput.focus()
            authCodeInput.select()
          }
        }
      } finally {
        if (pendingAuth) { clearTimeout(pendingAuth.timer); pendingAuth = null }
        setOwnAuthBusy(false)
      }
    }
