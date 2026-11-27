    // ---- Undo / redo for the picker's Drive actions, and the bar that offers it ---------------------------
    // Every reversible action the picker performs (move, rename, move to bin, star, make a copy, new folder)
    // records how to undo and redo itself. The latest one is offered as "Undo" in a Google Drive-style bar
    // over the bottom of the list, with "Go to folder" after a move; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (or
    // Ctrl+Y) walk the history while the picker has focus. History lasts for the session and is cleared when
    // the account changes. Sharing and uploads are deliberately not undoable: reversing them could remove
    // someone's access or a file in a way nobody expects.
    const pickerSnack = document.getElementById('picker-snack')
    const snackText = document.getElementById('picker-snack-text')
    const snackGoTo = document.getElementById('picker-snack-goto')
    const snackUndo = document.getElementById('picker-snack-undo')
    const snackClose = document.getElementById('picker-snack-close')
    const snackBar = document.getElementById('picker-snack-bar')
    const UNDO_LIMIT = 20
    const SNACK_MS = 8000
    let undoStack = [], redoStack = [], undoBusy = false
    let snackAction = null, snackTimer = 0, snackHideTimer = 0, snackDeadline = 0, snackLeft = 0

    function itemsLabel(items) { return items.length === 1 ? `“${items[0].name}”` : `${items.length} items` }
    function clearUndoHistory() { undoStack = []; redoStack = []; hideSnack() }

    function showSnack(text, action) {
      clearTimeout(snackTimer)
      clearTimeout(snackHideTimer)
      snackAction = action || null
      snackText.textContent = text
      snackText.title = text // the full message on hover when a long name is cut short
      snackUndo.hidden = !action
      snackGoTo.hidden = !(action && action.goTo)
      snackBar.style.transition = 'none'
      snackBar.style.transform = 'scaleX(1)'
      pickerSnack.hidden = false
      void pickerSnack.offsetWidth
      pickerSnack.classList.add('is-open')
      runSnackTimer(SNACK_MS)
    }
    // The thin bar along the bottom drains as the time runs out, so it is clear when the bar will go.
    function runSnackTimer(ms) {
      clearTimeout(snackTimer)
      snackDeadline = Date.now() + ms
      snackTimer = setTimeout(hideSnack, ms)
      snackBar.style.transition = `transform ${ms}ms linear`
      snackBar.style.transform = 'scaleX(0)'
    }
    function pauseSnackTimer() {
      clearTimeout(snackTimer)
      snackLeft = Math.max(0, snackDeadline - Date.now())
      // Freeze the bar where it is, as a scaleX() so it can animate on to scaleX(0) later (a matrix can't).
      const now = getComputedStyle(snackBar).transform
      const scale = now && now !== 'none' ? new DOMMatrixReadOnly(now).a : 1
      snackBar.style.transition = 'none'
      snackBar.style.transform = `scaleX(${scale})`
    }
    function hideSnack() {
      clearTimeout(snackTimer)
      snackAction = null
      if (pickerSnack.hidden) return
      pickerSnack.classList.remove('is-open')
      snackHideTimer = setTimeout(() => { if (!pickerSnack.classList.contains('is-open')) pickerSnack.hidden = true }, 200)
    }
    // Reading the bar (hovering it) holds it open and freezes the timer; it carries on when the pointer
    // leaves, with at least 3 seconds left.
    pickerSnack.addEventListener('mouseenter', () => { if (pickerSnack.classList.contains('is-open')) pauseSnackTimer() })
    pickerSnack.addEventListener('mouseleave', () => { if (pickerSnack.classList.contains('is-open')) runSnackTimer(Math.max(snackLeft, 3000)) })
    snackClose.addEventListener('click', hideSnack)
    snackUndo.addEventListener('click', () => { if (snackAction && snackAction === undoStack[undoStack.length - 1]) void undoLast() })
    snackGoTo.addEventListener('click', () => { const action = snackAction; hideSnack(); if (action && action.goTo) void action.goTo() })

    function recordAction(action) {
      undoStack.push(action)
      if (undoStack.length > UNDO_LIMIT) undoStack.shift()
      redoStack = []
      showSnack(action.message, action)
    }
    async function runHistory(direction) {
      if (undoBusy || pickerMove) return
      const action = (direction === 'undo' ? undoStack : redoStack).pop()
      if (!action) { showSnack(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo'); return }
      undoBusy = true
      hideSnack()
      setDriveStatus('busy', direction === 'undo' ? 'Undoing…' : 'Redoing…')
      try {
        await action[direction]()
        setDriveStatus('', '')
        if (direction === 'undo') { redoStack.push(action); showSnack(action.undoneMessage) }
        else { undoStack.push(action); showSnack(action.message, action) }
      } catch (error) {
        // A half-applied undo can't be replayed reliably, so the action leaves the history either way.
        console.warn(LOG, `Could not ${direction}`, error)
        failDrive(actionFailMessage(error, direction))
      } finally {
        undoBusy = false
        await renderPicker({ silent: true, keep: true })
      }
    }
    function undoLast() { return runHistory('undo') }
    function redoLast() { return runHistory('redo') }

    async function patchEach(ids, body, what) {
      for (const id of ids) {
        const response = await patchFile(id, body)
        if (!response.ok) throw await driveError(response, what)
      }
    }

    // ---- "Go to folder": where a moved item now lives ----------------------------------------------------
    // The caller usually knows the folder's path already (it was on screen); otherwise it is worked out from
    // the folder's parents, the same way Show location does.
    async function placeOfFolder(folder) {
      const rootId = await resolveFolderId('root')
      if (folder.id === 'root' || folder.id === rootId) return { tab: 'mine', stack: [] }
      const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(folder.id)}?fields=id,name,parents,driveId&supportsAllDrives=true`)
      if (!response.ok) throw await driveError(response, 'folder lookup')
      const item = await response.json()
      if (item.driveId && item.driveId === item.id) return { tab: 'drives', stack: [{ id: item.id, name: item.name, drive: true, shared: true }] }
      const place = await locateEntry(item)
      return { tab: place.tab, stack: [...place.stack, { id: item.id, name: item.name, kind: 'folder' }] }
    }
    async function goToFolder(folder, place, focusId) {
      try {
        const target = place || await placeOfFolder(folder)
        clearTimeout(pickerSearchTimer)
        pickerTab = target.tab
        pickerStack = target.stack.slice()
        pickerRedoStack = []
        pickerSearch.value = ''
        pickerFocusId = focusId || '' // renderPicker selects it, scrolls it into view and flashes it
        await renderPicker()
      } catch (error) {
        console.warn(LOG, 'Could not open the folder', error)
        failDrive(actionFailMessage(error, 'open'))
      }
    }

    // ---- The actions ---------------------------------------------------------------------------------------
    // moved: [{ id, name, from: parents before the move, to: destination id }]
    function recordMove(moved, folder, place) {
      const reparent = async (forward) => {
        for (const item of moved) {
          const others = item.from.filter((id) => id !== item.to)
          const add = forward ? [item.to] : others
          const remove = forward ? others : (item.from.includes(item.to) ? [] : [item.to])
          const query = `${add.length ? `&addParents=${encodeURIComponent(add.join(','))}` : ''}${remove.length ? `&removeParents=${encodeURIComponent(remove.join(','))}` : ''}`
          const response = await patchFile(item.id, {}, query)
          if (!response.ok) throw await driveError(response, 'move')
        }
      }
      recordAction({
        message: `Moved ${itemsLabel(moved)} to “${folder.name || 'folder'}”`,
        undoneMessage: `Moved ${itemsLabel(moved)} back`,
        undo: () => reparent(false),
        redo: () => reparent(true),
        goTo: () => goToFolder(folder, place, moved[0].id),
      })
    }
    function recordRename(entry, oldName, newName) {
      const setName = (name) => () => patchEach([entry.id], { name }, 'rename')
      recordAction({ message: `Renamed to “${newName}”`, undoneMessage: `Name changed back to “${oldName}”`, undo: setName(oldName), redo: setName(newName) })
    }
    function recordTrash(items) {
      const ids = items.map((item) => item.id)
      recordAction({
        message: `Moved ${itemsLabel(items)} to the bin`,
        undoneMessage: `Restored ${itemsLabel(items)}`,
        undo: () => patchEach(ids, { trashed: false }, 'restore'),
        redo: () => patchEach(ids, { trashed: true }, 'delete'),
      })
    }
    function recordStar(items, value) {
      const ids = items.map((item) => item.id)
      recordAction({
        message: value ? `Added ${itemsLabel(items)} to Starred` : `Removed ${itemsLabel(items)} from Starred`,
        undoneMessage: value ? 'Removed from Starred' : 'Added back to Starred',
        undo: () => patchEach(ids, { starred: !value }, 'star'),
        redo: () => patchEach(ids, { starred: value }, 'star'),
      })
    }
    // A copy or a new folder: undoing it moves it to the bin (recoverable there), redoing restores it.
    function recordCreated(item, message) {
      recordAction({
        message,
        undoneMessage: `Moved “${item.name}” to the bin`,
        undo: () => patchEach([item.id], { trashed: true }, 'delete'),
        redo: () => patchEach([item.id], { trashed: false }, 'restore'),
      })
    }
