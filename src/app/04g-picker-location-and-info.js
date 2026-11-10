    // ---- "Show location" and "File info" (⋮ menu) --------------------------------------------------
    // A search result, or an item in Starred / Shared with me / a shared drive listing, carries only its
    // parent folder's id (Drive's `parents`). Walking that chain upwards gives the full path, which is
    // what both of these need: Show location opens the folder with the item selected, File info shows
    // the path as text next to the size, dates and owner.
    const infoModal = document.getElementById('info-modal')
    const infoIcon = document.getElementById('info-icon')
    const infoTitle = document.getElementById('info-title')
    const infoRows = document.getElementById('info-rows')
    const infoLocate = document.getElementById('info-locate')
    const infoOpen = document.getElementById('info-open')
    const infoDone = document.getElementById('info-done')
    let infoEntry = null, infoHideTimer = 0, infoRun = 0, infoReturnFocus = null

    function fmtBytes(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return ''
      if (n < 1024) return `${n} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let v = n / 1024, i = 0
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
    }
    function fmtDateTime(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    }
    const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Audio', pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slide: 'Presentation', zip: 'Archive', other: 'File' }
    function typeLabel(entry) {
      if (entry.kind === 'folder') return 'Folder'
      const mime = String(entry.mimeType || '')
      if (mime.startsWith('application/vnd.google-apps.')) return `Google ${mime.slice('application/vnd.google-apps.'.length).replace(/^./, (c) => c.toUpperCase())}`
      const kind = fileKind(entry)
      const sub = (mime.split('/')[1] || '').replace(/^x-/, '').split(/[;+.]/)[0]
      if (kind === 'pdf' || !sub || sub === 'octet-stream') return KIND_LABEL[kind]
      return `${KIND_LABEL[kind]} (${sub.length <= 5 ? sub.toUpperCase() : sub})`
    }

    // Walks the parents chain up to a root. Resolves { tab, stack } in the picker's own terms: which tab
    // the item lives under and the folders to open, nearest-the-root first — ready for renderPicker.
    async function locateEntry(entry) {
      const chain = [] // nearest parent first
      let parentId = (entry.parents || [])[0]
      for (let depth = 0; parentId && depth < 24; depth += 1) {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(parentId)}?fields=id,name,parents,driveId&supportsAllDrives=true`)
        if (!response.ok) break // a parent this account can't read: the chain stops at what it can see
        const folder = await response.json()
        if (folder.driveId && folder.driveId === folder.id) { // a shared drive's own top level
          return { tab: 'drives', stack: [{ id: folder.id, name: folder.name, drive: true, shared: true }, ...chain.reverse()] }
        }
        if (!folder.parents || !folder.parents.length) { // My Drive itself, or the top of something shared with me
          if (folder.id === await resolveFolderId('root')) return { tab: 'mine', stack: chain.reverse() }
          chain.push({ id: folder.id, name: folder.name, kind: 'folder' })
          return { tab: 'shared', stack: chain.reverse() }
        }
        chain.push({ id: folder.id, name: folder.name, kind: 'folder' })
        parentId = folder.parents[0]
      }
      // No parent at all, or the walk hit a folder this account can't open: whatever was readable, under
      // Shared with me (an item shared directly is listed there at the top level).
      return { tab: chain.length || entry.shared ? 'shared' : 'mine', stack: chain.reverse() }
    }
    function pathText(place) {
      return [PICKER_ROOTS[place.tab].name, ...place.stack.map((folder) => folder.name)].join(' › ')
    }

    async function showLocation(entry) {
      if (isDriveRoot(entry)) return
      closeInfoDialog()
      setDriveStatus('busy', 'Finding location…')
      try {
        const place = await locateEntry(entry)
        setDriveStatus('', '')
        clearTimeout(pickerSearchTimer)
        pickerTab = place.tab
        pickerStack = place.stack
        pickerRedoStack = []
        pickerSearch.value = ''
        pickerFocusId = entry.id // renderPicker selects it, scrolls it into view and flashes it
        await renderPicker()
      } catch (error) {
        console.warn(LOG, 'Could not find the location', error)
        failDrive(actionFailMessage(error, 'locate'))
      }
    }

    function infoRow(label, value, pending) {
      const dt = document.createElement('dt')
      dt.textContent = label
      const dd = document.createElement('dd')
      dd.textContent = value
      if (pending) dd.classList.add('is-pending')
      infoRows.append(dt, dd)
      return dd
    }
    async function showFileInfo(entry) {
      if (isDriveRoot(entry)) return
      closeMenu()
      const run = ++infoRun
      infoEntry = entry
      infoIcon.innerHTML = entry.kind === 'folder' ? (entry.shared ? SHARED_FOLDER_ICON : FOLDER_ICON) : typeIcon(fileKind(entry))
      infoIcon.style.color = entry.kind === 'folder' ? 'var(--muted)' : ''
      infoTitle.textContent = entry.name
      infoRows.textContent = ''
      // What's already known from the listing goes up at once; size / dates / owner / path fill in below.
      infoRow('Type', typeLabel(entry))
      const sizeRow = infoRow('Size', entry.kind === 'folder' ? '—' : fmtBytes(entry.size) || (isNativeGoogle(entry) ? '—' : '…'), entry.kind !== 'folder' && !fmtBytes(entry.size) && !isNativeGoogle(entry))
      const modifiedRow = infoRow('Modified', fmtDateTime(entry.modifiedTime) || '…', !entry.modifiedTime)
      const createdRow = infoRow('Created', '…', true)
      const ownerRow = infoRow('Owner', '…', true)
      const locationRow = infoRow('Location', 'Finding…', true)
      infoLocate.hidden = false
      infoReturnFocus = document.activeElement
      clearTimeout(infoHideTimer)
      infoModal.hidden = false
      void infoModal.offsetWidth
      infoModal.classList.add('is-open')
      infoDone.focus()
      // Two independent lookups: the item's own details, and its folder path.
      const details = driveFetch(`${DRIVE_API}/files/${encodeURIComponent(entry.id)}?fields=id,name,mimeType,size,createdTime,modifiedTime,owners(displayName,emailAddress),driveId,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)&supportsAllDrives=true`)
        .then(async (response) => { if (!response.ok) throw await driveError(response, 'details'); return response.json() })
      details.then((item) => {
        if (run !== infoRun) return
        if (item.size !== undefined) { sizeRow.textContent = fmtBytes(item.size); sizeRow.classList.remove('is-pending') }
        else if (entry.kind !== 'folder') { sizeRow.textContent = '—'; sizeRow.classList.remove('is-pending') }
        if (item.modifiedTime) { modifiedRow.textContent = fmtDateTime(item.modifiedTime); modifiedRow.classList.remove('is-pending') }
        createdRow.textContent = fmtDateTime(item.createdTime) || '—'
        createdRow.classList.remove('is-pending')
        const owner = (item.owners || [])[0]
        ownerRow.textContent = owner ? (owner.displayName || owner.emailAddress || '—') : item.driveId ? 'Shared drive' : '—'
        ownerRow.classList.remove('is-pending')
        const dims = item.imageMediaMetadata && item.imageMediaMetadata.width ? item.imageMediaMetadata : item.videoMediaMetadata && item.videoMediaMetadata.width ? item.videoMediaMetadata : null
        if (dims) {
          const extra = dims.durationMillis ? `${dims.width} × ${dims.height}, ${formatClock(Number(dims.durationMillis) / 1000)}` : `${dims.width} × ${dims.height}`
          infoRow('Dimensions', extra)
        }
      }).catch((error) => {
        if (run !== infoRun) return
        console.warn(LOG, 'Could not load the file details', error)
        for (const dd of [sizeRow, modifiedRow, createdRow, ownerRow]) if (dd.classList.contains('is-pending')) { dd.textContent = '—'; dd.classList.remove('is-pending') }
      })
      locateEntry(entry).then((place) => {
        if (run !== infoRun) return
        locationRow.textContent = pathText(place)
        locationRow.classList.remove('is-pending')
      }).catch((error) => {
        if (run !== infoRun) return
        console.warn(LOG, 'Could not find the location', error)
        locationRow.textContent = '—'
        locationRow.classList.remove('is-pending')
      })
    }
    function closeInfoDialog() {
      if (infoModal.hidden) return
      infoRun += 1
      infoModal.classList.remove('is-open')
      infoHideTimer = setTimeout(() => { infoModal.hidden = true }, 200)
      const back = infoReturnFocus
      infoReturnFocus = null
      if (back && back.isConnected && typeof back.focus === 'function' && !back.disabled) back.focus({ preventScroll: true })
    }
    infoDone.addEventListener('click', closeInfoDialog)
    infoOpen.addEventListener('click', () => { if (infoEntry) post({ type: 'open-url', url: driveUrl(infoEntry) }) })
    infoLocate.addEventListener('click', () => { if (infoEntry) void showLocation(infoEntry) })
    infoModal.addEventListener('pointerdown', (event) => { if (event.target === infoModal) closeInfoDialog() })
    window.addEventListener('keydown', (event) => {
      if (infoModal.hidden || !infoModal.classList.contains('is-open')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeInfoDialog() }
    }, true)
