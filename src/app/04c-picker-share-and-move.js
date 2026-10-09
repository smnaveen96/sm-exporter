    // ---- Share… --------------------------------------------------------------------------------------
    // Its own pop-up rather than a ctx-menu item with a submenu, since adding people needs a real email
    // field and a per-person role, and "Anyone with the link" needs its own toggle — the same shape as
    // Google Drive's own Share dialog, built on the Permissions API.
    const shareModal = document.getElementById('share-modal')
    const shareTitle = document.getElementById('share-title')
    const shareEmailInput = document.getElementById('share-email')
    const shareAddButton = document.getElementById('share-add-button')
    const sharePeopleEl = document.getElementById('share-people')
    const sharePeopleWrap = document.getElementById('share-people-wrap')
    const shareMsg = document.getElementById('share-msg')
    const shareGeneralSelect = document.getElementById('share-general-select')
    const shareGeneralDomainOption = document.getElementById('share-general-domain-option')
    const shareGeneralRoleRow = document.getElementById('share-general-role-row')
    const shareGeneralRole = document.getElementById('share-general-role')
    const shareGeneralLabel = document.getElementById('share-general-label')
    const shareGeneralSub = document.getElementById('share-general-sub')
    const shareGeneralIcon = document.getElementById('share-general-icon')
    const shareCancel = document.getElementById('share-cancel')
    const shareDone = document.getElementById('share-done')
    const shareCopyLink = document.getElementById('share-copy-link')
    const ROLE_LABEL = { writer: 'Editor', commenter: 'Commenter', reader: 'Viewer', owner: 'Owner' }
    const ICON_GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a14.8 14.8 0 0 1 3.9 9.5 14.8 14.8 0 0 1-3.9 9.5 14.8 14.8 0 0 1-3.9-9.5A14.8 14.8 0 0 1 12 2.5z"/></svg>'
    const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>'
    const ICON_DOMAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16"/><path d="M14 21v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/><path d="M8 7h.01M8 11h.01M8 15h.01M17 15h.01"/><path d="M2 21h20"/></svg>'
    // Only a paid Google Workspace account on its own custom domain can turn on organization-wide
    // sharing at all — a plain consumer Gmail account never gets that option in Drive's own UI either —
    // so it's offered here only when the signed-in account's own address looks like one of those.
    const PERSONAL_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])
    function workspaceDomain() {
      const account = tokens && tokens.account
      const at = account ? account.indexOf('@') : -1
      if (!account || at < 0) return ''
      const domain = account.slice(at + 1).toLowerCase()
      return PERSONAL_EMAIL_DOMAINS.has(domain) ? '' : domain
    }
    // Display-only: Drive never shows the raw domain string in its own sharing UI, it title-cases each
    // dot-separated part (and each hyphen-separated piece within a part) and joins the parts with a
    // space — "tier2.digital" becomes "Tier2 Digital", same as any other organization's domain would.
    // The raw domain is still what's sent to the API (permissions are created with the literal domain,
    // never this friendly spelling) — this only ever touches what gets put on screen.
    function friendlyDomainName(domain) {
      if (!domain) return domain
      return domain
        .split('.')
        .map((part) => part.split('-').map((piece) => piece ? piece[0].toUpperCase() + piece.slice(1) : piece).join('-'))
        .join(' ')
    }
    let shareEntry = null
    let sharePeople = []       // [{ id, email, name, role, kind: 'user' }]
    let shareGeneral = null    // the 'anyone' permission, or null if restricted
    let shareDomain = null     // the 'domain' (organization-wide) permission, or null if there isn't one
    let shareBusy = false
    let shareHideTimer = 0

    function initialsFor(text) {
      const letter = String(text || '?').trim()[0]
      return letter ? letter.toUpperCase() : '?'
    }
    // Drive gives every person without a photo their own solid-colour circle (a different color per
    // account, picked deterministically from their email so the same person always lands on the same
    // one) rather than one flat grey for everybody — this is that same deterministic pick, from a
    // palette of Drive-like avatar colours.
    const AVATAR_COLORS = ['#1a73e8', '#188038', '#e8710a', '#d93025', '#9334e6', '#12847e', '#e52592', '#3949ab']
    function avatarColorFor(text) {
      const key = String(text || '')
      let hash = 0
      for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
      return AVATAR_COLORS[hash % AVATAR_COLORS.length]
    }

    // A soft fade at the bottom of the people list, shown only while there's actually more to scroll to —
    // not a permanent decoration. Re-checked after every render (list length can change) and on scroll.
    function updateShareFade() {
      if (!sharePeopleWrap) return
      const hasMore = sharePeopleEl.scrollHeight - sharePeopleEl.scrollTop - sharePeopleEl.clientHeight > 2
      sharePeopleWrap.classList.toggle('has-fade', hasMore)
    }
    sharePeopleEl.addEventListener('scroll', updateShareFade)

    function renderSharePeople() {
      sharePeopleEl.textContent = ''
      for (const person of sharePeople) {
        const row = document.createElement('div')
        row.className = 'share-person'
        const dot = document.createElement('span')
        dot.className = 'dot'
        // A real photo of the person when Drive's permissions API handed one back (photoLink), falling
        // back to initials — same as the account-switcher chips elsewhere already do for the signed-in
        // account's own photo.
        if (person.photo) {
          const img = new Image()
          img.alt = ''
          img.referrerPolicy = 'no-referrer'
          img.onerror = () => { img.remove(); dot.textContent = initialsFor(person.name || person.email); dot.style.background = avatarColorFor(person.email || person.name); dot.style.color = '#fff' }
          img.src = person.photo
          dot.append(img)
        } else {
          dot.textContent = initialsFor(person.name || person.email)
          dot.style.background = avatarColorFor(person.email || person.name)
          dot.style.color = '#fff'
        }
        const mail = document.createElement('span')
        mail.className = 'mail'
        if (person.deleted) {
          if (person.email) {
            // Drive still hands back the email address a deleted account was granted access under, so
            // that stays the headline with "Account deleted" written underneath, same layout as Drive's
            // own sharing dialog. When it doesn't (some deleted permissions come back with nothing at
            // all to put a name to), there's only the one label to show — showing it twice over, once as
            // the headline and again as the sub-line, is a worse look than just the single line.
            mail.textContent = person.email
            const small = document.createElement('small')
            small.textContent = 'Account deleted'
            small.classList.add('is-deleted')
            mail.append(small)
          } else {
            mail.textContent = 'Account deleted'
            mail.classList.add('is-deleted')
          }
        } else {
          mail.textContent = person.name || person.email
          if (person.name) { const small = document.createElement('small'); small.textContent = person.email; mail.append(small) }
        }
        row.append(dot, mail)
        if (person.role === 'owner') {
          const owner = document.createElement('span')
          owner.className = 'share-general-sub'
          owner.textContent = 'Owner'
          row.append(owner)
        } else {
          const who = person.email || 'this account'
          const select = document.createElement('select')
          select.className = 'select-pill'
          select.setAttribute('aria-label', `Permission for ${who}`)
          for (const role of ['writer', 'commenter', 'reader']) select.append(new Option(ROLE_LABEL[role], role, false, role === person.role))
          select.addEventListener('change', () => { void updateSharePersonRole(person, select.value) })
          const remove = document.createElement('button')
          remove.type = 'button'
          remove.className = 'icon-button'
          remove.innerHTML = ICONS.close
          remove.setAttribute('aria-label', `Remove ${who}`)
          remove.addEventListener('click', () => { void removeSharePerson(person) })
          row.append(select, remove)
        }
        sharePeopleEl.append(row)
      }
      requestAnimationFrame(updateShareFade)
    }

    function renderShareGeneral() {
      const domain = (shareDomain && shareDomain.domain) || workspaceDomain()
      // The organization option only ever shows up for a Workspace account, whether or not this
      // particular file is currently set that way — exactly like Drive's own dropdown always offers it
      // there, not only once a file already happens to use it.
      shareGeneralDomainOption.hidden = !domain
      const friendlyDomain = friendlyDomainName(domain)
      if (domain) shareGeneralDomainOption.textContent = friendlyDomain
      const mode = shareGeneral ? 'anyone' : (shareDomain ? 'domain' : 'restricted')
      shareGeneralSelect.value = mode
      const active = shareGeneral || shareDomain || null
      shareGeneralRoleRow.hidden = !active
      shareGeneralIcon.innerHTML = mode === 'anyone' ? ICON_GLOBE : (mode === 'domain' ? ICON_DOMAIN : ICON_LOCK)
      shareGeneralLabel.textContent = mode === 'anyone' ? 'Anyone with the link' : (mode === 'domain' ? friendlyDomain : 'Restricted')
      shareGeneralSub.textContent = mode === 'anyone' ? 'Anyone on the Internet with this link can access'
        : mode === 'domain' ? `Anyone at ${friendlyDomain} with this link can access`
        : 'Only people added can open this'
      if (active) shareGeneralRole.value = active.role
    }

    function setShareMessage(kind, text) {
      shareMsg.hidden = !text
      shareMsg.textContent = text || ''
      shareMsg.classList.toggle('is-error', kind === 'error')
    }

    function setShareBusy(busy) {
      shareBusy = busy
      for (const el of [shareAddButton, shareEmailInput, shareGeneralSelect, shareGeneralRole]) el.disabled = busy
      sharePeopleEl.classList.toggle('is-busy', busy)
    }

    async function openShareDialog(entry) {
      if (!entry || isDriveRoot(entry)) return
      shareEntry = entry
      sharePeople = []
      shareGeneral = null
      shareDomain = null
      shareEmailInput.value = ''
      setShareMessage('', '')
      shareTitle.textContent = `Share “${entry.name}”`
      renderSharePeople()
      renderShareGeneral()
      clearTimeout(shareHideTimer)
      shareModal.hidden = false
      void shareModal.offsetWidth
      shareModal.classList.add('is-open')
      setShareBusy(true)
      setShareMessage('', 'Loading who has access…')
      try {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(entry.id)}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,emailAddress,displayName,photoLink,domain,deleted)`)
        if (!response.ok) throw await driveError(response, 'load sharing settings for')
        const data = await response.json()
        const permissions = data.permissions || []
        shareGeneral = permissions.find((p) => p.type === 'anyone') || null
        shareDomain = permissions.find((p) => p.type === 'domain') || null
        sharePeople = permissions
          .filter((p) => p.type === 'user')
          .map((p) => ({
            id: p.id, email: p.emailAddress || '', name: p.displayName || '', role: p.role, photo: p.photoLink || null,
            // Drive's permission resource says plainly whether the account behind it has since been
            // deleted — the email address itself is still returned (the permission, and whatever access
            // it grants, is still real), there's just no live account behind it any more, same as Drive's
            // own sharing dialog: the email stays as the headline with "Account deleted" written below it.
            deleted: Boolean(p.deleted),
          }))
        setShareMessage('', '')
      } catch (error) {
        setShareMessage('error', actionFailMessage(error, 'load sharing settings for'))
      } finally {
        setShareBusy(false)
        renderSharePeople()
        renderShareGeneral()
      }
    }

    function closeShareDialog() {
      shareModal.classList.remove('is-open')
      shareHideTimer = setTimeout(() => { shareModal.hidden = true }, 200)
      void renderPicker({ silent: true, keep: true }) // the shared/starred badge on the item may have changed
    }

    async function addSharePerson() {
      const email = shareEmailInput.value.trim()
      if (!email) return
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setShareMessage('error', 'That doesn’t look like an email address.'); return }
      if (sharePeople.some((p) => p.email && p.email.toLowerCase() === email.toLowerCase())) { setShareMessage('error', 'Already shared with that address.'); return }
      // Google's own dialog adds a new person as a Viewer and lets you change it from their row
      // afterward, rather than choosing the role up front next to the email field.
      const role = 'reader'
      setShareBusy(true)
      setShareMessage('', 'Sharing…')
      try {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions?supportsAllDrives=true&sendNotificationEmail=true&fields=id,emailAddress,displayName,role,photoLink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ type: 'user', role, emailAddress: email }),
        })
        if (!response.ok) throw await driveError(response, 'share')
        const made = await response.json()
        sharePeople.push({ id: made.id, email: made.emailAddress || email, name: made.displayName, role: made.role || role, photo: made.photoLink || null })
        shareEmailInput.value = ''
        setShareMessage('', '')
      } catch (error) {
        setShareMessage('error', actionFailMessage(error, 'share'))
      } finally {
        setShareBusy(false)
        renderSharePeople()
      }
    }

    async function updateSharePersonRole(person, role) {
      if (role === person.role) return
      const previous = person.role
      person.role = role
      setShareBusy(true)
      try {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions/${encodeURIComponent(person.id)}?supportsAllDrives=true`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ role }),
        })
        if (!response.ok) throw await driveError(response, 'update that permission')
      } catch (error) {
        person.role = previous
        setShareMessage('error', actionFailMessage(error, 'update that permission'))
        renderSharePeople()
      } finally {
        setShareBusy(false)
      }
    }

    async function removeSharePerson(person) {
      setShareBusy(true)
      try {
        const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions/${encodeURIComponent(person.id)}?supportsAllDrives=true`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) throw await driveError(response, 'remove that person')
        sharePeople = sharePeople.filter((p) => p !== person)
        renderSharePeople()
      } catch (error) {
        setShareMessage('error', actionFailMessage(error, 'remove that person'))
      } finally {
        setShareBusy(false)
      }
    }

    async function deleteSharePermission(permission) {
      const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) throw await driveError(response, 'change general access for')
    }

    // mode is 'restricted' | 'domain' | 'anyone' — whichever of the three the dropdown now reads.
    // 'domain' and 'anyone' are mutually exclusive in Drive's own dropdown (picking one replaces the
    // other, never both at once), same as this one.
    async function setShareGeneral(mode, role) {
      const current = shareGeneral ? 'anyone' : (shareDomain ? 'domain' : 'restricted')
      if (mode === current && (mode === 'restricted' || role === (shareGeneral || shareDomain).role)) return
      setShareBusy(true)
      setShareMessage('', '')
      try {
        if (mode === current && mode !== 'restricted') {
          // Same mode, only the role (view/comment/edit) changed.
          const active = shareGeneral || shareDomain
          const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions/${encodeURIComponent(active.id)}?supportsAllDrives=true`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({ role }),
          })
          if (!response.ok) throw await driveError(response, 'change general access for')
          active.role = role
        } else {
          // Switching modes: drop whichever of domain/anyone was active, then create the new one (skip
          // the create step for "restricted", which just means neither should be set).
          if (shareGeneral) { await deleteSharePermission(shareGeneral); shareGeneral = null }
          if (shareDomain) { await deleteSharePermission(shareDomain); shareDomain = null }
          if (mode !== 'restricted') {
            const body = mode === 'domain' ? { type: 'domain', role, domain: workspaceDomain() } : { type: 'anyone', role }
            const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(shareEntry.id)}/permissions?supportsAllDrives=true&fields=id,role,domain`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=UTF-8' },
              body: JSON.stringify(body),
            })
            if (!response.ok) throw await driveError(response, 'change general access for')
            const made = await response.json()
            if (mode === 'domain') shareDomain = { id: made.id, role: made.role, domain: made.domain }
            else shareGeneral = { id: made.id, role: made.role }
          }
        }
      } catch (error) {
        setShareMessage('error', actionFailMessage(error, 'change general access for'))
      } finally {
        setShareBusy(false)
        renderShareGeneral()
      }
    }

    shareAddButton.addEventListener('click', () => { void addSharePerson() })
    shareEmailInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void addSharePerson() } })
    shareGeneralSelect.addEventListener('change', () => { void setShareGeneral(shareGeneralSelect.value, shareGeneralRole.value) })
    shareGeneralRole.addEventListener('change', () => { void setShareGeneral(shareGeneral ? 'anyone' : 'domain', shareGeneralRole.value) })
    shareCopyLink.addEventListener('click', () => { if (shareEntry) copyText(driveUrl(shareEntry)) })
    shareCancel.addEventListener('click', closeShareDialog)
    shareDone.addEventListener('click', closeShareDialog)
    shareModal.addEventListener('pointerdown', (event) => { if (event.target === shareModal) closeShareDialog() })
    window.addEventListener('keydown', (event) => {
      if (shareModal.hidden || !shareModal.classList.contains('is-open')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeShareDialog() }
    }, true)

    // Download: one file as itself, several as a single ZIP. Google-made documents come out as PDF.
    async function fetchMedia(entry, { signal, onProgress } = {}) {
      const url = isNativeGoogle(entry)
        ? `${DRIVE_API}/files/${encodeURIComponent(entry.id)}/export?mimeType=application%2Fpdf`
        : `${DRIVE_API}/files/${encodeURIComponent(entry.id)}?alt=media&supportsAllDrives=true`
      const response = await driveFetch(url, { signal })
      if (!response.ok) throw await driveError(response, 'download')
      const type = response.headers.get('content-type') || entry.mimeType || 'application/octet-stream'
      if (!response.body || !onProgress) return new Blob([await response.arrayBuffer()], { type })
      const total = Number(response.headers.get('content-length')) || Number(entry.size) || 0
      const reader = response.body.getReader()
      const chunks = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.length
        onProgress(total ? got / total : 0)
      }
      return new Blob(chunks, { type })
    }

    async function downloadEntries(files) {
      files = files.filter((entry) => entry.kind === 'file')
      if (!files.length) return
      downloadRun = { cancelled: false, controller: new AbortController() }
      showUploadCancel(true) // same cancel slot the upload status line uses — see the click handler above
      try {
        const out = {}
        let n = 0
        for (const entry of files) {
          throwIfDownloadCancelled()
          setDriveStatus('busy', files.length > 1 ? `Downloading ${++n} of ${files.length}…` : 'Downloading…')
          const blob = await fetchMedia(entry, { signal: downloadRun.controller.signal })
          throwIfDownloadCancelled()
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let name = isNativeGoogle(entry) ? `${entry.name}.pdf` : entry.name
          for (let i = 2; out[name]; i++) name = name.replace(/(\.[^.]*)?$/, ` (${i})$1`)
          out[name] = bytes
          if (files.length === 1) { await downloadSingle(name, bytes, blob.type || 'application/octet-stream'); break }
        }
        if (files.length > 1) await downloadZip('Drive files.zip', fflate.zipSync(out, { level: 0 }))
        setDriveStatus('', '')
        flashDriveStatus(files.length > 1 ? `Downloaded ${files.length} files` : 'Downloaded', 2200)
      } catch (error) {
        const stoppedByUser = Boolean(downloadRun && downloadRun.cancelled)
        if (stoppedByUser) { console.log(LOG, 'Download cancelled'); setDriveStatus('', 'Cancelled.') }
        else { console.warn(LOG, 'Download failed', error); failDrive(actionFailMessage(error, 'download')) }
      } finally {
        showUploadCancel(false)
        downloadRun = null
      }
    }

    // Figma caps an image fill at 4096×4096 and is supposed to scale anything bigger down to fit — but a
    // phone photo well past that (a 12MP+ shot is routinely 4000×3000 or larger, and a lot of "poster"
    // exports run bigger still) is exactly the case that was coming in looking off/not placing cleanly.
    // Doing the downscale ourselves before the bytes ever leave here means we know exactly what Figma
    // receives, rather than trusting its own internal resize to handle every source file equally well.
    const CANVAS_IMAGE_MAX_DIM = 4096
    async function downscaleForCanvas(blob, mimeType) {
      let bitmap
      try { bitmap = await createImageBitmap(blob) } catch (error) { return null } // let the caller fall back to the original bytes
      try {
        if (bitmap.width <= CANVAS_IMAGE_MAX_DIM && bitmap.height <= CANVAS_IMAGE_MAX_DIM) return null // already within the limit
        const scale = CANVAS_IMAGE_MAX_DIM / Math.max(bitmap.width, bitmap.height)
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(bitmap, 0, 0, w, h)
        const outType = /png/i.test(mimeType || '') ? 'image/png' : 'image/jpeg'
        const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.92))
        if (!outBlob) return null
        return new Uint8Array(await outBlob.arrayBuffer())
      } finally {
        bitmap.close()
      }
    }

    // Place images on the Figma canvas. The plugin's code side creates the layers (see code-additions.js).
    async function placeOnCanvas(images, at) {
      try {
        const out = []
        let n = 0
        for (const entry of images) {
          setDriveStatus('busy', images.length > 1 ? `Getting image ${++n} of ${images.length}…` : 'Getting image…')
          const blob = await fetchMedia(entry)
          const name = entry.name.replace(/\.[^.]+$/, '')
          // Figma's createImage() only takes raster bytes (PNG/JPEG/GIF) — handing it an SVG's bytes is
          // exactly what was throwing "Figma can't read that image type." An SVG has to go through
          // createNodeFromSvg() instead, as the markup text, which the plugin side branches on below.
          // SVGs are vector, so the 4096px raster cap below never applies to them.
          const isSvg = /^image\/svg/i.test(entry.mimeType || '') || /\.svg$/i.test(entry.name || '')
          if (isSvg) { out.push({ name, svg: await blob.text() }); continue }
          const mimeType = blob.type || entry.mimeType || ''
          const resized = await downscaleForCanvas(blob, mimeType)
          out.push({ name, bytes: resized || new Uint8Array(await blob.arrayBuffer()) })
        }
        post({ type: 'place-images', images: out, x: at ? at.x : null, y: at ? at.y : null })
        setDriveStatus('', '')
        flashDriveStatus(out.length > 1 ? `Placed ${out.length} images` : 'Placed on the canvas', 2200)
      } catch (error) {
        failDrive(actionFailMessage(error, 'place'))
      }
    }

    // ---- Move to… ------------------------------------------------------------------------------------
    // Rather than turning the drawer you're already browsing into "now pick a destination" mode in place,
    // this pops the same picker (tabs, search, breadcrumbs, list — all untouched) out into its own
    // floating dialog over everything else, so it reads as a distinct "choose where" step instead of the
    // list you were just looking at suddenly changing meaning under you.
    function startMove(entries) {
      entries = entries.filter((entry) => !isDriveRoot(entry))
      if (!entries.length) return
      pickerMove = { ids: new Set(entries.map((entry) => entry.id)), entries }
      picked.clear()
      pickerList.classList.add('is-moving')
      if (drawerPicker.parentNode !== document.body) document.body.append(drawerPicker)
      drawerPicker.classList.add('is-floating')
      document.body.classList.add('is-moving')
      resizeLocked = true // the window shouldn't resize to fit what's left of the drawer while the modal floats over it
      syncSelection()
      updatePickerSelect()
      for (const id of pickerMove.ids) elById.get(id)?.classList.add('is-moving')
    }
    function endMove() {
      if (!pickerMove) return
      pickerMove = null
      pickerList.classList.remove('is-moving')
      for (const el of elById.values()) el.classList.remove('is-moving')
      drawerPicker.classList.remove('is-floating')
      document.body.classList.remove('is-moving')
      if (pickerAnchor.parentNode) pickerAnchor.parentNode.insertBefore(drawerPicker, pickerAnchor)
      resizeLocked = false
      syncSelection()
      updatePickerSelect()
      syncHeight()
    }
    async function finishMove() {
      const move = pickerMove
      const target = pickerTarget()
      if (!move || !target) return
      pickerSelect.disabled = true
      setDriveStatus('busy', 'Moving…')
      try {
        const destination = await resolveFolderId(target.id)
        for (const entry of move.entries) {
          const remove = (entry.parents || []).filter((id) => id !== destination)
          const query = `&addParents=${encodeURIComponent(destination)}${remove.length ? `&removeParents=${encodeURIComponent(remove.join(','))}` : ''}`
          const response = await patchFile(entry.id, {}, query)
          if (!response.ok) throw await driveError(response, 'move')
        }
        endMove()
        setDriveStatus('', '')
        flashDriveStatus(`Moved ${move.entries.length === 1 ? '1 item' : `${move.entries.length} items`}`, 2400)
        await renderPicker({ silent: true })
      } catch (error) {
        failDrive(actionFailMessage(error, 'move'))
        updatePickerSelect()
      }
    }

