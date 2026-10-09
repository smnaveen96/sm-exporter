    // ---- Breadcrumbs: My Drive › Print Files › Thank you Card ▾ -------------------------------------
    function renderCrumbs() {
      const query = pickerSearch.value.trim()
      pickerPath.textContent = ''
      pickerPath.classList.add('crumbs')
      if (query) {
        const label = document.createElement('span')
        label.className = 'crumb is-current'
        label.textContent = `Results for “${query}”`
        pickerPath.append(label)
        return
      }
      const trail = [PICKER_ROOTS[pickerTab], ...pickerStack]
      trail.forEach((folder, index) => {
        if (index) { const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; pickerPath.append(sep) }
        const last = index === trail.length - 1
        const crumb = document.createElement('button')
        crumb.type = 'button'
        crumb.className = `crumb${last ? ' is-current' : ''}`
        crumb.textContent = folder.name
        crumb.title = folder.name // the full name on hover, since a long one still ellipsises
        if (last) crumb.setAttribute('aria-current', 'location')
        crumb.addEventListener('click', () => {
          if (last) return
          pickerStack = pickerStack.slice(0, index)
          pickerRedoStack = []
          void renderPicker()
        })
        pickerPath.append(crumb)
      })
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'crumb-more'
      more.innerHTML = ICONS.chevron
      more.setAttribute('aria-label', 'Folder actions')
      more.addEventListener('click', (event) => {
        event.stopPropagation()
        const container = pickerContainer()
        const items = []
        if (!pickerNew.disabled) items.push({ label: 'New folder', icon: ICONS.newFolder, run: startNewFolder })
        items.push({ label: 'Open in Drive', icon: ICONS.external, run: () => post({ type: 'open-url', url: containerUrl(container) }) })
        items.push({ label: 'Copy link', icon: ICONS.link, run: () => copyText(containerUrl(container)) })
        openMenu(items, more.getBoundingClientRect())
      })
      pickerPath.append(more)
      // The trail scrolls rather than clips, so land it on the end (the current folder) by default —
      // scrolling back reveals the parents. One scroll listener (attached once) fades the left mask out
      // once there's nothing more to scroll back to.
      pickerPath.scrollLeft = pickerPath.scrollWidth
      pickerPath.classList.toggle('is-at-start', pickerPath.scrollLeft <= 0)
      if (!pickerPath.dataset.scrollBound) {
        pickerPath.dataset.scrollBound = '1'
        pickerPath.addEventListener('scroll', () => {
          pickerPath.classList.toggle('is-at-start', pickerPath.scrollLeft <= 1)
        })
      }
    }

    // ---- Selection ---------------------------------------------------------------------------------
    function syncSelection() {
      for (const [id, el] of elById) {
        const on = picked.has(id)
        el.classList.toggle('is-picked', on)
        el.setAttribute('aria-selected', String(on))
      }
      const count = picked.size
      const showSelBar = Boolean(count) && !pickerMove
      // Both bars live permanently in the same fixed-height slot (see .picker-toolbar); this class just
      // cross-fades which one is visible, so the slot's box never changes size and nothing below it moves.
      pickerToolbar.classList.toggle('is-selecting', showSelBar)
      // The title row only exists at all as the Move-to pop-up's header now — there's no more static
      // "Choose a folder" label taking up a row while just browsing.
      pickerTop.hidden = !pickerMove
      selCount.textContent = `${count} selected`
      const entries = [...picked].map((id) => entryById.get(id)).filter(Boolean)
      document.getElementById('sel-download').disabled = !entries.some((entry) => entry.kind === 'file')
      document.getElementById('sel-move').disabled = entries.some(isDriveRoot)
      document.getElementById('sel-trash').disabled = entries.some(isDriveRoot)
      if (pickerMove) pickerTitle.textContent = `Move ${pickerMove.ids.size} item${pickerMove.ids.size === 1 ? '' : 's'} to…`
      syncHeight()
    }

    function selectOnly(id) { picked.clear(); picked.add(id); pickAnchor = id; syncSelection() }

    function clickSelect(entry, event) {
      const additive = event.metaKey || event.ctrlKey
      if (event.shiftKey && pickAnchor && entryById.has(pickAnchor)) {
        const from = pickerItems.findIndex((item) => item.id === pickAnchor)
        const to = pickerItems.findIndex((item) => item.id === entry.id)
        if (!additive) picked.clear()
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) picked.add(pickerItems[i].id)
      } else if (additive) {
        if (picked.has(entry.id)) picked.delete(entry.id); else picked.add(entry.id)
        pickAnchor = entry.id
      } else {
        picked.clear()
        picked.add(entry.id)
        pickAnchor = entry.id
      }
      syncSelection()
    }

    function pickedEntries() { return [...picked].map((id) => entryById.get(id)).filter(Boolean) }
    function clearSelection() { if (!picked.size) return false; picked.clear(); pickAnchor = ''; syncSelection(); return true }

    // ---- Context menu (the ⋮ buttons and right-click) ------------------------------------------------
    function closeMenu() { ctxMenu.hidden = true; ctxMenu.textContent = '' }
    function openMenu(items, anchor) {
      ctxMenu.textContent = ''
      for (const item of items) {
        if (item.sep) { const sep = document.createElement('div'); sep.className = 'ctx-sep'; ctxMenu.append(sep); continue }
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `ctx-item${item.danger ? ' is-danger' : ''}`
        button.disabled = Boolean(item.disabled)
        button.setAttribute('role', 'menuitem')
        button.innerHTML = `${item.icon || ''}<span></span>`
        button.lastChild.textContent = item.label
        button.addEventListener('click', () => { closeMenu(); item.run() })
        ctxMenu.append(button)
      }
      ctxMenu.hidden = false
      const width = ctxMenu.offsetWidth
      const height = ctxMenu.offsetHeight
      const x = anchor.right !== undefined ? anchor.right - width : anchor.x
      const y = anchor.bottom !== undefined ? anchor.bottom + 4 : anchor.y
      const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
      const top = y + height > window.innerHeight - 8 ? Math.max(8, (anchor.top !== undefined ? anchor.top - 4 : y) - height) : y
      ctxMenu.style.left = `${Math.round(left)}px`
      ctxMenu.style.top = `${Math.round(top)}px`
      const first = ctxMenu.querySelector('.ctx-item:not(:disabled)')
      if (first) first.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', (event) => { if (!ctxMenu.hidden && !ctxMenu.contains(event.target)) closeMenu() }, true)
    window.addEventListener('blur', closeMenu)
    pickerList.addEventListener('scroll', closeMenu, { passive: true })
    ctxMenu.addEventListener('keydown', (event) => {
      const buttons = [...ctxMenu.querySelectorAll('.ctx-item:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement)
      if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(at + 1) % buttons.length].focus() }
      else if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length].focus() }
    })

    function menuFor(entries) {
      const one = entries.length === 1 ? entries[0] : null
      const files = entries.filter((entry) => entry.kind === 'file')
      const roots = entries.some(isDriveRoot)
      const images = files.filter((entry) => fileKind(entry) === 'image')
      const allStarred = entries.every((entry) => entry.starred)
      const items = []
      if (one && one.kind === 'folder') items.push({ label: 'Open', icon: ICONS.open, run: () => openPickerFolder(one) })
      if (one && one.kind === 'file') items.push({ label: 'Preview', icon: ICONS.eye, run: () => openPreview(one) })
      if (one) items.push({ label: 'Open in Drive', icon: ICONS.external, run: () => post({ type: 'open-url', url: driveUrl(one) }) })
      if (files.length) items.push({ label: files.length > 1 ? `Download ${files.length} files` : 'Download', icon: ICONS.download, run: () => { void downloadEntries(files) } })
      if (images.length && images.length === entries.length) items.push({ label: 'Place on canvas', icon: ICONS.canvas, run: () => { void placeOnCanvas(images) } })
      if (!roots) {
        items.push({ sep: true })
        if (one) items.push({ label: 'Rename', icon: ICONS.rename, run: () => { void renameEntry(one) } })
        if (one && one.kind === 'file') items.push({ label: 'Make a copy', icon: ICONS.copy, run: () => { void copyEntry(one) } })
        items.push({ label: allStarred ? 'Remove from starred' : 'Add to starred', icon: ICONS.star, run: () => { void starEntries(entries, !allStarred) } })
        items.push({ label: 'Move to…', icon: ICONS.move, run: () => startMove(entries) })
        if (one) items.push({ label: 'Share…', icon: ICONS.share, run: () => openShareDialog(one) })
      }
      items.push({ label: entries.length > 1 ? 'Copy links' : 'Copy link', icon: ICONS.link, run: () => copyText(entries.map(driveUrl).join('\n')) })
      if (!roots) {
        items.push({ sep: true })
        items.push({ label: 'Move to bin', icon: TRASH_ICON, danger: true, run: () => { void trashEntries(entries) } })
      }
      return items
    }

    function menuForTarget(entry, anchor) {
      if (!picked.has(entry.id)) selectOnly(entry.id)
      openMenu(menuFor(pickedEntries()), anchor)
    }

    // ---- Actions -----------------------------------------------------------------------------------
    const patchFile = (id, body, query) => driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?supportsAllDrives=true${query || ''}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body),
    })
    function actionFailMessage(error, what) {
      if (error instanceof TypeError) return 'Couldn’t reach Google Drive. Check your connection.'
      if (error && (error.status === 401 || error.status === 403)) return `You don’t have permission to ${what} this.`
      return `Couldn’t ${what} this. Please try again.`
    }

    async function renameEntry(entry) {
      const name = await confirmDialog({ title: 'Rename', input: entry.name, confirmLabel: 'OK', danger: false })
      if (!name || name === entry.name) return
      try {
        const response = await patchFile(entry.id, { name })
        if (!response.ok) throw await driveError(response, 'rename')
        await renderPicker({ silent: true, keep: true })
      } catch (error) { failDrive(actionFailMessage(error, 'rename')) }
    }

    async function copyEntry(entry) {
      setDriveStatus('busy', 'Making a copy…')
      try {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(entry.id)}/copy?supportsAllDrives=true&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ name: `Copy of ${entry.name}` }),
        })
        if (!response.ok) throw await driveError(response, 'copy')
        setDriveStatus('', '')
        flashDriveStatus('Copy created', 2200)
        await renderPicker({ silent: true, keep: true })
      } catch (error) { failDrive(actionFailMessage(error, 'copy')) }
    }

    async function starEntries(entries, value) {
      for (const entry of entries) entry.starred = value
      try {
        for (const entry of entries) {
          const response = await patchFile(entry.id, { starred: value })
          if (!response.ok) throw await driveError(response, 'star')
        }
        await renderPicker({ silent: true, keep: true })
      } catch (error) {
        failDrive(actionFailMessage(error, 'star'))
        await renderPicker({ silent: true, keep: true })
      }
    }

    async function trashEntries(entries) {
      entries = entries.filter((entry) => !isDriveRoot(entry))
      if (!entries.length) return
      const folders = entries.filter((entry) => entry.kind === 'folder').length
      const one = entries.length === 1 ? entries[0] : null
      const ok = await confirmDialog({
        title: one ? `Move “${one.name}” to bin?` : `Move ${entries.length} items to bin?`,
        message: `${folders ? 'Folders go with everything inside them. ' : ''}You can restore ${one ? 'it' : 'them'} from the bin in Google Drive.`,
        confirmLabel: 'Move to bin',
      })
      if (!ok) return
      for (const entry of entries) elById.get(entry.id)?.classList.add('is-busy')
      let failed = 0
      let lastError = null
      for (const entry of entries) {
        try {
          const response = await patchFile(entry.id, { trashed: true })
          if (!response.ok) throw await driveError(response, 'delete')
          const el = elById.get(entry.id)
          if (el) el.classList.add('is-removing')
          picked.delete(entry.id)
        } catch (error) {
          failed++
          lastError = error
          elById.get(entry.id)?.classList.remove('is-busy')
        }
      }
      if (failed) failDrive(actionFailMessage(lastError, 'move to the bin'))
      await new Promise((resolve) => setTimeout(resolve, 190))
      await renderPicker({ silent: true, keep: true })
      if (!failed) flashDriveStatus(`Moved ${entries.length === 1 ? '1 item' : `${entries.length} items`} to the bin`, 2600)
    }

