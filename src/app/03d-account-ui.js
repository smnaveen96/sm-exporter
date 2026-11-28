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
      if (entry.via === 'own' && !oauthClient) return null
      const data = await refreshGrant(entry)
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
    // The photo / initial button opens the account list and the two ways to connect one: the quick sign-in
    // through SM exporter's OAuth Worker, and your own Client ID (one step further in, with the guide link).
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

    // view: 'list' (accounts and the ways to connect) | 'auth' (quick sign-in, waiting for the browser)
    //       | 'settings' (your own Client ID and secret) | 'auth-own' (paste the address back, own client)
    function openAccountMenu(view) {
      accountMenu.dataset.view = view
      accountList.hidden = view !== 'list'
      connectBlock.hidden = view !== 'list'
      drawerAuth.hidden = view !== 'auth'
      drawerSettings.hidden = view !== 'settings'
      drawerAuthOwn.hidden = view !== 'auth-own'
      accountBack.hidden = view === 'list'
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

    // Clicking away closes the menu, except mid sign-in, where Cancel or Esc ends it (the browser step, or
    // the address you're about to paste, isn't lost). A Drive call waiting for an account is cancelled.
    function dismissAccountMenu() {
      if (accountMenu.hidden) return
      const view = accountMenu.dataset.view
      if (view === 'auth' || view === 'auth-own') return
      if (view === 'settings') showDrawer(null)
      else closeAccountMenu()
      abandonSignInChoice()
    }
    // One step back: from a sign-in or the Client ID fields to the account list.
    function accountMenuBack() {
      const view = accountMenu.hidden ? '' : accountMenu.dataset.view
      if (view === 'auth') cancelSignIn()
      else if (view === 'auth-own') { if (!authOwnCancel.disabled) cancelOwnSignIn() }
      else if (view === 'settings') { showDrawer(null); openAccountMenu('list') }
    }

    // driveFetch reads `tokens` fresh on every call, so switching mid-transfer would finish an upload
    // (or download) with the other account's token against the first account's folder.
    function transferRunning() {
      if (!busy && !downloadRun) return false
      flashDriveStatus('Finish or cancel the current transfer first.', 2600)
      return true
    }
    function switchAccount(entry) {
      closeAccountMenu()
      if (signInWaiters.length) { // a Drive call waiting for an account: picking one answers it
        tokens = entry
        saveTokens()
        settleSignInWaiters(null)
        return
      }
      if (entry === tokens) return
      if (transferRunning()) return
      tokens = entry
      resetPickerLocation()
      if (drawerMode === 'picker') showDrawer(null)
      saveTokens()
      dropStaleTick()
      flashDriveStatus(`Using ${entry.account || 'Google Drive'}`, 2500)
    }

    async function confirmRemoveAccount(entry) {
      if (!entry) return
      if (entry === tokens && transferRunning()) return
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
    accountBack.addEventListener('click', accountMenuBack)
    document.addEventListener('pointerdown', (event) => { if (modalResolve) return; if (!accountMenu.hidden && !accountSwitch.contains(event.target)) dismissAccountMenu() })
    // Clicking the Figma canvas moves focus out of the plugin: the account list folds away, but sign-in stays available.
    // (Not while a Drive call is waiting for an account: that would cancel it.)
    window.addEventListener('blur', () => { if (!accountMenu.hidden && accountMenu.dataset.view === 'list' && !signInWaiters.length) closeAccountMenu() })
    // Esc goes back from sign-in to accounts, closes the account list, or navigates the folder picker.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!ctxMenu.hidden) { event.preventDefault(); closeMenu(); return }
      const view = accountMenu.hidden ? '' : accountMenu.dataset.view
      if (view === 'auth' || view === 'auth-own' || view === 'settings') {
        event.preventDefault()
        accountMenuBack()
      } else if (view === 'list') {
        event.preventDefault()
        closeAccountMenu()
        abandonSignInChoice()
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
