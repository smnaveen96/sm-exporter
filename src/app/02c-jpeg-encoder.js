    // ---- Minimal baseline JPEG encoder for 8-bit GRAYSCALE images ----------------------
    // Browsers can only write colour JPEGs; PDF soft masks must be single-channel, so this
    // writes a standard 1-component baseline JPEG (ITU T.81 Annex K tables).
    const GRAY_JPEG = (() => {
      const ZIGZAG = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]
      const QUANT_LUMA = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99]
      const DC_BITS = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0]
      const DC_VALS = [0,1,2,3,4,5,6,7,8,9,10,11]
      const AC_BITS = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d]
      const AC_VALS = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa]

      // Huffman code lookup: symbol → [code, length]
      function buildCodes(bits, vals) {
        const codes = new Array(256)
        let code = 0, k = 0
        for (let len = 1; len <= 16; len += 1) {
          for (let i = 0; i < bits[len - 1]; i += 1) { codes[vals[k]] = [code, len]; code += 1; k += 1 }
          code <<= 1
        }
        return codes
      }
      const DC_CODES = buildCodes(DC_BITS, DC_VALS)
      const AC_CODES = buildCodes(AC_BITS, AC_VALS)

      // Cosine table for the separable 8-point DCT
      const COS = new Float64Array(64)
      for (let u = 0; u < 8; u += 1) for (let x = 0; x < 8; x += 1) COS[u * 8 + x] = Math.cos((2 * x + 1) * u * Math.PI / 16) * (u === 0 ? Math.SQRT1_2 : 1)

      function quantTable(quality) {
        const q = Math.max(1, Math.min(100, quality))
        const scale = q < 50 ? 5000 / q : 200 - 2 * q
        return QUANT_LUMA.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))))
      }

      class BitWriter {
        constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0 }
        byte(b) { if (this.pos >= this.buf.length) { const bigger = new Uint8Array(this.buf.length * 2); bigger.set(this.buf); this.buf = bigger } this.buf[this.pos++] = b }
        bits(code, len) {
          this.acc = (this.acc << len) | code; this.n += len
          while (this.n >= 8) { const b = (this.acc >> (this.n - 8)) & 0xff; this.byte(b); if (b === 0xff) this.byte(0); this.n -= 8 }
          this.acc &= (1 << this.n) - 1
        }
        flush() { if (this.n > 0) this.bits((1 << (8 - this.n)) - 1, 8 - this.n) }
        word(w) { this.byte((w >> 8) & 0xff); this.byte(w & 0xff) }
        marker(m) { this.byte(0xff); this.byte(m) }
        result() { return this.buf.subarray(0, this.pos) }
      }

      function magnitude(v) { let a = Math.abs(v), n = 0; while (a) { n += 1; a >>= 1 } return n }
      function bitsOf(v, n) { return v >= 0 ? v : (v + (1 << n) - 1) }

      function encode(gray, width, height, quality) {
        const qt = quantTable(quality)
        const out = new BitWriter(Math.max(4096, (width * height) >> 3))
        out.marker(0xd8)
        // DQT
        out.marker(0xdb); out.word(67); out.byte(0)
        for (let i = 0; i < 64; i += 1) out.byte(qt[ZIGZAG[i]])
        // SOF0, one component, no subsampling
        out.marker(0xc0); out.word(11); out.byte(8); out.word(height); out.word(width); out.byte(1); out.byte(1); out.byte(0x11); out.byte(0)
        // DHT (DC then AC)
        for (const [cls, bits, vals] of [[0x00, DC_BITS, DC_VALS], [0x10, AC_BITS, AC_VALS]]) {
          out.marker(0xc4); out.word(3 + 16 + vals.length); out.byte(cls)
          for (const b of bits) out.byte(b)
          for (const v of vals) out.byte(v)
        }
        // SOS
        out.marker(0xda); out.word(8); out.byte(1); out.byte(1); out.byte(0x00); out.byte(0); out.byte(63); out.byte(0)

        const block = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64)
        let prevDC = 0
        for (let by = 0; by < height; by += 8) {
          for (let bx = 0; bx < width; bx += 8) {
            // gather (edge pixels replicated), level shift
            for (let y = 0; y < 8; y += 1) {
              const sy = Math.min(height - 1, by + y) * width
              for (let x = 0; x < 8; x += 1) block[y * 8 + x] = gray[sy + Math.min(width - 1, bx + x)] - 128
            }
            // rows
            for (let y = 0; y < 8; y += 1) for (let u = 0; u < 8; u += 1) {
              let s = 0; for (let x = 0; x < 8; x += 1) s += block[y * 8 + x] * COS[u * 8 + x]
              tmp[y * 8 + u] = s / 2
            }
            // columns
            for (let u = 0; u < 8; u += 1) for (let v = 0; v < 8; v += 1) {
              let s = 0; for (let y = 0; y < 8; y += 1) s += tmp[y * 8 + u] * COS[v * 8 + y]
              coef[v * 8 + u] = Math.round((s / 2) / qt[v * 8 + u])
            }
            // DC
            const dc = coef[0], diff = dc - prevDC; prevDC = dc
            const dn = magnitude(diff); const [dcode, dlen] = DC_CODES[dn]
            out.bits(dcode, dlen); if (dn) out.bits(bitsOf(diff, dn), dn)
            // AC
            let run = 0
            for (let k = 1; k < 64; k += 1) {
              const v = coef[ZIGZAG[k]]
              if (v === 0) { run += 1; continue }
              while (run > 15) { const [c, l] = AC_CODES[0xf0]; out.bits(c, l); run -= 16 }
              const n = magnitude(v); const [c, l] = AC_CODES[(run << 4) | n]
              out.bits(c, l); out.bits(bitsOf(v, n), n); run = 0
            }
            if (run > 0) { const [c, l] = AC_CODES[0x00]; out.bits(c, l) }
          }
        }
        out.flush()
        out.marker(0xd9)
        return out.result()
      }
      return { encode }
    })()


    async function compressPdfImages(doc, level) {
      const { PDFName, PDFNumber, PDFRawStream, PDFDict, PDFArray, decodePDFRawStream } = PDFLib
      const maxSide = pdfPageLimits(doc, level.pixelsPerPoint)
      console.log(LOG, `PDF compression level: JPEG q${Math.round(level.jpegQuality * 100)}, masks q${level.maskQuality}, ${level.pixelsPerPoint} px/pt`)
      let before = 0, after = 0, converted = 0, skipped = 0, masksDropped = 0, masksEncoded = 0
      // Soft masks are handled together with the image that uses them.
      const maskRefs = new Set()
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
          const mask = object.dict.get(PDFName.of('SMask'))
          if (mask && mask.objectNumber !== undefined) maskRefs.add(mask.toString())
        }
      }
      for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFRawStream)) continue
        const dict = object.dict
        if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
        if (maskRefs.has(ref.toString())) continue // processed with its parent image below
        const width = numberOf(dict.get(PDFName.of('Width')))
        const height = numberOf(dict.get(PDFName.of('Height')))
        const bpc = numberOf(dict.get(PDFName.of('BitsPerComponent')))
        const filter = dict.get(PDFName.of('Filter'))
        const filterName = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0) : null) : filter
        const channels = colorChannels(dict.get(PDFName.of('ColorSpace')), doc)
        const isJpeg = filterName === PDFName.of('DCTDecode')
        const isFlate = !filterName || filterName === PDFName.of('FlateDecode')
        const hasColorKeyMask = dict.has(PDFName.of('Mask'))
        const hasDecodeArray = dict.has(PDFName.of('Decode'))
        const describe = `${width}×${height} ${filterName ? filterName.decodeText() : 'raw'} ${channels ? channels + 'ch' : 'unsupported colour space'} ${(object.contents.length / 1024).toFixed(0)} KB`
        if (!width || !height || bpc !== 8 || !channels || !(isFlate || isJpeg) || hasColorKeyMask || hasDecodeArray) {
          console.log(LOG, `PDF image kept as is (unsupported): ${describe}`)
          skipped += 1
          continue
        }
        const scale = Math.min(1, maxSide / Math.max(width, height))
        const outWidth = Math.max(1, Math.round(width * scale))
        const outHeight = Math.max(1, Math.round(height * scale))
        // The image's soft mask (alpha): drop it when fully opaque, otherwise shrink + grayscale JPEG.
        const maskRef = dict.get(PDFName.of('SMask'))
        if (maskRef && maskRef.objectNumber !== undefined) {
          try {
            const result = await compressSoftMask(doc, dict, maskRef, Math.max(1, Math.round(outWidth * level.maskScale)), Math.max(1, Math.round(outHeight * level.maskScale)), level)
            if (result === 'dropped') masksDropped += 1
            else if (result === 'encoded') masksEncoded += 1
          } catch (error) {
            console.warn(LOG, 'Soft mask left as is', error)
          }
        }
        // Source pixels → canvas: raw pixels are decoded from the stream, JPEGs via the browser decoder.
        let full = document.createElement('canvas')
        try {
          if (isJpeg) {
            const bitmap = await createImageBitmap(new Blob([object.contents], { type: 'image/jpeg' }))
            full.width = bitmap.width; full.height = bitmap.height
            full.getContext('2d').drawImage(bitmap, 0, 0)
            bitmap.close()
          } else {
            const pixels = decodePDFRawStream(object).decode()
            if (pixels.length < width * height * channels) throw new Error('short pixel data')
            const rgba = new Uint8ClampedArray(width * height * 4)
            for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
              if (channels === 3) { rgba[p] = pixels[i * 3]; rgba[p + 1] = pixels[i * 3 + 1]; rgba[p + 2] = pixels[i * 3 + 2] }
              else { rgba[p] = rgba[p + 1] = rgba[p + 2] = pixels[i] }
              rgba[p + 3] = 255
            }
            full.width = width; full.height = height
            full.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0)
          }
        } catch (error) {
          console.warn(LOG, `PDF image decode failed, kept as is: ${describe}`, error)
          skipped += 1
          continue
        }
        before += object.contents.length
        let canvas = full
        if (scale < 1) {
          canvas = document.createElement('canvas')
          canvas.width = outWidth; canvas.height = outHeight
          const context = canvas.getContext('2d')
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          context.drawImage(full, 0, 0, outWidth, outHeight)
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', level.jpegQuality))
        if (!blob) { skipped += 1; continue }
        const jpeg = new Uint8Array(await blob.arrayBuffer())
        // Keep the original when re-encoding would not pay off (already a lean JPEG at a sane size).
        const worthIt = scale < 1 || (isJpeg ? jpeg.length < object.contents.length * 0.85 : jpeg.length < object.contents.length)
        if (!worthIt) { after += object.contents.length; console.log(LOG, `PDF image kept (no gain): ${describe}`); continue }
        console.log(LOG, `PDF image re-encoded: ${describe} → ${outWidth}×${outHeight} JPEG ${(jpeg.length / 1024).toFixed(0)} KB`)
        const newDict = doc.context.obj({})
        for (const [key, value] of dict.entries()) {
          if ([PDFName.of('Filter'), PDFName.of('DecodeParms'), PDFName.of('Length'), PDFName.of('Width'), PDFName.of('Height'), PDFName.of('BitsPerComponent'), PDFName.of('Decode')].includes(key)) continue
          newDict.set(key, value) // /ColorSpace kept as is: Figma tags photos with an sRGB ICC profile, and
        }                         // untagged DeviceRGB renders over-saturated in macOS Preview and others
        newDict.set(PDFName.of('Width'), PDFNumber.of(outWidth))
        newDict.set(PDFName.of('Height'), PDFNumber.of(outHeight))
        if (!dict.has(PDFName.of('ColorSpace'))) newDict.set(PDFName.of('ColorSpace'), PDFName.of(channels === 3 ? 'DeviceRGB' : 'DeviceGray'))
        newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
        newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
        doc.context.assign(ref, PDFRawStream.of(newDict, jpeg))
        after += jpeg.length
        converted += 1
      }
      console.log(LOG, `PDF compression: ${converted} image(s) re-encoded, ${skipped} left as is, ${masksEncoded} mask(s) encoded, ${masksDropped} opaque mask(s) removed; ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB of image data`)
    }

    // Figma attaches a full-resolution lossless alpha mask to every image; they are often the
    // bulk of the file. Fully opaque masks are removed; the rest are resized to the image's new
    // size and stored as grayscale JPEG (q80 — soft edges survive it untouched to the eye).
    async function compressSoftMask(doc, parentDict, maskRef, outWidth, outHeight, level) {
      const { PDFName, PDFNumber, PDFRawStream, PDFArray, decodePDFRawStream } = PDFLib
      const mask = doc.context.lookup(maskRef)
      if (mask === undefined) { parentDict.delete(PDFName.of('SMask')); return 'dropped' } // shared mask already removed as opaque
      if (!(mask instanceof PDFRawStream)) return 'kept'
      const md = mask.dict
      const width = numberOf(md.get(PDFName.of('Width')))
      const height = numberOf(md.get(PDFName.of('Height')))
      const filter = md.get(PDFName.of('Filter'))
      const filterName = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0) : null) : filter
      const isFlate = !filterName || filterName === PDFName.of('FlateDecode')
      if (!width || !height || numberOf(md.get(PDFName.of('BitsPerComponent'))) !== 8 || md.get(PDFName.of('ColorSpace')) !== PDFName.of('DeviceGray') || !isFlate || md.has(PDFName.of('Matte')) || md.has(PDFName.of('Decode'))) {
        console.log(LOG, `Soft mask kept as is (unsupported): ${width}×${height}`)
        return 'kept'
      }
      const pixels = decodePDFRawStream(mask).decode()
      if (pixels.length < width * height) return 'kept'
      let opaque = true
      for (let i = 0; i < width * height; i += 1) { if (pixels[i] !== 255) { opaque = false; break } }
      if (opaque) {
        parentDict.delete(PDFName.of('SMask'))
        doc.context.delete(maskRef)
        console.log(LOG, `Soft mask removed (fully opaque): ${width}×${height} ${(mask.contents.length / 1024).toFixed(0)} KB`)
        return 'dropped'
      }
      // Resize to the parent's output size when needed (canvas, high-quality smoothing).
      let gray = pixels.subarray(0, width * height), gw = width, gh = height
      if (outWidth !== width || outHeight !== height) {
        const rgba = new Uint8ClampedArray(width * height * 4)
        for (let i = 0, p = 0; i < width * height; i += 1, p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = pixels[i]; rgba[p + 3] = 255 }
        const full = document.createElement('canvas'); full.width = width; full.height = height
        full.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0)
        const small = document.createElement('canvas'); small.width = outWidth; small.height = outHeight
        const context = small.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
        context.drawImage(full, 0, 0, outWidth, outHeight)
        const data = context.getImageData(0, 0, outWidth, outHeight).data
        gray = new Uint8Array(outWidth * outHeight)
        for (let i = 0; i < gray.length; i += 1) gray[i] = data[i * 4]
        gw = outWidth; gh = outHeight
      }
      const jpeg = GRAY_JPEG.encode(gray, gw, gh, level.maskQuality)
      if (jpeg.length >= mask.contents.length) { console.log(LOG, `Soft mask kept (no gain): ${width}×${height}`); return 'kept' }
      const newDict = doc.context.obj({})
      for (const [key, value] of md.entries()) {
        if ([PDFName.of('Filter'), PDFName.of('DecodeParms'), PDFName.of('Length'), PDFName.of('Width'), PDFName.of('Height')].includes(key)) continue
        newDict.set(key, value)
      }
      newDict.set(PDFName.of('Width'), PDFNumber.of(gw))
      newDict.set(PDFName.of('Height'), PDFNumber.of(gh))
      newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'))
      newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
      newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
      doc.context.assign(maskRef, PDFRawStream.of(newDict, jpeg))
      console.log(LOG, `Soft mask encoded: ${width}×${height} ${(mask.contents.length / 1024).toFixed(0)} KB → ${gw}×${gh} JPEG ${(jpeg.length / 1024).toFixed(0)} KB`)
      return 'encoded'
    }

    function numberOf(value) {
      return value && typeof value.asNumber === 'function' ? value.asNumber() : null
    }

    // 3 for RGB-like colour spaces, 1 for grey, null for anything we should not touch.
    function colorChannels(space, doc) {
      const { PDFName, PDFArray, PDFRef } = PDFLib
      if (space instanceof PDFRef) space = doc.context.lookup(space)
      if (space === PDFName.of('DeviceRGB') || space === PDFName.of('CalRGB')) return 3
      if (space === PDFName.of('DeviceGray') || space === PDFName.of('CalGray')) return 1
      if (space instanceof PDFArray && space.size() >= 2) {
        const family = space.get(0)
        if (family === PDFName.of('ICCBased')) {
          const stream = doc.context.lookup(space.get(1))
          const n = stream && stream.dict ? numberOf(stream.dict.get(PDFName.of('N'))) : null
          return n === 3 ? 3 : n === 1 ? 1 : null
        }
        if (family === PDFName.of('CalRGB')) return 3
        if (family === PDFName.of('CalGray')) return 1
      }
      return null
    }



    async function downloadZip(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      URL.revokeObjectURL(url)
    }

    async function downloadSingle(name, bytes, mime) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      URL.revokeObjectURL(url)
    }

    async function finishExport(message) {
      const files = await generateFiles(message)
      if (files.length === 1) {
        // One file → download it directly, no ZIP (already named from the typed file name, if any).
        const file = files[0]
        const name = file.name
        setButtonState('busy', 'SAVING')
        await downloadSingle(name, file.bytes, file.mime)
      } else {
        setButtonState('busy', 'CREATING ZIP')
        const zip = buildZip(files)
        const zipFrame = message.rasterSources.length === 1 && frameOrder.length === 1 ? (frameNames[frameOrder[0]] || '') : ''
        await downloadZip(normalizedFilename(message.options.typedName || zipFrame || message.options.fileName, 'zip', 'SM Export'), zip)
      }
      busy = false
      setButtonState('success', 'EXPORTED')
      updateButton()
      setTimeout(() => setButtonState('', 'EXPORT'), 900)
    }

