    // ---- From the sandbox's PNG renders to the final files (JPEG / PNG / WebP / SVG / PDF) --------------
    // Shared by EXPORT (download) and the Drive upload. Frames are converted a few at a time rather than
    // strictly one after another (the browser's image decode/encode is asynchronous, so they overlap well),
    // and PNG optimisation — the one pure-JavaScript step heavy enough to freeze the page for a second or
    // more per frame — runs in a Web Worker, so the plugin stays responsive and Cancel takes effect at once.
    function renderAt(source, scale) {
      if (!scale || scale === 1) return source.pngBytes
      return (source.renders && source.renders[String(scale)]) || source.pngBytes
    }

    // ---- PNG optimisation off the main thread ------------------------------------------------------------
    // build.js inlines the PNG codec (02a) plus fflate a second time as the text of #png-worker-src; Blob
    // Workers are started from it the first time a PNG export needs them (the plugin iframe can't load a
    // separate worker file). Falls back to optimizePng() on the main thread if they can't start or fail.
    // A small pool (two or three workers, by core count) so the PNGs of several frames are optimised at the
    // same time; each job goes to the worker with the least queued. One shared job table keyed by id.
    const PNG_WORKER_COUNT = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))
    let pngWorkers = null, pngWorkerUrl = null, pngWorkerSeq = 0
    const pngWorkerJobs = new Map() // id → { resolve, reject, worker }
    function ensurePngWorkers() {
      if (pngWorkers) return pngWorkers
      const source = document.getElementById('png-worker-src')
      if (!source || typeof Worker === 'undefined') return null
      try {
        pngWorkerUrl = pngWorkerUrl || URL.createObjectURL(new Blob([source.textContent], { type: 'application/javascript' }))
        pngWorkers = Array.from({ length: PNG_WORKER_COUNT }, () => new Worker(pngWorkerUrl))
      } catch (error) {
        console.warn(LOG, 'PNG worker could not start', error)
        pngWorkers = null
        return null
      }
      for (const worker of pngWorkers) {
        worker.onmessage = (event) => {
          const { id, bytes, error } = event.data || {}
          const job = pngWorkerJobs.get(id)
          if (!job) return
          pngWorkerJobs.delete(id)
          if (error) job.reject(new Error(error))
          else job.resolve(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
        }
        worker.onerror = (event) => {
          console.warn(LOG, 'PNG worker failed', (event && event.message) || event)
          stopPngWorker(new Error('PNG worker failed'))
        }
      }
      return pngWorkers
    }
    // Terminating the workers is what makes Cancel immediate: a quantisation that is half-way through a
    // large frame just stops, instead of running to completion first. Pending jobs are rejected (as
    // cancelled unless another reason is given) and a later export starts fresh workers.
    function stopPngWorker(reason) {
      if (!pngWorkers) return
      for (const worker of pngWorkers) worker.terminate()
      pngWorkers = null
      const error = reason || exportCancelledError()
      for (const job of pngWorkerJobs.values()) job.reject(error)
      pngWorkerJobs.clear()
    }
    function optimizePngAsync(bytes) {
      const workers = ensurePngWorkers()
      if (!workers) return Promise.resolve(optimizePng(bytes))
      const id = ++pngWorkerSeq
      const queued = new Map(workers.map((worker) => [worker, 0]))
      for (const job of pngWorkerJobs.values()) queued.set(job.worker, (queued.get(job.worker) || 0) + 1)
      const worker = workers.reduce((best, candidate) => (queued.get(candidate) < queued.get(best) ? candidate : best), workers[0])
      return new Promise((resolve, reject) => {
        pngWorkerJobs.set(id, { resolve, reject, worker })
        worker.postMessage({ id, bytes }) // copied rather than transferred: the same 1x PNG also feeds the PDF — Image and JPEG paths
      }).catch((error) => {
        if (error && error.cancelled) throw error
        console.warn(LOG, 'PNG worker failed, optimising on the main thread instead', error)
        return optimizePng(bytes)
      })
    }
    // Runs task over items with at most `limit` in flight; results keep the items' order.
    async function mapLimited(items, limit, task) {
      const results = new Array(items.length)
      let next = 0
      const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) { const i = next++; results[i] = await task(items[i], i) }
      })
      await Promise.all(lanes)
      return results
    }
    const CONVERT_CONCURRENCY = 3 // frames converted at the same time: enough overlap to help, not enough to balloon memory

    async function generateFiles(message) {
      const options = message.options
      const scales = options.scales || {}
      const files = []
      const pdfImages = []
      const vectorPages = []
      const vectorIndexes = [] // which source (frame) each vector page came from
      // One frame: every image format of that frame is named after the File name field
      // (Summer-Sale.jpg, Summer-Sale.png, …), or after the frame's name in Figma when it is
      // empty, matching the PDF. Several frames stay numbered (01.jpg, 02.jpg, …).
      const frameName = message.rasterSources.length === 1 && frameOrder.length === 1 ? (frameNames[frameOrder[0]] || '') : ''
      const typedName = options.typedName || frameName || options.fileName || ''
      const useTypedName = typedName && message.rasterSources.length === 1
      const typedStem = stripExportExtension(typedName)
      const pdfName = typedStem || options.fileName // the same stem the images use, so "Summer-Sale.jpg" gives Summer-Sale.pdf, not Summer-Sale.jpg.pdf
      const imageName = (source, extension) => useTypedName ? normalizedFilename(typedStem, extension, source.baseName) : `${source.baseName}.${extension}`
      const total = message.rasterSources.length
      const wantsImages = options.pdfImage || options.jpeg || options.png || options.webp || options.svg
      let converted = 0
      if (wantsImages) exportPhase(`Converting 0 of ${total}…`)
      // Each frame's formats are made together (they're independent), a few frames at a time.
      const perFrame = await mapLimited(message.rasterSources, CONVERT_CONCURRENCY, async (source) => {
        throwIfExportCancelled()
        const made = { pdfImage: null, files: [] }
        const jobs = []
        // PDF — Image always uses the 1x render (unchanged quality path); JPEG follows its own scale.
        const pdfImageJob = options.pdfImage ? convertPng(source.pngBytes, 'image/jpeg', 0.93).then((image) => { made.pdfImage = image; return image }) : null
        if (pdfImageJob) jobs.push(pdfImageJob)
        if (options.jpeg) {
          const sharesPdfImage = pdfImageJob && (!scales.jpeg || scales.jpeg === 1)
          jobs.push((sharesPdfImage ? pdfImageJob : convertPng(renderAt(source, scales.jpeg), 'image/jpeg', 0.93))
            .then((jpeg) => { made.files.push({ name: imageName(source, 'jpg'), mime: 'image/jpeg', bytes: jpeg.bytes }) }))
        }
        if (options.png) jobs.push(optimizePngAsync(asBytes(renderAt(source, scales.png))).then((bytes) => { made.files.push({ name: imageName(source, 'png'), mime: 'image/png', bytes }) }))
        if (options.webp) jobs.push(convertPng(renderAt(source, scales.webp), 'image/webp', 0.88).then((webp) => { made.files.push({ name: imageName(source, 'webp'), mime: 'image/webp', bytes: webp.bytes }) }))
        if (options.svg && source.svg) made.files.push({ name: imageName(source, 'svg'), mime: 'image/svg+xml', bytes: asBytes(source.svg) })
        await Promise.all(jobs)
        throwIfExportCancelled()
        converted += 1
        if (wantsImages) exportPhase(`Converting ${converted} of ${total}…`)
        return made
      })
      for (let sourceIndex = 0; sourceIndex < total; sourceIndex += 1) {
        const source = message.rasterSources[sourceIndex]
        files.push(...perFrame[sourceIndex].files)
        if (options.pdfImage) pdfImages.push(perFrame[sourceIndex].pdfImage)
        if (options.pdfVector && source.pdf) { vectorPages.push(asBytes(source.pdf)); vectorIndexes.push(sourceIndex) }
      }
      const bothPdfs = options.pdfImage && options.pdfVector && vectorPages.length > 0
      if (options.pdfImage) {
        exportPhase('Building PDF — Image…')
        files.push({
          name: normalizedFilename(pdfName, 'pdf', 'Export'),
          mime: 'application/pdf',
          bytes: buildRasterPdf(pdfImages),
        })
      }
      if (options.pdfVector && vectorPages.length > 0) {
        // PDF — Individual with several frames: one PDF per frame, named after the frame.
        // (One frame behaves like Merged: the typed file name wins, else the frame name.)
        const individual = options.pdfMode === 'individual' && vectorPages.length > 1
        const compress = options.compressPdf ? (options.compressLevel === 'smaller' ? 'smaller' : 'default') : false
        exportPhase(options.compressPdf ? 'Compressing PDF…' : (individual ? 'Creating PDFs…' : 'Merging PDF…'))
        if (individual) {
          const order = Array.isArray(options.order) ? options.order : []
          const framesKnown = order.length === message.rasterSources.length // only trust the names when every page lines up with a frame
          const taken = new Set(files.map((file) => file.name.toLowerCase()))
          for (let i = 0; i < vectorPages.length; i += 1) {
            throwIfExportCancelled()
            exportPhase(`${options.compressPdf ? 'Compressing' : 'Creating'} PDF ${i + 1} of ${vectorPages.length}…`)
            const sourceIndex = vectorIndexes[i]
            const source = message.rasterSources[sourceIndex]
            const stem = stripExportExtension((framesKnown && frameNames[order[sourceIndex]]) || '') || source.baseName || String(i + 1).padStart(2, '0')
            let name = normalizedFilename(stem, 'pdf', source.baseName || 'Export')
            // Same frame name twice: "Card", "Card 2", "Card 3"
            for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = normalizedFilename(`${stem} ${n}`, 'pdf', 'Export')
            taken.add(name.toLowerCase())
            files.push({ name, mime: 'application/pdf', bytes: await buildVectorPdf([vectorPages[i]], compress) })
          }
        } else {
          const merged = await buildVectorPdf(vectorPages, compress)
          throwIfExportCancelled()
          const base = normalizedFilename(pdfName, 'pdf', 'Export').slice(0, -4)
          files.push({
            name: bothPdfs ? `${base} — Vector.pdf` : `${base}.pdf`,
            mime: 'application/pdf',
            bytes: merged,
          })
        }
      }
      throwIfExportCancelled()
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      return files
    }
