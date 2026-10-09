    // ---- Client settings: Save and Delete ------------------------------------------------------------
    // Save checks the Client ID + secret with Google and stores them. Delete forgets them (and, because
    // tokens belong to the client that issued them, signs every account out) after a confirmation.
    function scheduleAutosave() { /* kept so older call sites stay harmless: saving is now explicit */ }

    function updateClientButtons() {
      clientSaveButton.disabled = checkingClient
      clientSaveButton.textContent = checkingClient ? 'Checking…' : 'Save'
      const hasSaved = Boolean(oauthClient && !oauthClient.builtIn) || accounts.length > 0
      const hasText = Boolean(clientIdInput.value.trim() || clientSecretInput.value.trim())
      clientDeleteButton.disabled = checkingClient || !(hasSaved || hasText)
    }

    for (const input of [clientIdInput, clientSecretInput]) {
      input.addEventListener('input', () => { setSettingsMessage('', ''); updateClientButtons() })
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); clientSaveButton.click() } })
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
      const ok = await autosaveClient(true)
      if (ok && settingsMsg.hidden) setSettingsMessage('ok', 'Saved')
    })

    async function deleteClient() {
      const hasSaved = Boolean(oauthClient && !oauthClient.builtIn) || accounts.length > 0
      if (!hasSaved) { // only typed text: just clear it
        clientIdInput.value = ''
        clientSecretInput.value = ''
        setSettingsMessage('', '')
        updateClientButtons()
        clientIdInput.focus()
        return
      }
      const count = accounts.length
      const ok = await confirmDialog({
        title: 'Delete Client ID & secret?',
        message: (count ? `The saved credentials will be removed and ${count === 1 ? 'the connected account' : `all ${count} connected accounts`} signed out. ` : 'The saved credentials will be removed. ')
          + 'You’ll need to enter them again to use Google Drive.',
        confirmLabel: 'Delete',
      })
      if (!ok) return
      clearTimeout(autosaveTimer)
      autosaveRun++
      checkingClient = false
      oauthClient = builtInClient()
      tokens = null
      accounts = []
      resetPickerLocation()
      post({ type: 'storage-set', values: { [STORAGE_CLIENT_KEY]: null, [STORAGE_TOKENS_KEY]: null, [STORAGE_ACCOUNTS_KEY]: null } })
      fillSettingsFields()
      dropStaleTick()
      setSettingsMessage('ok', 'Deleted')
      console.log(LOG, 'OAuth client deleted')
    }
    clientDeleteButton.addEventListener('click', () => { void deleteClient() })

    // ---- Confirmation pop-up -------------------------------------------------------------------------
    // Resolves true on the confirm button, false on Cancel, Esc or a click outside. Esc closes ONLY the pop-up.
    let modalResolve = null, modalReturnFocus = null, modalHideTimer = 0, modalHasInput = false
    const modalInput = document.getElementById('modal-input')
    function confirmDialog({ title, message, confirmLabel, input, danger }) {
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
      if (modalHasInput) { modalInput.focus(); modalInput.select() } else modalCancel.focus() // the safe choice is the default one
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

    // Resolves true when the client in the fields is the one in effect (saved now, or already saved).
    async function autosaveClient(report) {
      clearTimeout(autosaveTimer)
      const run = ++autosaveRun
      if (checkingClient) { checkingClient = false; refreshAccountLabel() } // an older check is superseded
      const clientId = stripQuotes(clientIdInput.value)
      const clientSecret = stripQuotes(clientSecretInput.value)
      const redirectUri = (oauthClient && oauthClient.redirectUri) || DEFAULT_REDIRECT_URI // not shown in the UI; the default is baked in above
      if (settingsMsg.classList.contains('is-busy')) setSettingsMessage('', '')

      if (!clientId && !clientSecret) return false // nothing to save; a saved client is left untouched
      if (oauthClient && oauthClient.clientId === clientId && oauthClient.clientSecret === clientSecret) return true // nothing new

      const idProblem = clientId && (/\s/.test(clientId) || !CLIENT_ID_PATTERN.test(clientId))
      const secretProblem = clientSecret && /\s/.test(clientSecret)
      if (idProblem || secretProblem || !clientId || !clientSecret) {
        if (report && idProblem) setSettingsMessage('error', 'That doesn’t look like a Google Client ID. It should end with .apps.googleusercontent.com.', [clientIdInput])
        else if (report && secretProblem) setSettingsMessage('error', 'The Client secret can’t contain spaces. Copy it again from Google Cloud.', [clientSecretInput])
        return false // incomplete or malformed: keep waiting
      }

      checkingClient = true
      refreshAccountLabel()
      setSettingsMessage('busy', 'Checking with Google…')
      const check = await verifyOAuthClient(clientId, clientSecret, redirectUri)
      if (run !== autosaveRun) return false // the fields changed meanwhile: the newer run owns the result
      checkingClient = false
      if (check.status === 'bad-id' || check.status === 'bad-secret') {
        if (drawerMode === 'settings') setSettingsMessage('error', check.message, [check.status === 'bad-id' ? clientIdInput : clientSecretInput])
        else { setSettingsMessage('', ''); failDrive(check.message) }
        refreshAccountLabel()
        return false
      }

      const changedClient = !oauthClient || oauthClient.clientId !== clientId || oauthClient.clientSecret !== clientSecret
      oauthClient = { clientId, clientSecret, redirectUri }
      const values = { [STORAGE_CLIENT_KEY]: oauthClient }
      if (changedClient && accounts.length) {
        tokens = null // tokens are bound to the client that issued them
        accounts = []
        values[STORAGE_TOKENS_KEY] = null
        values[STORAGE_ACCOUNTS_KEY] = null
      }
      post({ type: 'storage-set', values })
      setSettingsMessage('ok', check.status === 'offline' ? 'Saved. Couldn’t reach Google to check it — it will be checked when you sign in.' : 'Saved')
      refreshAccountLabel()
      setTimeout(() => { if (drawerMode === 'settings' && !connectBlock.hidden) connectBlock.scrollIntoView({ block: 'nearest' }) }, 60)
      console.log(LOG, 'OAuth client saved', check.status === 'offline' ? '(not verified — offline)' : '(verified)')
      return true
    }

