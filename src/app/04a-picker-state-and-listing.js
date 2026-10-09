    // ---- Folder picker -----------------------------------------------------------------------------
    // Shown when the link field is empty and the upload button is pressed. Laid out like Google's own
    // folder picker: tabs, search, grid / list; click a folder to open it. "Upload here"
    // uses the folder on show and starts the upload straight away.
    const FOLDER_MIME = 'application/vnd.google-apps.folder'
    const SHARED_ID = 'shared-with-me'
    const DRIVES_ID = 'shared-drives'
    const STARRED_ID = 'starred-folders'
    const VIRTUAL_IDS = [SHARED_ID, DRIVES_ID, STARRED_ID] // lists, not places a file can go
    const PICKER_ROOTS = {
      mine: { id: 'root', name: 'My Drive' },
      shared: { id: SHARED_ID, name: 'Shared with me' },
      drives: { id: DRIVES_ID, name: 'Shared drives' },
      starred: { id: STARRED_ID, name: 'Starred' },
    }
    const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>'
    const SHARED_FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-5 3c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm4 8h-8v-1c0-1.33 2.67-2 4-2s4 .67 4 2v1z"/></svg>'
    const STAR_ICON = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.7l5.9-.9z"/></svg>'
    const pickerStar = document.getElementById('picker-star')
    // Two plain buttons (list, grid) rather than one toggle that swapped its own icon — each just
    // highlights itself (is-on) when it's the active view, the same highlight pattern the sort/star
    // icons already use, with nothing else (no checkmark) layered on top.
    const pickerViewListButton = document.getElementById('picker-view-list')
    const pickerViewGridButton = document.getElementById('picker-view-grid')
    const pickerSortButton = document.getElementById('picker-sort-button')
    const pickerTabs = document.getElementById('picker-tabs')
    const pickerToolbar = document.getElementById('picker-toolbar')
    const pickerSearch = document.getElementById('picker-search')
    const pickerHead = pickerBack.parentElement
    const pickerSummary = document.getElementById('picker-summary')
    let pickerTab = 'mine'
    let pickerStack = []      // folders opened inside the tab; empty = the tab's own top level
    let pickerRedoStack = []  // folders just swiped/clicked back out of, so a forward swipe can return to them
    let pickerSelected = null // the folder highlighted in the list
    let pickerView = 'grid'
    let pickerSort = 'name'   // 'name' | 'name-desc' | 'date' | 'date-desc' — folders and files sort the same way
    let pickerRun = 0
    let pickerSearchTimer = 0

    const SORT_OPTIONS = [
      { id: 'name', label: 'Name (A–Z)' },
      { id: 'name-desc', label: 'Name (Z–A)' },
      { id: 'date', label: 'Last modified (newest)' },
      { id: 'date-desc', label: 'Last modified (oldest)' },
    ]
    function sortEntries(list) {
      const byDate = pickerSort.startsWith('date')
      const desc = pickerSort.endsWith('-desc')
      const compare = byDate
        ? (a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0)
        : (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true })
      return [...list].sort((a, b) => (desc ? -1 : 1) * compare(a, b))
    }

    const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>'
    const IMAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l5-5 4 4 2-2 3 3"/></svg>'

    // The formats chosen above, shown while the export options are folded away.
    function updatePickerSummary() {
      const scale = (id) => { const select = document.getElementById(id); return select ? ` ${select.options[select.selectedIndex].text}` : '' }
      const parts = []
      if (checked('jpeg')) parts.push(`JPEG${scale('jpeg-scale')}`)
      if (checked('pdf-image')) parts.push('PDF — Image')
      if (checked('png')) parts.push(`PNG${scale('png-scale')}`)
      if (checked('webp')) parts.push(`WebP${scale('webp-scale')}`)
      if (checked('svg')) parts.push('SVG')
      if (checked('pdf-vector')) parts.push(`PDF ${pdfModeSelect.options[pdfModeSelect.selectedIndex].text}`)
      pickerSummary.textContent = parts.length ? parts.join(' · ') : 'No format selected'
    }

    // ---- State ------------------------------------------------------------------------------------
    // Where you were is remembered while the plugin stays open: closing the drawer and opening it again
    // puts you back in the same folder.
    const pickerTitle = document.getElementById('picker-title')
    const pickerTop = document.getElementById('picker-top')
    const pickerTopClose = document.getElementById('picker-top-close')
    const pickerAnchor = document.getElementById('picker-anchor')
    const selBar = document.getElementById('picker-selbar')
    const selCount = document.getElementById('sel-count')
    const ctxMenu = document.getElementById('ctx-menu')
    let pickerItems = []          // folders then files, in the order they are drawn
    const entryById = new Map()   // id → entry
    const elById = new Map()      // id → element
    const picked = new Set()      // ids of the selected items
    let pendingCanvasDrag = null   // the payload from the drag currently in flight, for the dragend handler below
    let pickAnchor = ''           // where a shift-selection starts from
    let pickerMove = null         // { ids: Set } while choosing a place to move items to
    let pickerFocusId = ''

    function resetPickerLocation() { pickerTab = 'mine'; pickerStack = []; pickerRedoStack = []; pickerSearch.value = ''; picked.clear(); pickerMove = null }

    // ---- File types --------------------------------------------------------------------------------
    const TYPE_STYLE = {
      image: { color: '#e8553d', glyph: '<path d="M5.5 17.5l4-5.5 3 4 2-2.5 4 4z" fill="#fff"/><circle cx="16" cy="8.5" r="1.7" fill="#fff"/>' },
      video: { color: '#d93a3a', glyph: '<path d="M9.5 7.5v9l7.5-4.5z" fill="#fff"/>' },
      pdf: { color: '#e8553d', glyph: '<text x="12" y="15" text-anchor="middle" font-size="7.4" font-weight="700" font-family="Arial,Helvetica,sans-serif" fill="#fff">PDF</text>' },
      doc: { color: '#4285f4', glyph: '<path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5.5" stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none"/>' },
      sheet: { color: '#0f9d58', glyph: '<path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h9M12 8v8" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>' },
      slide: { color: '#f4b400', glyph: '<rect x="6.8" y="8.2" width="10.4" height="7.6" rx="1.2" stroke="#fff" stroke-width="1.6" fill="none"/>' },
      audio: { color: '#e8553d', glyph: '<path d="M10.5 16V8.2l5.5-1.4v7.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="9" cy="16.2" r="1.7" fill="#fff"/><circle cx="14.5" cy="14.4" r="1.7" fill="#fff"/>' },
      zip: { color: '#5f6368', glyph: '<path d="M12 6.5v3M12 11v3M12 15.5v2" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>' },
      other: { color: '#7a7d82', glyph: '<path d="M8 6.5h6l3 3v8H8z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" fill="none"/>' },
    }
    function fileKind(entry) {
      const mime = String(entry.mimeType || '')
      if (mime.startsWith('image/')) return 'image'
      if (mime.startsWith('video/')) return 'video'
      if (mime.startsWith('audio/')) return 'audio'
      if (mime === 'application/pdf') return 'pdf'
      if (/spreadsheet|ms-excel|csv/.test(mime)) return 'sheet'
      if (/presentation|powerpoint/.test(mime)) return 'slide'
      if (/document|msword|wordprocessing|text\//.test(mime)) return 'doc'
      if (/zip|compressed|x-tar|rar|7z/.test(mime)) return 'zip'
      return 'other'
    }
    function typeIcon(kind) {
      const style = TYPE_STYLE[kind] || TYPE_STYLE.other
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="4.2" fill="${style.color}"/>${style.glyph}</svg>`
    }
    const PLAY_BADGE = '<span class="pf-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 7v10l8.5-5z" fill="currentColor"/></svg></span>'
    const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg>'
    const svgLine = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
    const ICONS = {
      open: svgLine('<path d="M5 12h14M13 6l6 6-6 6"/>'),
      eye: svgLine('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
      external: svgLine('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
      download: svgLine('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
      rename: svgLine('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
      copy: svgLine('<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
      move: svgLine('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13h6M13.5 10.5L16 13l-2.5 2.5"/>'),
      share: svgLine('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4"/>'),
      star: svgLine('<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.9l-5.25 2.8 1-5.85L3.5 9.7l5.9-.9z"/>'),
      link: svgLine('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
      canvas: svgLine('<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 15.5l5-5 4 4 2.5-2.5 5.5 5.5"/>'),
      newFolder: svgLine('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v5M9.5 12.5h5"/>'),
      close: svgLine('<path d="M6 6l12 12M18 6L6 18"/>'),
      prev: svgLine('<path d="M15 5l-7 7 7 7"/>'),
      next: svgLine('<path d="M9 5l7 7-7 7"/>'),
      chevron: svgLine('<path d="M6 9l6 6 6-6"/>'),
    }
    const MEDIA_LIMIT = { image: 30e6, video: 250e6, pdf: 80e6 }

    function fmtDate(value) {
      if (!value) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const sameYear = date.getFullYear() === new Date().getFullYear()
      return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
    }
    const isNativeGoogle = (entry) => String(entry.mimeType || '').startsWith('application/vnd.google-apps.')
    const isDriveRoot = (entry) => Boolean(entry && entry.drive)

    function driveUrl(entry) {
      if (entry.kind === 'folder' || entry.mimeType === FOLDER_MIME) return `https://drive.google.com/drive/folders/${entry.id}`
      return entry.webViewLink || `https://drive.google.com/file/d/${entry.id}/view`
    }
    function containerUrl(container) {
      if (container.id === 'root') return 'https://drive.google.com/drive/my-drive'
      if (container.id === SHARED_ID) return 'https://drive.google.com/drive/shared-with-me'
      if (container.id === STARRED_ID) return 'https://drive.google.com/drive/starred'
      if (container.id === DRIVES_ID) return 'https://drive.google.com/drive/shared-drives'
      return `https://drive.google.com/drive/folders/${container.id}`
    }
    function copyText(text) {
      const done = () => flashDriveStatus('Link copied', 2200)
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done)); return }
      legacyCopy(text, done)
    }
    function legacyCopy(text, done) {
      const box = document.createElement('textarea')
      box.value = text
      box.style.cssText = 'position:fixed;opacity:0;left:-9999px'
      document.body.append(box)
      box.select()
      try { document.execCommand('copy'); done() } catch { failDrive('Couldn’t copy the link.') }
      box.remove()
    }

    // ---- Listing -----------------------------------------------------------------------------------
    function pickerContainer() { return pickerStack[pickerStack.length - 1] || PICKER_ROOTS[pickerTab] }

    // Uploads always go to the folder you are looking at (never a list or search results).
    function pickerTarget() {
      const container = pickerContainer()
      return pickerSearch.value.trim() || VIRTUAL_IDS.includes(container.id) ? null : container
    }

    function updatePickerSelect() {
      const container = pickerContainer()
      const query = pickerSearch.value.trim()
      const place = Boolean(pickerTarget())
      if (pickerMove) {
        pickerSelect.textContent = 'Move here'
        pickerSelect.disabled = !place || pickerMove.ids.has(container.id)
      } else {
        pickerSelect.textContent = driveSubmit.disabled ? 'Use folder' : 'Upload here' // nothing to upload yet → just remember the folder
        pickerSelect.disabled = !place
      }
      pickerNew.disabled = Boolean(query) || VIRTUAL_IDS.includes(container.id)
    }

    function updatePickerView() {
      pickerList.classList.toggle('is-grid', pickerView === 'grid')
      pickerViewListButton.classList.toggle('is-on', pickerView === 'list')
      pickerViewGridButton.classList.toggle('is-on', pickerView === 'grid')
    }

    async function listFolders(container, query) {
      if (container.id === DRIVES_ID && !query) {
        const found = []
        let pageToken = ''
        do {
          const more = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
          const response = await driveFetch(`${DRIVE_API}/drives?pageSize=100&fields=nextPageToken,drives(id,name)${more}`)
          if (!response.ok) throw await driveError(response, 'folder listing')
          const data = await response.json()
          for (const drive of (data.drives || [])) found.push({ id: drive.id, name: drive.name, drive: true, shared: true })
          pageToken = data.nextPageToken || ''
        } while (pageToken)
        return found
      }
      const clauses = [`mimeType = '${FOLDER_MIME}'`, 'trashed = false']
      let corpora = 'allDrives'
      if (query) clauses.push(`name contains '${query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      else if (container.id === SHARED_ID) { clauses.push('sharedWithMe = true'); corpora = 'user' }
      else if (container.id === STARRED_ID) { clauses.push('starred = true'); corpora = 'user' }
      else clauses.push(`'${container.id}' in parents`)
      const q = encodeURIComponent(clauses.join(' and '))
      const folders = []
      let pageToken = ''
      do {
        const more = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
        const response = await driveFetch(`${DRIVE_API}/files?q=${q}&corpora=${corpora}&fields=nextPageToken,files(id,name,shared,starred,parents,modifiedTime)&orderBy=name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${more}`)
        if (!response.ok) throw await driveError(response, 'folder listing')
        const data = await response.json()
        folders.push(...(data.files || []))
        pageToken = data.nextPageToken || ''
      } while (pageToken && folders.length < 1000)
      return folders
    }

    // The files in a folder, in a search, in Starred or in Shared with me.
    async function listFiles(container, query) {
      const clauses = [`mimeType != '${FOLDER_MIME}'`, 'trashed = false']
      let corpora = 'allDrives'
      if (query) clauses.push(`name contains '${query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      else if (container.id === SHARED_ID) { clauses.push('sharedWithMe = true'); corpora = 'user' }
      else if (container.id === STARRED_ID) { clauses.push('starred = true'); corpora = 'user' }
      else clauses.push(`'${container.id}' in parents`)
      const q = encodeURIComponent(clauses.join(' and '))
      const response = await driveFetch(`${DRIVE_API}/files?q=${q}&corpora=${corpora}&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,starred,size,modifiedTime,parents)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`)
      if (!response.ok) throw await driveError(response, 'file listing')
      const data = await response.json()
      const files = data.files || []
      files.more = Boolean(data.nextPageToken)
      return files
    }

    async function resolveFolderId(id) {
      if (id !== 'root') return id
      const response = await driveFetch(`${DRIVE_API}/files/root?fields=id`)
      if (!response.ok) throw await driveError(response, 'folder lookup')
      return (await response.json()).id
    }

    function pickerNote(text, loading) {
      const note = document.createElement('div')
      note.className = `picker-note${loading ? ' is-loading' : ''}`
      note.textContent = text
      pickerList.textContent = ''
      pickerList.append(note)
      pickerItems = []
      entryById.clear()
      elById.clear()
      syncSelection()
      syncHeight()
    }

    function emptyText(container, query) {
      return query ? 'Nothing matches your search.' : container.id === SHARED_ID ? 'Nothing is shared with you.' : container.id === DRIVES_ID ? 'No shared drives.' : container.id === STARRED_ID ? 'Nothing is starred.' : 'This folder is empty.'
    }
    function refreshPickerEmpty() {
      if (!pickerList.querySelector('.picker-item, .picker-file, .picker-note')) pickerNote(emptyText(pickerContainer(), pickerSearch.value.trim()))
      syncHeight()
    }

