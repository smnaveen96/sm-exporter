    // ---- Resizing the window from its corner ----------------------------------------------------------
    // The window opens at its usual size, which is also the smallest it goes. Dragging the grip in the
    // bottom-right corner makes it wider (the frame strip and the folder grid use the room) and, while the
    // Drive folders list is open, taller: the extra height goes to the list. Double-clicking the grip goes
    // back to the usual size. The size is remembered for next time (code.js keeps it).
    const PANEL_MIN_WIDTH = 386 // PANEL_WIDTH in code.ts
    const PANEL_MAX_WIDTH = 1200
    const PANEL_MAX_HEIGHT = 1000
    const LIST_MIN_HEIGHT = 115 // .picker-list's own min-height
    let listHeight = 0 // the folder list's chosen height; 0 = its usual height
    let gripDrag = null, gripFrame = 0

    const resizeGrip = document.createElement('div')
    resizeGrip.className = 'resize-grip'
    resizeGrip.setAttribute('aria-hidden', 'true')
    resizeGrip.title = 'Drag to resize · double-click for the usual size'
    document.body.append(resizeGrip)

    // The list never gets shorter than it would be anyway: the size only sets a floor and lifts the ceiling
    // (see body.has-list-size in the styles).
    function applyListHeight(height) {
      listHeight = height > LIST_MIN_HEIGHT ? Math.round(height) : 0
      document.body.classList.toggle('has-list-size', listHeight > 0)
      if (listHeight) document.body.style.setProperty('--list-h', `${listHeight}px`)
      else document.body.style.removeProperty('--list-h')
    }
    function folderListShowing() {
      return drawerMode === 'picker' && !document.body.classList.contains('is-moving') && !previewOpen && pickerList.getClientRects().length > 0
    }
    function postPanelSize(width, save) {
      post({ type: 'resize', width, height: contentHeight(), save: save ? { width, listHeight } : undefined })
    }

    resizeGrip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      resizeGrip.setPointerCapture(event.pointerId) // the window's top-left corner stays put as it grows, so page coordinates track the pointer
      const showing = folderListShowing()
      let usual = 0
      if (showing) { const had = listHeight; applyListHeight(0); usual = pickerList.getBoundingClientRect().height; applyListHeight(had) }
      gripDrag = {
        x: event.clientX, y: event.clientY,
        width: window.innerWidth,
        list: showing ? pickerList.getBoundingClientRect().height : null,
        usual, // the list's height with no size chosen: dragged back to it (or less) clears the size
        room: PANEL_MAX_HEIGHT - contentHeight(), // the window can't go past PANEL_MAX_HEIGHT
        nextWidth: window.innerWidth,
      }
      document.body.classList.add('is-resizing')
    })
    resizeGrip.addEventListener('pointermove', (event) => {
      if (!gripDrag || !resizeGrip.hasPointerCapture(event.pointerId)) return
      gripDrag.nextWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(gripDrag.width + event.clientX - gripDrag.x)))
      if (gripDrag.list !== null) {
        const height = gripDrag.list + Math.min(event.clientY - gripDrag.y, gripDrag.room)
        applyListHeight(height > gripDrag.usual + 1 ? height : 0)
      }
      if (gripFrame) return
      gripFrame = requestAnimationFrame(() => { gripFrame = 0; if (gripDrag) postPanelSize(gripDrag.nextWidth, false) })
    })
    function endGripDrag(event) {
      if (!gripDrag) return
      const width = gripDrag.nextWidth
      gripDrag = null
      cancelAnimationFrame(gripFrame)
      gripFrame = 0
      if (resizeGrip.hasPointerCapture(event.pointerId)) resizeGrip.releasePointerCapture(event.pointerId)
      document.body.classList.remove('is-resizing')
      postPanelSize(width, true)
    }
    resizeGrip.addEventListener('pointerup', endGripDrag)
    resizeGrip.addEventListener('pointercancel', endGripDrag)
    resizeGrip.addEventListener('dblclick', () => {
      applyListHeight(0)
      postPanelSize(PANEL_MIN_WIDTH, true)
    })

    // The size chosen last time, from code.js's storage.
    window.addEventListener('message', (event) => {
      const message = event.data && event.data.pluginMessage
      if (!message || message.type !== 'panel-size' || !message.size) return
      const size = message.size
      applyListHeight(Number(size.listHeight) || 0)
      const width = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Number(size.width) || PANEL_MIN_WIDTH))
      if (width !== PANEL_MIN_WIDTH || listHeight) postPanelSize(width, false)
    })
    post({ type: 'panel-size-get' })
