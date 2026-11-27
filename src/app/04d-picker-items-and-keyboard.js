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
      if (!isDriveRoot(entry)) { item.append(moreButton(entry)); item.draggable = true } // drag onto another folder to move it
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
      tile.draggable = true // onto another folder to move it; an image can also go straight onto the Figma canvas
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
    // ---- Dragging items: onto a folder (or a parent in the breadcrumb) moves them there; images released
    // over the Figma canvas are placed on it, as before. The selection is what moves: dragging an item that
    // isn't selected selects just it first, the same as Drive.
    let internalDrag = null // { entries, ids, handled, sourceEl, origin, sprung } while a drag that started in this list is in flight
    let dropTargetEl = null
    function setDropTarget(el) {
      if (dropTargetEl === el) return
      if (dropTargetEl) dropTargetEl.classList.remove('is-drop-target', 'is-spring')
      dropTargetEl = el
      if (el) el.classList.add('is-drop-target')
      armSpring(el)
    }
    // Where a drop at this event would move the dragged items: a folder in the list that isn't one of them,
    // or a parent crumb. Once a held folder has opened (see below), the empty space of the list too, which
    // moves them into the folder on show. Null when a drop there would do nothing.
    function dropFolderFor(event) {
      if (!internalDrag || pickerMove || !event.target.closest) return null
      const crumb = event.target.closest('.crumb[data-drop-id]')
      if (crumb && pickerPath.contains(crumb)) return { el: crumb, folder: { id: crumb.dataset.dropId, name: crumb.textContent }, place: { tab: pickerTab, stack: pickerStack.slice(0, Number(crumb.dataset.dropIndex)) }, crumb: true }
      if (!pickerList.contains(event.target)) return null
      const el = event.target.closest('[data-id]')
      if (el && pickerList.contains(el)) {
        const entry = entryById.get(el.dataset.id)
        if (!entry || internalDrag.ids.has(entry.id)) return null
        // Opening a folder from the list appends it to the current path (outside a search), so that's its path.
        if (entry.kind === 'folder') return { el, folder: entry, place: pickerSearch.value.trim() ? null : { tab: pickerTab, stack: [...pickerStack, entry] } }
      }
      return internalDrag.sprung ? hereTarget() : null
    }
    // The folder on show, as a drop target for its empty space: only a real folder (not a search or a list
    // like Shared with me), and not the one the drag started in, where dropping would move nothing.
    function hereTarget() {
      const folder = pickerTarget()
      if (!folder || folder.id === internalDrag.origin.containerId) return null
      return { el: pickerList, folder, place: { tab: pickerTab, stack: pickerStack.slice() } }
    }

    // ---- Spring-loaded folders, as in the Finder: holding a drag over a folder (or a parent crumb) opens it
    // so the items can be taken further in or back up. The highlight blinks just before it opens. Wherever
    // the drag ends — a drop, Esc, the canvas — the picker returns to the folder the drag started in; the
    // "Go to folder" button on the snackbar leads to where the items went.
    const SPRING_MS = 800
    const SPRING_BLINK_MS = 220
    let springTimer = 0
    function armSpring(el) {
      clearTimeout(springTimer)
      if (!el || el === pickerList || !internalDrag || moveInFlight) return
      springTimer = setTimeout(() => {
        if (dropTargetEl !== el || !internalDrag) return
        el.classList.add('is-spring')
        springTimer = setTimeout(() => { if (dropTargetEl === el && internalDrag) springOpen(el) }, SPRING_BLINK_MS)
      }, SPRING_MS)
    }
    // The tile the drag started from has to stay in the page: the browser sends the end of the drag to it,
    // and a tile cleared away with the old folder's list would never hear it. It waits off-screen instead.
    let dragPark = null
    function parkDragSource() {
      const el = internalDrag && internalDrag.sourceEl
      if (!el || !pickerList.contains(el)) return
      if (!dragPark) {
        dragPark = document.createElement('div')
        dragPark.setAttribute('aria-hidden', 'true')
        dragPark.style.cssText = 'position: fixed; top: -1000px; left: -1000px; width: 1px; height: 1px; overflow: hidden; pointer-events: none;'
      }
      if (!dragPark.parentNode) document.body.append(dragPark)
      dragPark.append(el)
    }
    function springOpen(el) {
      const target = { el, crumbIndex: el.dataset.dropIndex, id: el.dataset.id }
      setDropTarget(null)
      parkDragSource()
      internalDrag.sprung = true
      clearTimeout(pickerSearchTimer)
      if (target.crumbIndex != null) pickerStack = pickerStack.slice(0, Number(target.crumbIndex))
      else {
        const entry = entryById.get(target.id)
        if (!entry) return
        pickerStack.push(entry)
        pickerSearch.value = ''
      }
      pickerRedoStack = []
      console.log(LOG, 'Opened a folder held under a drag', pickerContainer().name)
      void renderPicker()
    }
    // Back to where the drag started. True when the view had moved and needs drawing again.
    function returnFromSpring(drag) {
      if (!drag || !drag.sprung) return false
      const origin = drag.origin
      pickerTab = origin.tab
      pickerStack = origin.stack.slice()
      pickerRedoStack = origin.redo.slice()
      pickerSearch.value = origin.search
      picked.clear()
      for (const id of origin.picked) picked.add(id) // the selection comes back with the folder
      return true
    }
    async function showOrigin(drag) {
      await renderPicker({ silent: true, keep: true })
      pickerList.scrollTop = drag.origin.scroll
    }
    // A safety net: if the end of a drag that opened folders never arrives, the first plain pointer move
    // afterwards (no button held, which can't happen mid-drag) ends it the same way as letting go elsewhere.
    document.addEventListener('mousemove', (event) => {
      const drag = internalDrag
      if (!drag || !drag.sprung || event.buttons !== 0) return
      console.warn(LOG, 'A drag that opened folders ended without telling the picker; returning to where it started')
      internalDrag = null
      pendingCanvasDrag = null
      setDropTarget(null)
      if (dragPark) { dragPark.textContent = ''; dragPark.remove() }
      if (returnFromSpring(drag)) void showOrigin(drag)
    }, true)
    // Near the top or bottom of the list, a drag scrolls it, so folders further along can be reached.
    const SCROLL_ZONE = 28
    function autoScroll(event) {
      const rect = pickerList.getBoundingClientRect()
      const top = event.clientY - rect.top, bottom = rect.bottom - event.clientY
      if (top >= 0 && top < SCROLL_ZONE) pickerList.scrollTop -= Math.ceil((SCROLL_ZONE - top) / 2)
      else if (bottom >= 0 && bottom < SCROLL_ZONE) pickerList.scrollTop += Math.ceil((SCROLL_ZONE - bottom) / 2)
    }

    for (const zone of [pickerList, pickerPath]) {
      zone.addEventListener('dragover', (event) => {
        if (internalDrag && zone === pickerList) autoScroll(event)
        const target = dropFolderFor(event)
        setDropTarget(target ? target.el : null)
        if (!target) return
        event.preventDefault() // accept the drop here
        event.dataTransfer.dropEffect = 'move'
      })
      zone.addEventListener('dragleave', (event) => {
        if (dropTargetEl && !dropTargetEl.contains(event.relatedTarget)) setDropTarget(null)
      })
      zone.addEventListener('drop', (event) => {
        const target = dropFolderFor(event)
        setDropTarget(null)
        if (!target) return
        event.preventDefault()
        const drag = internalDrag
        drag.handled = true
        const back = returnFromSpring(drag)
        void moveEntriesTo(drag.entries, target.folder, target.place).then(() => (back ? showOrigin(drag) : renderPicker({ silent: true, keep: true })))
      })
    }
    // More than one item gets a small "3 items" label as the drag image instead of whichever tile was grabbed.
    function dragLabel(count) {
      const label = document.createElement('div')
      label.className = 'drag-label'
      label.textContent = `${count} items`
      document.body.append(label)
      setTimeout(() => label.remove(), 0)
      return label
    }
    // One item drags a clean copy of its tile. Handing the browser the live tile made it snapshot the tile
    // mid-drag: faded by .is-dragging, and with the selection ring (a box-shadow outside the tile's box)
    // sliced off at the edges. The copy has no ring, no fade and no entry animation, sits in a stand-in
    // list so the grid/list tile styles still apply, and gets a solid backdrop when the tile has none
    // (list rows are transparent).
    function solidBackground(el) {
      for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor
        if (/^rgb\(/.test(color) || /^rgba\([^)]*,\s*1\)$/.test(color)) return color // fully opaque only
      }
      return getComputedStyle(document.body).backgroundColor || '#fff'
    }
    function dragGhost(tileEl) {
      const rect = tileEl.getBoundingClientRect()
      const wrap = document.createElement('div')
      wrap.className = pickerList.className.replace(/\bis-(moving|swiping)\b/g, '')
      wrap.setAttribute('aria-hidden', 'true')
      wrap.style.cssText = `position: fixed; top: -1000px; left: 0; width: ${Math.ceil(rect.width)}px; display: block; min-height: 0; max-height: none; overflow: visible; padding: 0; margin: 0; pointer-events: none;`
      const ghost = tileEl.cloneNode(true)
      ghost.classList.remove('is-picked', 'is-selected', 'is-dragging', 'is-drop-target', 'is-flash', 'is-busy', 'is-moving')
      ghost.removeAttribute('id')
      ghost.style.cssText += `; width: ${Math.ceil(rect.width)}px; height: ${Math.ceil(rect.height)}px; margin: 0; box-shadow: none; outline: none; opacity: 1; transform: none; animation: none; transition: none;`
      wrap.append(ghost)
      document.body.append(wrap)
      if (/rgba\([^)]*,\s*0\)$|transparent/.test(getComputedStyle(ghost).backgroundColor)) {
        ghost.style.background = solidBackground(tileEl)
        ghost.style.borderRadius = ghost.style.borderRadius || '8px'
      }
      setTimeout(() => wrap.remove(), 0) // the browser has taken its snapshot by then
      return ghost
    }
    pickerList.addEventListener('dragstart', (event) => {
      const entry = entryFromEvent(event)
      if (!entry || pickerMove || isDriveRoot(entry)) { event.preventDefault(); return }
      if (!picked.has(entry.id)) selectOnly(entry.id)
      const dragged = pickedEntries().filter((item) => !isDriveRoot(item))
      const origin = { tab: pickerTab, stack: pickerStack.slice(), redo: pickerRedoStack.slice(), search: pickerSearch.value, scroll: pickerList.scrollTop, picked: [...picked], containerId: pickerTarget() ? pickerTarget().id : '' }
      internalDrag = { entries: dragged, ids: new Set(dragged.map((item) => item.id)), handled: false, sprung: false, origin, sourceEl: event.target.closest('[draggable="true"]') || event.target }
      for (const item of dragged) elById.get(item.id)?.classList.add('is-dragging')
      event.dataTransfer.effectAllowed = 'copyMove'
      // A drag image is always set: a handful of embedded Chromium builds (Figma's desktop shell among them)
      // skip starting the drag at all when dataTransfer.setDragImage was never called, rather than falling
      // back to a default image. One item drags its own tile; several drag a count label.
      const tileEl = event.target.closest('[data-id]')
      try {
        if (dragged.length > 1) event.dataTransfer.setDragImage(dragLabel(dragged.length), 14, 14)
        else if (tileEl) {
          // Held at the point it was grabbed, so the copy doesn't jump under the pointer.
          const rect = tileEl.getBoundingClientRect()
          const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
          const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
          event.dataTransfer.setDragImage(dragGhost(tileEl), Math.round(x), Math.round(y))
        }
      } catch (error) { /* non-essential */ }
      const images = dragged.filter((item) => item.kind === 'file' && fileKind(item) === 'image')
      if (!images.length) { event.dataTransfer.setData('text/plain', dragged.map((item) => item.name).join('\n')); return }
      const payload = JSON.stringify({ smDriveImages: images.map((item) => ({ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size })) })
      event.dataTransfer.setData('text/plain', payload)
      // 'text' is the old (pre-"text/plain") name for the same format — some embedded/older Chromium
      // builds (which is what Figma's desktop shell is built on) still look for it specifically rather
      // than falling back to "text/plain". Costs nothing to set both.
      event.dataTransfer.setData('text', payload)
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
    // Heard on the document, since a drag that opened folders ends on the parked tile, outside the list.
    document.addEventListener('dragend', (event) => {
      const drag = internalDrag
      if (!drag || !(pickerList.contains(event.target) || (dragPark && dragPark.contains(event.target)))) return
      internalDrag = null
      setDropTarget(null)
      if (dragPark) { dragPark.textContent = ''; dragPark.remove() }
      for (const el of pickerList.querySelectorAll('.is-dragging')) el.classList.remove('is-dragging')
      if (!drag.handled && returnFromSpring(drag)) void showOrigin(drag) // let go elsewhere or Esc: back to the start
      const payload = pendingCanvasDrag
      pendingCanvasDrag = null
      if (!payload) return
      if (drag && drag.handled) return // dropped on a folder in the picker: that was a move, not a canvas drop
      const x = event.clientX, y = event.clientY
      const edge = edgeDistance(x, y)
      console.log(LOG, 'Drag ended', { clientX: x, clientY: y, edgeDistance: edge, buttons: event.buttons })
      if (edge > EDGE_ZONE) relayCanvasDrop(payload, x, y) // released out on the canvas
      else if (edge >= -EDGE_ZONE) awaitCanvasRelease(payload) // ended right at the plugin's edge: see below
      // else: let go inside the plugin, which is never a canvas drop (Figma's docs skip these too)
    })
    // How far (x, y) is outside the plugin window: negative inside, 0 on the edge.
    const EDGE_ZONE = 12
    function edgeDistance(x, y) {
      const w = window.innerWidth, h = window.innerHeight
      const outside = Math.max(-x, x - w, -y, y - h)
      return outside > 0 ? outside : -Math.min(x, w - x, y, h - y)
    }
    function relayCanvasDrop(payload, x, y) {
      window.parent.postMessage({ pluginDrop: { clientX: x, clientY: y, items: [{ type: 'text/plain', data: payload }] } }, '*')
      console.log(LOG, 'Relayed drag to Figma via postMessage pluginDrop', { clientX: x, clientY: y })
    }
    // In Figma's app the native drag can end the moment the pointer crosses out of the plugin, with the
    // button still held. Relaying then dropped the image at the plugin's edge before it was let go. A drag
    // that ends right at the edge therefore waits for the real release (the plugin keeps receiving the held
    // mouse's events), and places it there if that is out on the canvas. If the button turns out to be up
    // already (it was let go just at the edge, inside the plugin), nothing is placed.
    let canvasReleaseCleanup = null
    function awaitCanvasRelease(payload) {
      if (canvasReleaseCleanup) canvasReleaseCleanup()
      const finish = (event) => {
        cleanup()
        const edge = edgeDistance(event.clientX, event.clientY)
        console.log(LOG, 'Pointer released after the drag', { clientX: event.clientX, clientY: event.clientY, edgeDistance: edge })
        if (edge > 0) relayCanvasDrop(payload, event.clientX, event.clientY)
      }
      const move = (event) => { if (event.buttons === 0) { cleanup(); console.log(LOG, 'Drag let go at the plugin edge: nothing placed') } }
      const cleanup = () => {
        canvasReleaseCleanup = null
        clearTimeout(timer)
        window.removeEventListener('mouseup', finish, true)
        window.removeEventListener('pointerup', finish, true)
        window.removeEventListener('mousemove', move, true)
      }
      const timer = setTimeout(cleanup, 30000)
      window.addEventListener('mouseup', finish, true)
      window.addEventListener('pointerup', finish, true)
      window.addEventListener('mousemove', move, true)
      canvasReleaseCleanup = cleanup
    }

    // ---- Keyboard in the picker ------------------------------------------------------------------------
    document.addEventListener('keydown', (event) => {
      if (drawerMode !== 'picker' || modalResolve || previewOpen || !ctxMenu.hidden || !infoModal.hidden || !shareModal.hidden) return
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
      } else if (mod && (event.key.toLowerCase() === 'z' || (event.ctrlKey && event.key.toLowerCase() === 'y'))) {
        event.preventDefault() // text fields returned above, so their own undo is untouched
        if (event.shiftKey || event.key.toLowerCase() === 'y') void redoLast(); else void undoLast()
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

