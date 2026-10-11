    // ---- Confirmation pop-up -------------------------------------------------------------------------
    // Resolves true on the confirm button, false on Cancel, Esc or a click outside. Esc closes ONLY the pop-up.
    let modalResolve = null, modalReturnFocus = null, modalHideTimer = 0, modalHasInput = false
    const modalInput = document.getElementById('modal-input')
    function confirmDialog({ title, message, confirmLabel, input, danger }) {
      if (modalResolve) closeModal(false)
      modalTitle.textContent = title
      modalText.textContent = message || ''
      modalText.hidden = !message
      modalOk.textContent = confirmLabel || 'Delete'
      modalOk.classList.toggle('is-danger-solid', danger !== false)
      modalOk.classList.toggle('is-primary', danger === false)
      modalHasInput = typeof input === 'string'
      modalInput.hidden = !modalHasInput
      if (modalHasInput) modalInput.value = input
      modalReturnFocus = document.activeElement
      clearTimeout(modalHideTimer)
      modalEl.hidden = false
      void modalEl.offsetWidth
      modalEl.classList.add('is-open')
      if (modalHasInput) { modalInput.focus(); modalInput.select() } else modalCancel.focus() // the safe choice is the default one
      return new Promise((resolve) => { modalResolve = resolve })
    }
    function closeModal(result) {
      const resolve = modalResolve
      modalResolve = null
      let value = result
      if (modalHasInput && result) value = modalInput.value.trim() || false
      modalEl.classList.remove('is-open')
      modalHideTimer = setTimeout(() => { if (!modalResolve) modalEl.hidden = true }, 200)
      const back = modalReturnFocus
      modalReturnFocus = null
      if (back && back.isConnected && typeof back.focus === 'function' && !back.disabled) back.focus({ preventScroll: true })
      if (resolve) resolve(value)
    }
    modalInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); closeModal(true) } })
    modalOk.addEventListener('click', () => closeModal(true))
    modalCancel.addEventListener('click', () => closeModal(false))
    modalEl.addEventListener('pointerdown', (event) => { if (event.target === modalEl) closeModal(false) })
    window.addEventListener('keydown', (event) => {
      if (!modalResolve) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeModal(false) }
      else if (event.key === 'Tab') { // keep focus inside the pop-up
        event.preventDefault()
        const order = (modalHasInput ? [modalInput] : []).concat([modalCancel, modalOk])
        const at = order.indexOf(document.activeElement)
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length].focus()
      }
    }, true)
