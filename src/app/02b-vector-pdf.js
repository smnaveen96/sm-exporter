    // ===================== Vector PDF: merge + optional compression =====================
    // Figma exports one vector PDF per frame; pdf-lib merges them into one document.
    // Compression re-encodes the embedded images (Figma stores them as raw pixels) as
    // high-quality JPEG and downsamples anything far beyond what the page can show, while
    // leaving vectors, text and fonts untouched.
    // Compress levels. Default keeps everything visually identical; Smaller trades a little
    // photo sharpness (visible only zoomed in) for roughly 30–40% less.
    const PDF_COMPRESS_LEVELS = {
      default: { jpegQuality: 0.8, maskQuality: 80, pixelsPerPoint: 2,   maskScale: 1 },   // ≈144 ppi at page size
      smaller: { jpegQuality: 0.7, maskQuality: 75, pixelsPerPoint: 1.5, maskScale: 0.5 }, // ≈108 ppi, half-res masks
    }

    async function buildVectorPdf(pages, compress) {
      const { PDFDocument } = PDFLib
      const merged = await PDFDocument.create()
      for (const bytes of pages) {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const copied = await merged.copyPages(doc, doc.getPageIndices())
        for (const page of copied) merged.addPage(page)
      }
      merged.setProducer('SM exporter')
      merged.setCreator('Figma / SM exporter')
      if (pages.length > 1) deduplicateObjects(merged) // lossless: Figma embeds a fresh copy of each image/font per frame
      if (compress) {
        try { optimizeVectorContent(merged) } catch (error) { console.warn(LOG, 'Vector data optimisation skipped', error) }
        await compressPdfImages(merged, PDF_COMPRESS_LEVELS[compress] || PDF_COMPRESS_LEVELS.default)
      }
      return merged.save({ useObjectStreams: true })
    }

    // ---- Lossless de-duplication of identical streams and dictionaries ------------------
    // Figma writes every frame as its own PDF, so a logo used on 7 slides is embedded 7 times
    // (plus 7 masks and 7 copies of the glyphs). Identical objects are merged into one and all
    // references repointed. Runs in passes so that, once two masks are merged, the images that
    // reference them become identical too, and so on up the tree.
    function fnv1a(bytes, seed) {
      let h = seed >>> 0
      for (let i = 0; i < bytes.length; i += 1) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0 }
      return h
    }
    function objectSignature(object) {
      const { PDFRawStream, PDFDict, PDFArray } = PDFLib
      if (object instanceof PDFRawStream) {
        // Figma writes /Length as an indirect object, so two identical streams carry different
        // /Length refs — leave it out (the byte length is part of the signature anyway).
        const head = object.dict.entries()
          .filter(([key]) => key.toString() !== '/Length')
          .map(([key, value]) => `${key.toString()} ${value.toString()}`)
          .sort()
          .join(' ')
        return `S|${head}|${object.contents.length}|${fnv1a(object.contents, 2166136261)}|${fnv1a(object.contents, 0x9747b28c)}`
      }
      if (object instanceof PDFDict) return `D|${object.toString()}`
      if (object instanceof PDFArray) return `A|${object.toString()}` // e.g. [/ICCBased 10 0 R] colour spaces
      return null
    }
    function sameBytes(a, b) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
      return true
    }
    function isStructural(object) {
      const { PDFName, PDFRawStream, PDFDict, PDFArray } = PDFLib
      if (object instanceof PDFArray) return false
      const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null
      if (!dict) return true
      const type = dict.get(PDFName.of('Type'))
      return [PDFName.of('Page'), PDFName.of('Pages'), PDFName.of('Catalog'), PDFName.of('ObjStm'), PDFName.of('XRef'), PDFName.of('Metadata')].includes(type)
    }
    function remapRefs(value, map) {
      const { PDFRef, PDFDict, PDFArray, PDFRawStream } = PDFLib
      if (value instanceof PDFRawStream) { remapRefs(value.dict, map); return }
      if (value instanceof PDFDict) {
        for (const [key, entry] of value.entries()) {
          if (entry instanceof PDFRef) { const target = map.get(entry.toString()); if (target) value.set(key, target) }
          else remapRefs(entry, map)
        }
        return
      }
      if (value instanceof PDFArray) {
        for (let i = 0; i < value.size(); i += 1) {
          const entry = value.get(i)
          if (entry instanceof PDFRef) { const target = map.get(entry.toString()); if (target) value.set(i, target) }
          else remapRefs(entry, map)
        }
      }
    }
    function deduplicateObjects(doc) {
      const { PDFRawStream } = PDFLib
      let totalMerged = 0, savedBytes = 0
      for (let pass = 0; pass < 6; pass += 1) {
        const seen = new Map() // signature → { ref, object }
        const map = new Map()  // duplicate ref string → canonical ref
        const toDelete = []
        for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
          if (isStructural(object)) continue
          const signature = objectSignature(object)
          if (!signature) continue
          const canonical = seen.get(signature)
          if (canonical && (!(object instanceof PDFRawStream) || sameBytes(object.contents, canonical.object.contents))) {
            map.set(ref.toString(), canonical.ref)
            toDelete.push(ref)
            if (object instanceof PDFRawStream) savedBytes += object.contents.length
          } else if (!canonical) {
            seen.set(signature, { ref, object })
          }
        }
        if (map.size === 0) break
        for (const [, object] of doc.context.enumerateIndirectObjects()) remapRefs(object, map)
        remapRefs(doc.catalog, map)
        for (const ref of toDelete) doc.context.delete(ref)
        totalMerged += map.size
      }
      if (totalMerged) console.log(LOG, `PDF de-duplication: ${totalMerged} identical object(s) merged, ${(savedBytes / 1048576).toFixed(1)} MB of repeated data removed`)
    }

    // ---- Vector drawing data: rounding + tighter packing --------------------------------------
    // Figma writes path coordinates with six decimals (393.199951). Rounding them to hundredths of
    // a point is invisible, even zoomed far in, and shrinks big illustrations by about half. The
    // scale a stream is drawn at is tracked, so precision is kept when something is scaled up.
    // Only the numbers of path operators (m l c v y re) are touched — never text, strings, images or
    // matrices. Streams that contain inline images, or that cannot be decoded, are left as they are.
    function isNumberToken(bytes, start, end) {
      let digits = 0, i = start
      if (bytes[i] === 43 || bytes[i] === 45) i += 1
      let dot = false
      for (; i < end; i += 1) {
        const c = bytes[i]
        if (c >= 48 && c <= 57) digits += 1
        else if (c === 46 && !dot) dot = true
        else return false
      }
      return digits > 0
    }

    function roundContentStream(bytes, inheritedScale, onDo, rewrite) {
      const n = bytes.length
      const chunks = []
      let copyFrom = 0, changed = false
      let depth = 0
      let operands = []
      let ctm = [1, 0, 0, 1, 0, 0]
      const stack = []
      const PATH_ARITY = { m: 2, l: 2, c: 6, v: 4, y: 4, re: 4 }
      const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0
      const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37
      const text = (s, e) => { let out = ''; for (let k = s; k < e; k += 1) out += String.fromCharCode(bytes[k]); return out }
      const scaleNow = () => { const det = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]); return inheritedScale * (det > 0 ? Math.sqrt(det) : 1) }
      let i = 0
      while (i < n) {
        const c = bytes[i]
        if (isWs(c)) { i += 1; continue }
        if (c === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i += 1; continue } // comment
        if (c === 40) { // string
          let level = 1; i += 1
          while (i < n && level > 0) { const d = bytes[i]; if (d === 92) i += 2; else { if (d === 40) level += 1; else if (d === 41) level -= 1; i += 1 } }
          if (depth === 0) operands.push({ kind: 'other' })
          continue
        }
        if (c === 60) {
          if (bytes[i + 1] === 60) { depth += 1; i += 2; continue }
          while (i < n && bytes[i] !== 62) i += 1
          i += 1
          if (depth === 0) operands.push({ kind: 'other' })
          continue
        }
        if (c === 62) { if (bytes[i + 1] === 62) { depth = Math.max(0, depth - 1); i += 2 } else i += 1; continue }
        if (c === 91) { depth += 1; i += 1; continue }
        if (c === 93) { depth = Math.max(0, depth - 1); i += 1; continue }
        if (c === 123 || c === 125 || c === 41) { i += 1; continue }
        if (c === 47) { // name
          const s = i; i += 1
          while (i < n && !isWs(bytes[i]) && !isDelim(bytes[i])) i += 1
          if (depth === 0) operands.push({ kind: 'name', start: s, end: i })
          continue
        }
        const s = i
        while (i < n && !isWs(bytes[i]) && !isDelim(bytes[i])) i += 1
        const e = i
        if (depth > 0) continue
        if (isNumberToken(bytes, s, e)) { operands.push({ kind: 'num', start: s, end: e }); continue }
        // operator
        const op = text(s, e)
        if (op === 'BI' || op === 'ID' || op === 'EI') return null // inline image: leave the whole stream alone
        if (op === 'q') stack.push(ctm.slice())
        else if (op === 'Q') { if (stack.length) ctm = stack.pop() }
        else if (op === 'cm' && operands.length === 6 && operands.every((o) => o.kind === 'num')) {
          const m = operands.map((o) => parseFloat(text(o.start, o.end)))
          const [A, B, C, D, E, F] = ctm
          ctm = [m[0] * A + m[1] * C, m[0] * B + m[1] * D, m[2] * A + m[3] * C, m[2] * B + m[3] * D, m[4] * A + m[5] * C + E, m[4] * B + m[5] * D + F]
        } else if (op === 'Do' && operands.length === 1 && operands[0].kind === 'name') {
          if (onDo) onDo(text(operands[0].start + 1, operands[0].end), scaleNow())
        } else if (rewrite && PATH_ARITY[op] === operands.length && operands.every((o) => o.kind === 'num')) {
          // Error budget: ≤ 0.005 pt on the page, whatever the scale this is drawn at.
          const decimals = Math.max(2, Math.min(6, Math.ceil(Math.log10(100 * scaleNow()))))
          for (const o of operands) {
            const raw = text(o.start, o.end)
            const dot = raw.indexOf('.')
            if (dot < 0 || raw.length - dot - 1 <= decimals) continue
            let t = parseFloat(raw).toFixed(decimals)
            if (t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, '')
            if (t === '-0' || t === '') t = '0'
            chunks.push(bytes.subarray(copyFrom, o.start))
            const encoded = new Uint8Array(t.length)
            for (let k = 0; k < t.length; k += 1) encoded[k] = t.charCodeAt(k)
            chunks.push(encoded)
            copyFrom = o.end
            changed = true
          }
        }
        operands = []
      }
      if (!rewrite || !changed) return bytes
      chunks.push(bytes.subarray(copyFrom))
      return concatBytes(chunks)
    }

    function decodedContent(stream) {
      const { PDFName, PDFRawStream, PDFArray, decodePDFRawStream } = PDFLib
      if (!(stream instanceof PDFRawStream)) return null
      if (stream.dict.has(PDFName.of('DecodeParms'))) return null
      const filter = stream.dict.get(PDFName.of('Filter'))
      const name = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0) : null) : filter
      if (filter && name !== PDFName.of('FlateDecode')) return null
      try { return filter ? decodePDFRawStream(stream).decode() : stream.contents } catch (error) { return null }
    }

    function matrixScale(dict) {
      const { PDFName, PDFArray } = PDFLib
      const m = dict.lookup(PDFName.of('Matrix'))
      if (!(m instanceof PDFArray) || m.size() !== 6) return 1
      const v = []
      for (let k = 0; k < 6; k += 1) { const x = m.lookup(k); v.push(x && typeof x.asNumber === 'function' ? x.asNumber() : NaN) }
      const det = Math.abs(v[0] * v[3] - v[1] * v[2])
      return Number.isFinite(det) && det > 0 ? Math.sqrt(det) : 1
    }

    function optimizeVectorContent(doc) {
      const { PDFName, PDFRef, PDFDict, PDFArray, PDFRawStream, PDFNumber } = PDFLib
      const started = performance.now()
      const formScales = new Map() // form ref → largest scale it is drawn at (through any chain of Do)
      const toRewrite = []          // { ref, scale }
      const walk = (stream, resources, inherited, depth) => {
        if (depth > 8) return
        const bytes = decodedContent(stream)
        if (!bytes) return
        roundContentStream(bytes, inherited, (name, scale) => {
          const xobjects = resources && resources.lookup(PDFName.of('XObject'), PDFDict)
          const ref = xobjects && xobjects.get(PDFName.of(name))
          if (!(ref instanceof PDFRef)) return
          const form = doc.context.lookup(ref)
          if (!(form instanceof PDFRawStream) || form.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) return
          const total = scale * matrixScale(form.dict)
          const key = ref.toString()
          const previous = formScales.get(key)
          if (previous !== undefined && previous >= total) return
          formScales.set(key, total)
          walk(form, form.dict.lookup(PDFName.of('Resources'), PDFDict) || resources, total, depth + 1)
        }, false)
      }
      for (const page of doc.getPages()) {
        const resources = page.node.Resources()
        const entry = page.node.get(PDFName.of('Contents'))
        const refs = entry instanceof PDFRef ? [entry] : entry instanceof PDFArray ? Array.from({ length: entry.size() }, (_, k) => entry.get(k)).filter((r) => r instanceof PDFRef) : []
        for (const ref of refs) {
          const stream = doc.context.lookup(ref)
          toRewrite.push({ ref, scale: 1 })
          walk(stream, resources, 1, 0)
        }
      }
      for (const [key, scale] of formScales) {
        const [objectNumber, generation] = key.split(' ')
        toRewrite.push({ ref: PDFRef.of(Number(objectNumber), Number(generation)), scale })
      }
      let before = 0, after = 0, streams = 0
      for (const { ref, scale } of toRewrite) {
        const stream = doc.context.lookup(ref)
        if (!(stream instanceof PDFRawStream)) continue
        const bytes = decodedContent(stream)
        if (!bytes) continue
        let rounded
        try { rounded = roundContentStream(bytes, scale, null, true) } catch (error) { console.warn(LOG, 'Vector data left as is', error); continue }
        if (rounded === null) continue
        const packed = fflate.zlibSync(rounded, { level: 9, mem: 12 })
        before += stream.contents.length
        if (packed.length >= stream.contents.length) { after += stream.contents.length; continue }
        const dict = doc.context.obj({})
        for (const [key, value] of stream.dict.entries()) {
          if (key === PDFName.of('Filter') || key === PDFName.of('DecodeParms') || key === PDFName.of('Length')) continue
          dict.set(key, value)
        }
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
        doc.context.assign(ref, PDFRawStream.of(dict, packed))
        after += packed.length
        streams += 1
      }
      console.log(LOG, `PDF vector data: ${streams} stream(s) repacked, ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB, ${Math.round(performance.now() - started)} ms`)
    }

    function pdfPageLimits(doc, pixelsPerPoint) {
      let maxSide = 0
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize()
        maxSide = Math.max(maxSide, width, height)
      }
      return Math.max(512, Math.round(maxSide * pixelsPerPoint))
    }

