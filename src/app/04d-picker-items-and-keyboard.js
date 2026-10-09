    // ---- Items -------------------------------------------------------------------------------------
    function moreButton(entry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'more-btn'
      button.innerHTML = MORE_ICON
      button.setAttribute('aria-label', `Actions for ${entry.name}`)
      button.setAttribute('aria-haspopup', 'menu')
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        if (pickerMove) return
        menuForTarget(entry, button.getBoundingClientRect())
      })
      button.addEventListener('dblclick', (event) => event.stopPropagation())
      return button
    }

    function folderItem(entry) {
      const item = document.createElement('div')
      item.className = 'picker-item'
      item.tabIndex = 0
      item.dataset.id = entry.id
      item.setAttribute('role', 'option')
      const icon = document.createElement('span')
      icon.className = 'fi'
      icon.innerHTML = (entry.shared ? SHARED_FOLDER_ICON : FOLDER_ICON) + (entry.starred ? `<span class="fi-star">${STAR_ICON}</span>` : '')
      const name = document.createElement('span')
      name.className = 'fi-name'
      name.textContent = entry.name
      item.append(icon, name)
      if (!isDriveRoot(entry)) item.append(moreButton(entry))
      return item
    }

    function thumbUrl(link, size) { return String(link).replace(/=s\d+(-c)?$/, `=s${size}`) }

    function fileTile(entry) {
      const kind = fileKind(entry)
      const tile = document.createElement('div')
      tile.className = 'picker-file'
      tile.tabIndex = 0
      tile.dataset.id = entry.id
      tile.setAttribute('role', 'option')
      if (kind === 'image') tile.draggable = true // drag it straight onto the Figma canvas
      const head = document.createElement('div')
      head.className = 'pf-head'
      const ico = document.createElement('span')
      ico.className = 'pf-ico'
      ico.innerHTML = typeIcon(kind)
      const name = document.createElement('span')
      name.className = 'pf-name'
      name.textContent = entry.name
      const date = document.createElement('span')
      date.className = 'pf-date'
      date.textContent = fmtDate(entry.modifiedTime)
      head.append(ico, name, date, moreButton(entry))
      const thumb = document.createElement('div')
      thumb.className = 'pf-thumb'
      thumb.innerHTML = `<span class="pf-big">${typeIcon(kind)}</span>`
      if (entry.thumbnailLink) { // Google's own preview; the type icon stays if it can't be loaded
        const img = new Image()
        img.alt = ''
        img.loading = 'lazy'
        img.decoding = 'async'
        img.draggable = false
        img.referrerPolicy = 'no-referrer'
        img.onload = () => img.classList.add('is-loaded')
        img.onerror = () => img.remove()
        img.src = thumbUrl(entry.thumbnailLink, 360)
        thumb.append(img)
      }
      if (kind === 'video') thumb.insertAdjacentHTML('beforeend', PLAY_BADGE)
      tile.append(head, thumb)
      return tile
    }

    function openPickerFolder(entry) {
      pickerStack.push(entry)
      pickerRedoStack = []
      pickerSearch.value = ''
      void renderPicker()
    }

    function openEntry(entry) {
      if (entry.kind === 'folder') openPickerFolder(entry)
      else openPreview(entry)
    }

    // One set of listeners on the list handles every item.
    function entryFromEvent(event) {
      const el = event.target.closest('[data-id]')
      return el && pickerList.contains(el) ? entryById.get(el.dataset.id) : null
    }
    pickerList.addEventListener('click', (event) => {
      const entry = entryFromEvent(event)
      if (!entry) { if (!event.target.closest('.picker-files-label')) clearSelection(); return }
      if (pickerMove) { if (entry.kind === 'folder' && !pickerMove.ids.has(entry.id)) openPickerFolder(entry); return }
      clickSelect(entry, event)
    })
    pickerList.addEventListener('dblclick', (event) => {
      const entry = entryFromEvent(event)
      if (!entry || pickerMove && entry.kind === 'file') return
      if (pickerMove && pickerMove.ids.has(entry.id)) return
      openEntry(entry)
    })
    pickerList.addEventListener('contextmenu', (event) => {
      const entry = entryFromEvent(event)
      if (!entry || pickerMove) return
      event.preventDefault()
      menuForTarget(entry, { x: event.clientX, y: event.clientY })
    })
    pickerList.addEventListener('dragstart', (event) => {
      const entry = entryFromEvent(event)
      if (!entry || entry.kind !== 'file' || fileKind(entry) !== 'image') { event.preventDefault(); return }
      if (!picked.has(entry.id)) selectOnly(entry.id)
      const images = pickedEntries().filter((item) => item.kind === 'file' && fileKind(item) === 'image')
      event.dataTransfer.effectAllowed = 'copy'
      const payload = JSON.stringify({ smDriveImages: images.map((item) => ({ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size })) })
      event.dataTransfer.setData('text/plain', payload)
      // 'text' is the old (pre-"text/plain") name for the same format — some embedded/older Chromium
      // builds (which is what Figma's desktop shell is built on) still look for it specifically rather
      // than falling back to "text/plain". Costs nothing to set both.
      event.dataTransfer.setData('text', payload)
      // A handful of embedded Chromium builds don't auto-generate a drag thumbnail the way a full browser
      // does, and skip starting the drag at all when dataTransfer.setDragImage was never called — rather
      // than falling back to some default image. Giving it the tile itself covers that case and is a
      // perfectly normal drag thumbnail otherwise.
      const tileEl = event.target.closest('[data-id]')
      if (tileEl) { try { event.dataTransfer.setDragImage(tileEl, 16, 16) } catch (error) { /* non-essential */ } }
      pendingCanvasDrag = payload // handed to the dragend listener below, which is the path that actually reaches the canvas
      // Visible in the UI iframe's own devtools console (right-click the plugin → Inspect) — confirms the
      // drag actually started and what it's carrying, which is the first thing to check if a drop onto
      // the canvas still doesn't do anything: if this never logs, the drag isn't starting at all (a CSS
      // or event-delegation issue in here); if it logs but nothing places, the drop isn't reaching
      // figma.on('drop') in code.js, or code.js wasn't rebuilt/reloaded with that handler.
      console.log(LOG, 'Drag started for canvas drop', payload)
    })
    // The dataTransfer-based native drag above is what shows the drag ghost and would work for a drop
    // that lands back inside this same page — but a drop that lands on the actual Figma canvas crosses
    // out of this iframe entirely, and Figma's own plugin docs are explicit that native drop events don't
    // reliably survive that crossing in every host and browser (this is likely the whole reason dragging
    // onto the canvas was never working, no matter how correctly the dataTransfer side was wired up).
    // Their documented fix is this: alongside the native drag, relay the same payload to Figma's host
    // directly via postMessage on dragend, using the pluginDrop message shape their own sample plugins
    // use — Figma turns that into a real drop event on its side, into the very same figma.on('drop')
    // handler in code.js, so nothing there needs to change to receive it.
    pickerList.addEventListener('dragend', (event) => {
      const payload = pendingCanvasDrag
      pendingCanvasDrag = null
      if (!payload) return
      window.parent.postMessage({
        pluginDrop: {
          clientX: event.clientX,
          clientY: event.clientY,
          items: [{ type: 'text/plain', data: payload }],
        },
      }, '*')
      console.log(LOG, 'Relayed drag to Figma via postMessage pluginDrop', { clientX: event.clientX, clientY: event.clientY })
    })

    // ---- Keyboard in the picker ------------------------------------------------------------------------
    document.addEventListener('keydown', (event) => {
      if (drawerMode !== 'picker' || modalResolve || previewOpen || !ctxMenu.hidden) return
      const target = event.target
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const mod = event.metaKey || event.ctrlKey
      const onButton = target && target.closest && target.closest('button')
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        if (pickerMove) return
        for (const item of pickerItems) picked.add(item.id)
        pickAnchor = pickAnchor || (pickerItems[0] && pickerItems[0].id) || ''
        syncSelection()
      } else if (event.key === ' ' && !onButton) {
        const focusId = target && target.dataset && target.dataset.id
        const entry = (focusId && entryById.get(focusId)) || pickedEntries().filter((item) => item.kind === 'file').pop()
        if (!entry) return
        event.preventDefault()
        if (entry.kind === 'file') { if (!picked.has(entry.id)) selectOnly(entry.id); openPreview(entry) }
      } else if ((event.key === 'Delete' || (event.key === 'Backspace' && mod)) && picked.size && !pickerMove) {
        event.preventDefault()
        void trashEntries(pickedEntries())
      } else if (event.key === 'Enter' && !onButton && picked.size === 1) {
        event.preventDefault()
        openEntry(pickedEntries()[0])
      } else if (/^Arrow(Down|Right|Up|Left)$/.test(event.key) && pickerItems.length && !pickerMove) {
        event.preventDefault()
        const ids = [...picked]
        const current = pickerItems.findIndex((item) => item.id === (ids[ids.length - 1] || ''))
        const step = /Down|Right/.test(event.key) ? 1 : -1
        const next = Math.max(0, Math.min(pickerItems.length - 1, current < 0 ? 0 : current + step))
        const entry = pickerItems[next]
        if (event.shiftKey) clickSelect(entry, { shiftKey: true, metaKey: false, ctrlKey: false }); else selectOnly(entry.id)
        const el = elById.get(entry.id)
        if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }) }
      }
    })

