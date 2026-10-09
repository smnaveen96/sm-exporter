    // ---- Google profile photos ---------------------------------------------------------------------
    // Shows the account's Google photo; the first letter stays if there is none or it can't be loaded
    // (the photo host must be allowed in manifest.json → networkAccess).
    function fillAvatar(el, entry) {
      const letter = ((entry && entry.account) || 'G').charAt(0)
      const photo = entry && entry.photo ? String(entry.photo).replace(/=s\d+(-c)?$/, '=s96-c') : ''
      const key = `${letter}|${photo}`
      if (el.dataset.avatar === key) return
      el.dataset.avatar = key
      el.textContent = letter
      if (!photo) return
      const img = new Image()
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.onload = () => { if (el.dataset.avatar === key) { el.textContent = ''; el.append(img) } }
      img.src = photo
    }

    async function accessTokenFor(entry) {
      if (entry.accessToken && Date.now() < entry.expiresAt - 60000) return entry.accessToken
      if (!entry.refreshToken || !oauthClient) return null
      const data = await tokenRequest({ refresh_token: entry.refreshToken, client_id: oauthClient.clientId, client_secret: oauthClient.clientSecret, grant_type: 'refresh_token' })
      entry.accessToken = data.access_token
      entry.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000
      return entry.accessToken
    }

    // Accounts connected before photos were read get theirs once, in the background.
    async function loadProfilePhotos() {
      let changed = false
      for (const entry of accounts) {
        if (entry.photo !== undefined) continue
        try {
          const token = await accessTokenFor(entry)
          if (!token) continue
          const response = await fetch(`${DRIVE_API}/about?fields=user(photoLink)`, { headers: { Authorization: `Bearer ${token}` } })
          if (!response.ok) continue
          entry.photo = ((await response.json()).user || {}).photoLink || null
          changed = true
        } catch (error) {
          console.warn(LOG, 'Could not read a profile photo', error)
        }
      }
      if (changed) saveTokens()
    }

    // ---- Account switcher (header) ---------------------------------------------------------------
    // The photo / initial button opens one panel for everything Google: the accounts, adding one and,
    // one step further in, the OAuth client settings and the paste-the-redirect step of signing in.
    const accountList = document.getElementById('account-list')
    const accountBack = document.getElementById('account-back')
    accountMenu.append(drawerSettings, drawerAuth) // the sign-in cards live in the panel, not at the bottom

    function renderAccountSwitcher() {
      accountChip.classList.toggle('is-connected', Boolean(tokens))
      if (tokens) fillAvatar(accountChip, tokens)
      else { accountChip.dataset.avatar = ''; accountChip.innerHTML = connectButton.querySelector('.g-logo').outerHTML }
      const label = tokens ? (tokens.account || 'Google Drive') : 'Connect Google Drive'
      accountChip.setAttribute('aria-label', label)
      accountChip.title = label
      if (!accountMenu.hidden && accountMenu.dataset.view === 'list') renderAccountMenu()
    }

    function renderAccountMenu() {
      accountList.textContent = ''
      for (const entry of accounts) {
        const row = document.createElement('div')
        row.className = `account-row${entry === tokens ? ' is-active' : ''}`
        const pick = document.createElement('button')
        pick.type = 'button'
        pick.className = 'account-pick'
        pick.setAttribute('role', 'menuitem')
        const dot = document.createElement('span')
        dot.className = 'dot'
        fillAvatar(dot, entry)
        const mail = document.createElement('span')
        mail.className = 'mail'
        mail.textContent = entry.account || 'Google Drive'
        pick.append(dot, mail)
        pick.addEventListener('click', () => switchAccount(entry))
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'account-remove'
        remove.innerHTML = TRASH_ICON
        remove.title = 'Remove account'
        remove.setAttribute('aria-label', `Remove ${entry.account || 'Google Drive'}`)
        remove.addEventListener('click', () => { void confirmRemoveAccount(entry) })
        row.append(pick, remove)
        accountList.append(row)
      }
      if (accounts.length) {
        const sep = document.createElement('div')
        sep.className = 'account-sep'
        accountList.append(sep)
      }
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'account-add'
      add.setAttribute('role', 'menuitem')
      add.innerHTML = `${connectButton.querySelector('.g-logo').outerHTML}<span>Connect new account</span>`
      add.addEventListener('click', () => { void connectNewAccount() })
      accountList.append(add)
      const client = document.createElement('button')
      client.type = 'button'
      client.className = 'account-link'
      client.textContent = 'Client ID & secret'
      client.addEventListener('click', () => { fillSettingsFields(); showDrawer('settings') })
      accountList.append(client)
    }

    // view: 'list' (accounts) | 'settings' (Client ID and secret) | 'auth' (paste the redirect URL)
    function openAccountMenu(view) {
      accountMenu.dataset.view = view
      accountList.hidden = view !== 'list'
      drawerSettings.hidden = view !== 'settings'
      drawerAuth.hidden = view !== 'auth'
      accountBack.hidden = view !== 'settings'
      if (view === 'list') renderAccountMenu()
      accountMenu.hidden = false
      accountChip.setAttribute('aria-expanded', 'true')
      syncHeight()
    }

    function closeAccountMenu() {
      accountMenu.hidden = true
      accountChip.setAttribute('aria-expanded', 'false')
      syncHeight()
    }

    // Clicking away closes the panel — except mid sign-in, where Cancel or Esc ends it, so the paste step isn't lost.
    function dismissAccountMenu() {
      if (accountMenu.hidden) return
      const view = accountMenu.dataset.view
      if (view === 'auth') return
      if (view === 'settings') showDrawer(null)
      else closeAccountMenu()
    }

    function switchAccount(entry) {
      closeAccountMenu()
      if (entry === tokens) return
      tokens = entry
      resetPickerLocation()
      if (drawerMode === 'picker') showDrawer(null)
      saveTokens()
      dropStaleTick()
      flashDriveStatus(`Using ${entry.account || 'Google Drive'}`, 2500)
    }

    async function confirmRemoveAccount(entry) {
      if (!entry) return
      const ok = await confirmDialog({
        title: 'Remove this account?',
        message: `${entry.account || 'This Google account'} will be disconnected from the plugin. Your files in Drive aren’t touched.`,
        confirmLabel: 'Remove',
      })
      if (ok) removeAccount(entry)
    }

    function removeAccount(target) {
      if (!target) return
      accounts = accounts.filter((entry) => entry !== target)
      if (target === tokens) tokens = accounts[0] || null
      resetPickerLocation()
      if (drawerMode === 'picker') showDrawer(null)
      saveTokens()
      dropStaleTick()
      setDriveStatus('', `Disconnected ${target.account || 'Google Drive'}.`)
      console.log(LOG, 'Disconnected Google account')
    }

    async function connectNewAccount() {
      closeAccountMenu()
      if (busy || checkingClient) return
      if (!oauthClient) {
        fillSettingsFields()
        showDrawer('settings')
        setSettingsMessage('error', 'Enter your Client ID and Client secret to continue.', [clientIdInput, clientSecretInput])
        return
      }
      await connectFromSettings()
    }

    accountChip.addEventListener('click', () => {
      if (accountMenu.hidden) openAccountMenu('list')
      else dismissAccountMenu()
    })
    accountBack.addEventListener('click', () => { showDrawer(null); openAccountMenu('list') })
    document.addEventListener('pointerdown', (event) => { if (modalResolve) return; if (!accountMenu.hidden && !accountSwitch.contains(event.target)) dismissAccountMenu() })
    // Clicking the Figma canvas moves focus out of the plugin: the account list folds away (not the settings or sign-in steps, which you may be copying into from another window).
    window.addEventListener('blur', () => { if (!accountMenu.hidden && accountMenu.dataset.view === 'list') closeAccountMenu() })
    // Esc always goes back exactly one step: sign-in → account list, client settings → account list,
    // account list → closed, folder picker → parent folder (or clears the search) → closed.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!ctxMenu.hidden) { event.preventDefault(); closeMenu(); return }
      const view = accountMenu.hidden ? '' : accountMenu.dataset.view
      if (view === 'auth') {
        event.preventDefault()
        if (authCancel.disabled) return // mid-connect: nothing to go back to yet
        cancelSignIn()
        openAccountMenu('list')
      } else if (view === 'settings') {
        event.preventDefault()
        showDrawer(null)
        openAccountMenu('list')
      } else if (view === 'list') {
        event.preventDefault()
        closeAccountMenu()
      } else if (drawerMode === 'picker') {
        event.preventDefault()
        if (!ctxMenu.hidden) closeMenu()
        else if (pickerMove) endMove()
        else if (picked.size) clearSelection()
        else if (pickerSearch.value) { pickerSearch.value = ''; void renderPicker() }
        else if (pickerStack.length) { pickerStack.pop(); void renderPicker() }
        else showDrawer(null)
      }
    })
    renderAccountSwitcher()

