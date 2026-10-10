    // ---- Rendering ----------------------------------------------------------------------------------------
    async function renderPicker(options) {
      const opts = options || {}
      const run = ++pickerRun
      const query = pickerSearch.value.trim()
      const container = pickerContainer()
      const focusId = pickerFocusId
      pickerFocusId = ''
      const scrollTop = pickerList.scrollTop
      if (!opts.keep) { picked.clear(); pickAnchor = '' }
      if (driveStatus.classList.contains('is-error')) setDriveStatus('', '') // an old error doesn't follow you into the next folder
      for (const tab of pickerTabs.querySelectorAll('.picker-tab')) tab.classList.toggle('is-active', tab.dataset.tab === pickerTab)
      pickerStar.classList.toggle('is-on', pickerTab === 'starred')
      pickerStar.setAttribute('aria-pressed', String(pickerTab === 'starred'))
      pickerBack.hidden = !pickerStack.length && !query
      renderCrumbs()
      updatePickerSelect()
      if (!opts.silent) pickerNote('Loading…', true)
      let folders
      let files = []
      try {
        const link = parseDriveItemLink(query)
        if (link) {
          const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(link.id)}?fields=id,name,mimeType,thumbnailLink,webViewLink,starred,size,modifiedTime,parents,shared&supportsAllDrives=true`)
          if (!response.ok) throw await driveError(response, 'link lookup')
          const item = await response.json()
          if (item.mimeType === FOLDER_MIME) { folders = [item]; files = [] }
          else { folders = []; files = [item] }
        } else {
          const [found, inside] = await Promise.all([
            listFolders(container, query),
            container.id === DRIVES_ID && !query ? [] : listFiles(container, query).catch(() => []),
          ])
          folders = sortEntries(found)
          files = sortEntries(inside)
        }
        // Remembering "the last place I visited" means on every successful navigation into a real folder,
        // not only when a folder gets used as an upload destination — browsing around without uploading
        // anything used to leave nothing saved at all, so the plugin always reopened at My Drive.
        if (pickerStack.length && !pickerMove && container.id !== (lastFolder && lastFolder.id)) saveLastFolder(container.id, container.name)
      } catch (error) {
        if (run !== pickerRun) return
        // The remembered folder (from a previous session) may since have been moved, renamed, or deleted —
        // fall back to My Drive once instead of just showing an error for a place that no longer resolves.
        if (pickerStack.length && !opts.fallbackTried) { pickerStack = []; void renderPicker({ ...opts, fallbackTried: true }); return }
        console.error(LOG, 'Could not list folders', error)
        pickerNote(error instanceof TypeError ? 'Couldn’t reach Google Drive. Check your connection.' : 'Couldn’t load the folders.')
        return
      }
      await drawerSettled // never reshuffle the list while the drawer is still sliding open
      if (run !== pickerRun) return
      pickerItems = [...folders.map((folder) => Object.assign(folder, { kind: 'folder' })), ...files.map((file) => Object.assign(file, { kind: 'file' }))]
      entryById.clear()
      elById.clear()
      for (const id of [...picked]) if (!pickerItems.some((item) => item.id === id)) picked.delete(id)
      if (!pickerItems.length) {
        pickerNote(emptyText(container, query))
        return
      }
      pickerList.textContent = ''
      if (folders.length && files.length) {
        const label = document.createElement('div')
        label.className = 'picker-files-label'
        label.textContent = 'Folders'
        pickerList.append(label)
      }
      if (folders.length) {
        // In grid view this becomes its own 2-column grid (see .picker-list.is-grid .picker-folders-body),
        // same as Drive's own grid view keeps folders as compact cards of their own rather than stretching
        // them to the same big thumbnail tiles as files. In list view it's unstyled, so folders stack
        // exactly as they always have.
        const foldersBody = document.createElement('div')
        foldersBody.className = 'picker-folders-body'
        folders.forEach((folder, index) => {
          const el = folderItem(folder)
          if (!opts.silent && index < 14) el.style.animationDelay = `${index * 18}ms`
          entryById.set(folder.id, folder)
          elById.set(folder.id, el)
          foldersBody.append(el)
        })
        pickerList.append(foldersBody)
      }
      if (files.length) {
        const block = document.createElement('div')
        block.className = 'picker-files'
        const label = document.createElement('div')
        label.className = 'picker-files-label'
        label.textContent = `${files.length}${files.more ? '+' : ''} file${files.length === 1 && !files.more ? '' : 's'}`
        const body = document.createElement('div')
        body.className = 'picker-files-body'
        for (const file of files) {
          const el = fileTile(file)
          entryById.set(file.id, file)
          elById.set(file.id, el)
          body.append(el)
        }
        block.append(label, body)
        if (!opts.silent) block.style.animationDelay = `${Math.min(folders.length, 14) * 18}ms`
        pickerList.append(block)
      }
      if (opts.silent) for (const el of pickerList.querySelectorAll('.picker-item, .picker-files')) el.style.animation = 'none'
      if (pickerMove) for (const id of pickerMove.ids) elById.get(id)?.classList.add('is-moving')
      pickerList.scrollTop = opts.keep ? scrollTop : 0
      if (focusId && elById.has(focusId)) { // a folder was just created: select it, bring it into view and flash it
        selectOnly(focusId)
        const created = elById.get(focusId)
        created.scrollIntoView({ block: 'nearest' })
        created.classList.add('is-flash')
      }
      syncSelection()
    }

    // ---- New folder: a name box appears at the top of the list; Enter creates, Esc cancels ------------
    function startNewFolder() {
      const container = pickerContainer()
      if (pickerSearch.value.trim() || VIRTUAL_IDS.includes(container.id)) return
      const existing = pickerList.querySelector('.picker-item.is-new input')
      if (existing) { existing.focus(); return }
      for (const note of pickerList.querySelectorAll('.picker-note')) note.remove()
      const item = document.createElement('div')
      item.className = 'picker-item is-new'
      item.innerHTML = `<span class="fi">${FOLDER_ICON}</span>`
      const input = document.createElement('input')
      input.className = 'new-folder-input'
      input.type = 'text'
      input.value = 'Untitled folder'
      input.spellcheck = false
      input.autocomplete = 'off'
      input.setAttribute('aria-label', 'New folder name')
      const ok = document.createElement('button')
      ok.type = 'button'
      ok.className = 'more-btn is-confirm'
      ok.innerHTML = CHECK_ICON
      ok.setAttribute('aria-label', 'Create folder')
      ok.addEventListener('mousedown', (event) => event.preventDefault()) // keep the focus in the name box
      item.append(input, ok)
      pickerList.prepend(item)
      pickerList.scrollTop = 0
      syncHeight()
      input.focus()
      input.select()
      let done = false
      const cancel = () => {
        if (done) return
        done = true
        item.remove()
        refreshPickerEmpty()
      }
      const commit = async () => {
        if (done) return
        const folderName = input.value.trim()
        if (!folderName) { cancel(); return }
        done = true
        input.disabled = true
        item.classList.add('is-busy')
        try {
          const response = await driveFetch(`${DRIVE_API}/files?supportsAllDrives=true&fields=id,name`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME, parents: [container.id] }),
          })
          if (!response.ok) throw await driveError(response, 'folder creation')
          pickerFocusId = (await response.json()).id
          await renderPicker({ silent: true })
        } catch (error) {
          console.warn(LOG, 'Could not create the folder', error)
          item.remove()
          failDrive(actionFailMessage(error, 'create a folder in'))
          refreshPickerEmpty()
        }
      }
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); void commit() }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
      })
      input.addEventListener('blur', () => { if (document.hasFocus()) cancel() })
      ok.addEventListener('click', () => { void commit() })
    }
    pickerNew.addEventListener('click', startNewFolder)

    // ---- Opening and closing the drawer -------------------------------------------------------------------
    async function openFolderPicker() {
      if (busy || checkingClient) return
      if (!oauthClient) {
        fillSettingsFields()
        showDrawer('settings')
        failDrive('Add your Google OAuth client to continue.')
        return
      }
      if (!tokens) {
        await connectFromSettings() // signs in first, then comes straight back here
        if (!tokens) return
      }
      // The very first time the picker opens in a session, start where the last upload left off (closing
      // and reopening the plugin remembers the folder); after that, the place is remembered in memory the
      // ordinary way (see below), same as it already was within one session.
      if (!lastFolderApplied) {
        if (!settingsLoaded) await Promise.race([storageReady, new Promise((resolve) => setTimeout(resolve, 1500))])
        lastFolderApplied = true
        if (lastFolder && lastFolder.id) { pickerTab = 'mine'; pickerStack = [{ id: lastFolder.id, name: lastFolder.name }] }
      }
      pickerSearch.value = '' // the place is remembered; an old search isn't
      updatePickerView()
      void renderPicker({ keep: true }) // fills in 'Loading…' straight away, so the drawer opens at a believable height
      showDrawer('picker')
    }

    function toggleDrawer() {
      if (drawerMode === 'picker') showDrawer(null)
      else void openFolderPicker()
    }
    driveFolderButton.addEventListener('click', toggleDrawer)

    pickerTabs.addEventListener('click', (event) => {
      const tab = event.target.closest('.picker-tab')
      if (!tab) return
      pickerTab = tab.dataset.tab
      pickerStack = []
      pickerRedoStack = []
      pickerSearch.value = ''
      void renderPicker()
    })
    pickerStar.addEventListener('click', () => {
      pickerTab = pickerTab === 'starred' ? 'mine' : 'starred'
      pickerStack = []
      pickerRedoStack = []
      pickerSearch.value = ''
      void renderPicker()
    })
    pickerViewListButton.addEventListener('click', () => {
      if (pickerView === 'list') return
      pickerView = 'list'
      updatePickerView()
      syncHeight()
    })
    pickerViewGridButton.addEventListener('click', () => {
      if (pickerView === 'grid') return
      pickerView = 'grid'
      updatePickerView()
      syncHeight()
    })
    pickerSortButton.addEventListener('click', () => {
      const items = SORT_OPTIONS.map((option) => ({
        label: option.label,
        icon: option.id === pickerSort ? CHECK_ICON : '<span style="display:inline-block;width:14px"></span>',
        run: () => {
          if (pickerSort === option.id) return
          pickerSort = option.id
          pickerSortButton.classList.toggle('is-on', pickerSort !== 'name')
          pickerSortButton.title = `Sort: ${option.label}`
          void renderPicker({ keep: true })
        },
      }))
      openMenu(items, pickerSortButton.getBoundingClientRect())
    })
    pickerSearch.addEventListener('input', () => {
      clearTimeout(pickerSearchTimer)
      pickerSearchTimer = setTimeout(() => { void renderPicker() }, 300)
    })
    pickerSearch.addEventListener('paste', () => {
      setTimeout(() => {
        clearTimeout(pickerSearchTimer)
        void renderPicker()
      }, 0)
    })
    pickerSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      clearTimeout(pickerSearchTimer)
      const link = parseDriveItemLink(pickerSearch.value)
      if (link) void openDriveItemLink(link)
      else void renderPicker()
    })
    pickerBack.addEventListener('click', () => {
      if (pickerSearch.value) pickerSearch.value = ''
      else if (pickerStack.length) pickerRedoStack.push(pickerStack.pop())
      void renderPicker()
    })
    // A permanent way back to My Drive from anywhere, however many folders deep — Back only undoes one
    // step at a time, which got tedious (and error-prone right after picking something, see syncSelection)
    // from several levels in.
    pickerHome.addEventListener('click', () => {
      if (pickerTab === 'mine' && !pickerStack.length && !pickerSearch.value) return
      pickerTab = 'mine'
      pickerStack = []
      pickerRedoStack = []
      pickerSearch.value = ''
      void renderPicker()
    })
