    // ---- Resizing the window from its corner, while Drive folders is open --------------------------------
    // Resizing belongs to browsing Drive: the grip in the bottom-right corner is there only while the
    // Drive folders list is open. Dragging it makes the window wider and taller; the extra height goes to the
    // folder list. Closing the list takes the window back to its usual size, and opening it again grows the
    // window to the size chosen, along with the drawer's own animation (animateResize in 03a). The usual size
    // is the smallest it goes; double-clicking the grip goes back to it. The size is remembered for next time
    // (code.js keeps it).
    const PANEL_MIN_WIDTH = 386 // PANEL_WIDTH in code.ts
    const PANEL_MAX_WIDTH = 1200
    const PANEL_MAX_HEIGHT = 1000
    const LIST_MIN_HEIGHT = 115 // .picker-list's own min-height
    let listHeight = 0 // the folder list's chosen height; 0 = its usual height
    let chosenWidth = PANEL_MIN_WIDTH // the window's width while Drive folders is open
    let gripDrag = null, gripFrame = 0

    const resizeGrip = document.createElement('div')
    resizeGrip.className = 'resize-grip'
    resizeGrip.setAttribute('aria-hidden', 'true')
    resizeGrip.title = 'Drag to resize · double-click for the usual size'
    document.body.append(resizeGrip)

    function folderListOpen() { return document.body.classList.contains('is-picking') }
    // Read by panelWidth() in 03a for every resize of the window.
    function currentPanelWidth() { return folderListOpen() ? chosenWidth : PANEL_MIN_WIDTH }

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
    function postPanelSize(save) {
      post({ type: 'resize', width: currentPanelWidth(), height: contentHeight(), save: save ? savedSize() : undefined })
    }

    function savedSize() { return { width: chosenWidth, listHeight } }

    // ---- Dragging the grip ---------------------------------------------------------------------------------
    // The window's bottom edge follows the pointer, and the folder list takes up whatever height that leaves.
    // The usual size is the smallest it goes: the list never gets shorter than its usual height.
    let usualListHeight = 0, usualAtWidth = 0 // the list's usual height, measured at the window's current width
    function measureUsualList() {
      const had = listHeight
      document.body.classList.add('no-anim')
      applyListHeight(0)
      const usual = pickerList.getBoundingClientRect().height
      applyListHeight(had)
      void document.body.offsetHeight
      document.body.classList.remove('no-anim')
      return usual
    }
    function gripStep() {
      gripFrame = 0
      const drag = gripDrag
      if (!drag) return
      if (drag.sizing) {
        if (!usualListHeight || usualAtWidth !== window.innerWidth) { usualListHeight = measureUsualList(); usualAtWidth = window.innerWidth }
        const rest = contentHeight() - pickerList.getBoundingClientRect().height
        const list = drag.target - rest
        applyListHeight(list > usualListHeight + 1 ? list : 0)
      }
      if (!resizeLocked) postPanelSize(false)
      if (drag.released) finishGripDrag()
    }

    resizeGrip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !folderListOpen() || gripDrag) return
      event.preventDefault()
      resizeGrip.setPointerCapture(event.pointerId) // the window's top-left corner stays put as it grows, so page coordinates track the pointer
      const height = contentHeight()
      usualListHeight = 0
      gripDrag = {
        x: event.clientX, y: event.clientY,
        width: window.innerWidth, height,
        target: height, // the window height the pointer asks for
        sizing: folderListShowing(), // the height goes to the folder list, so only while it's showing
        released: false,
      }
      document.body.classList.add('is-resizing')
    })
    resizeGrip.addEventListener('pointermove', (event) => {
      if (!gripDrag || gripDrag.released) return
      // The button came up somewhere this page never heard about (outside the plugin window): the drag is over.
      if (event.buttons === 0) { endGripDrag(event); return }
      if (!resizeGrip.hasPointerCapture(event.pointerId)) return
      chosenWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(gripDrag.width + event.clientX - gripDrag.x)))
      gripDrag.target = Math.min(PANEL_MAX_HEIGHT, gripDrag.height + event.clientY - gripDrag.y)
      if (!gripFrame) gripFrame = requestAnimationFrame(gripStep)
    })
    function finishGripDrag() {
      gripDrag = null
      cancelAnimationFrame(gripFrame)
      gripFrame = 0
      document.body.classList.remove('is-resizing')
      postPanelSize(true)
    }
    function endGripDrag(event) {
      if (!gripDrag || gripDrag.released) return
      gripDrag.released = true
      if (event && resizeGrip.hasPointerCapture(event.pointerId)) resizeGrip.releasePointerCapture(event.pointerId)
      if (!gripFrame) gripFrame = requestAnimationFrame(gripStep) // a last step, then the size is saved
    }
    resizeGrip.addEventListener('pointerup', endGripDrag)
    resizeGrip.addEventListener('pointercancel', endGripDrag)
    // Figma can take the pointer away mid-drag (the window resizing under it, a click outside the plugin).
    // Without these the resize cursor stayed on the whole window after the drag had really ended.
    resizeGrip.addEventListener('lostpointercapture', endGripDrag)
    window.addEventListener('blur', () => endGripDrag(null))
    document.addEventListener('pointerdown', (event) => { if (gripDrag && event.target !== resizeGrip) endGripDrag(null) }, true)
    resizeGrip.addEventListener('dblclick', () => {
      if (!folderListOpen()) return
      chosenWidth = PANEL_MIN_WIDTH
      applyListHeight(0)
      postPanelSize(true)
    })

    // The size chosen last time, from code.js's storage. It shows the next time Drive folders opens (or now,
    // if it already is).
    window.addEventListener('message', (event) => {
      const message = event.data && event.data.pluginMessage
      if (!message || message.type !== 'panel-size' || !message.size) return
      const size = message.size
      chosenWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.round(Number(size.width) || PANEL_MIN_WIDTH)))
      applyListHeight(Number(size.listHeight) || 0)
      if (folderListOpen()) postPanelSize(false)
    })
    post({ type: 'panel-size-get' })
