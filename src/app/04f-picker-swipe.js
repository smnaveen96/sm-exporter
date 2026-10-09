// ---- Two-finger horizontal swipe through folder history, like a browser's back/forward swipe -------
    // A trackpad's horizontal two-finger swipe arrives here as a plain wheel event with a dominant deltaX
    // (there's no separate "swipe" event to listen for) — the same deltaX+ctrlKey-free signal a pinch
    // uses deltaY+ctrlKey for above. It rides the exact same folder history the Back button already
    // keeps, with a small redo stack added alongside it so a forward swipe can return to a folder just
    // swiped back out of, the same way browser back/forward does.
    // The fast-flick/slow-hold classification itself lives in SwipeAxis (see swipe-gesture.js, inlined
    // just above — kept as its own small file specifically so it can be driven with synthetic wheel-event
    // timing and checked by assertion instead of only by hand on a real trackpad; see swipe-gesture.test.js
    // for the exact fast/slow cases this was tuned against). What's here is just the DOM glue: feeding
    // wheel events in, easing the arrow's on-screen position toward the raw value so it doesn't visually
    // jump, and acting on whatever SwipeAxis decides once it calls this a release.
    const pickerSwipeAxis = new SwipeAxis({ now: () => performance.now(), quietMs: 350, quietHoldMs: 450 })
    let pickerSwipeDisplay = 0
    let pickerSwipeRaf = 0
    let pickerSwipeResetTimer = 0
    function setPickerSwipeRatio(back, fwd) {
      pickerList.style.setProperty('--swipe-back', String(back))
      pickerList.style.setProperty('--swipe-fwd', String(fwd))
    }
    function pickerSwipeTick() {
      const accum = pickerSwipeAxis.accum
      pickerSwipeDisplay = accum
      setPickerSwipeRatio(
        pickerSwipeDisplay < 0 && pickerStack.length ? Math.min(1, -pickerSwipeDisplay / pickerSwipeAxis.threshold) : 0,
        pickerSwipeDisplay > 0 && pickerRedoStack.length ? Math.min(1, pickerSwipeDisplay / pickerSwipeAxis.threshold) : 0,
      )
      pickerSwipeRaf = pickerSwipeDisplay !== accum ? requestAnimationFrame(pickerSwipeTick) : 0
    }
    function pickerSwipeRelease() {
      pickerList.classList.remove('is-swiping') // re-enables the CSS transition, for whichever of the two below now plays
      cancelAnimationFrame(pickerSwipeRaf)
      pickerSwipeRaf = 0
      pickerSwipeDisplay = 0
      setPickerSwipeRatio(0, 0)
      const direction = pickerSwipeAxis.release()
      if (direction < 0 && pickerStack.length) { pickerRedoStack.push(pickerStack.pop()); void renderPicker() }
      else if (direction > 0 && pickerRedoStack.length) { pickerStack.push(pickerRedoStack.pop()); void renderPicker() }
    }
    function resetPickerSwipeVisual() {
      cancelAnimationFrame(pickerSwipeRaf)
      pickerSwipeRaf = 0
      pickerSwipeDisplay = 0
      setPickerSwipeRatio(0, 0)
      clearTimeout(pickerSwipeResetTimer)
      pickerSwipeResetTimer = 0
    }
    pickerList.addEventListener('wheel', (event) => {
      if (event.ctrlKey || pickerMove || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
      // The momentum tail of a swipe that already went through (a flick keeps sending events for a second or
      // two after the fingers lift): keep feeding it so it stays swallowed, but don't redraw the arrow or put
      // is-swiping back on — that would switch the CSS transition off again right as the page change plays.
      if (pickerSwipeAxis.inCooldown) { pickerSwipeAxis.feed(event.deltaX); return }
      if (pickerSwipeAxis.accum === 0) resetPickerSwipeVisual()
      pickerList.classList.add('is-swiping')
      const quiet = pickerSwipeAxis.feed(event.deltaX)
      clearTimeout(pickerSwipeResetTimer)
      pickerSwipeResetTimer = setTimeout(pickerSwipeRelease, quiet)
      if (!pickerSwipeRaf) pickerSwipeRaf = requestAnimationFrame(pickerSwipeTick)
    }, { passive: true })
    pickerCancel.addEventListener('click', () => { if (pickerMove) endMove(); else showDrawer(null) })
    pickerTopClose.addEventListener('click', () => { if (pickerMove) endMove() })
    // Clicking the dimmed backdrop behind the Move-to pop-up cancels it, same as Cancel or Escape.
    document.addEventListener('pointerdown', (event) => {
      if (!pickerMove || !document.body.classList.contains('is-moving')) return
      if (!drawerPicker.contains(event.target)) endMove()
    })
    // Clicking any empty space — inside the drawer but off an entry, or off the plugin window entirely —
    // clears the picker selection, same as Drive itself. pickerList's own click handler already clears on
    // an empty click inside the list; this covers the rest of the drawer (the header/tabs row above it,
    // say) and the window losing focus altogether (clicking out onto the canvas).
    document.addEventListener('pointerdown', (event) => {
      if (!picked.size || !drawerPicker.contains(event.target)) return
      if (event.target.closest('[data-id]') || event.target.closest('#picker-selbar')) return
      clearSelection()
    })
    window.addEventListener('blur', () => { if (picked.size) clearSelection() })

    // The selection bar (like Drive's): count, then the actions that apply to everything selected.
    document.getElementById('sel-clear').addEventListener('click', clearSelection)
    document.getElementById('sel-move').addEventListener('click', () => startMove(pickedEntries()))
    document.getElementById('sel-download').addEventListener('click', () => { void downloadEntries(pickedEntries()) })
    document.getElementById('sel-trash').addEventListener('click', () => { void trashEntries(pickedEntries()) })
    document.getElementById('sel-link').addEventListener('click', () => copyText(pickedEntries().map(driveUrl).join('\n')))
    document.getElementById('sel-more').addEventListener('click', (event) => openMenu(menuFor(pickedEntries()), event.currentTarget.getBoundingClientRect()))

    pickerSelect.addEventListener('click', async () => {
      if (pickerMove) { await finishMove(); return }
      const target = pickerTarget()
      if (!target) return
      pickerSelect.disabled = true
      try {
        const id = await resolveFolderId(target.id)
        saveLastFolder(id, target.name)
        if (driveSubmit.disabled) { // no frames or formats yet: remember the folder in the link box instead
          showDrawer(null)
          driveUrlInput.value = `https://drive.google.com/drive/folders/${id}`
          driveUrlInput.dispatchEvent(new Event('input'))
          refreshTooltip()
        } else {
          // Left open on purpose: closing the instant the upload starts meant there was never anything to
          // actually watch happen. startDriveUpload itself brings the drawer back to this folder and
          // flashes the new files once they've landed (see revealUploadedFiles).
          await startDriveUpload(id)
          updatePickerSelect()
        }
      } catch (error) {
        updatePickerSelect()
        failDrive(friendlyDriveMessage(error))
      }
    })