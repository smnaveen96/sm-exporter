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
      if (!entry.refreshToken) return null
      const data = await workerRequest('/oauth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: entry.refreshToken }),
      })
      if (!data.access_token) throw new DriveError('OAuth refresh response did not contain an access token', 'Google Drive needs to reconnect. Please try again.')
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
    // The photo / initial button opens the account list and the Worker-based sign-in action.
    const accountList = document.getElementById('account-list')
    const accountBack = document.getElementById('account-back')

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
    }

    // view: 'list' (accounts and connect action) | 'auth' (Worker sign-in status)
    function openAccountMenu(view) {
      accountMenu.dataset.view = view
      accountList.hidden = view !== 'list'
      connectBlock.hidden = view !== 'list'
      drawerAuth.hidden = view !== 'auth'
      accountBack.hidden = view !== 'auth'
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

    // Keep the sign-in panel visible until the user cancels or the Worker completes.
    function dismissAccountMenu() {
      if (accountMenu.hidden) return
      const view = accountMenu.dataset.view
      if (view === 'auth') return
      closeAccountMenu()
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

    accountChip.addEventListener('click', () => {
      if (accountMenu.hidden) openAccountMenu('list')
      else dismissAccountMenu()
    })
    accountBack.addEventListener('click', () => cancelSignIn())
    document.addEventListener('pointerdown', (event) => { if (modalResolve) return; if (!accountMenu.hidden && !accountSwitch.contains(event.target)) dismissAccountMenu() })
    // Clicking the Figma canvas moves focus out of the plugin: the account list folds away, but sign-in stays available.
    window.addEventListener('blur', () => { if (!accountMenu.hidden && accountMenu.dataset.view === 'list') closeAccountMenu() })
    // Esc goes back from sign-in to accounts, closes the account list, or navigates the folder picker.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!ctxMenu.hidden) { event.preventDefault(); closeMenu(); return }
      const view = accountMenu.hidden ? '' : accountMenu.dataset.view
      if (view === 'auth') {
        event.preventDefault()
        cancelSignIn()
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
