    // ---- Lossless PNG optimisation ----------------------------------------------------------
    // Figma writes a plain 32-bit RGBA PNG with quick compression. This re-packs the same pixels
    // (bit for bit — the PNG is decoded here, not through a canvas, so translucent pixels are
    // not premultiplied) into the smallest form: alpha dropped when fully opaque, a palette when
    // there are ≤256 colours, grayscale when R=G=B, the best filter per row, maximum deflate.
    // Falls back to Figma's bytes whenever they are smaller or the PNG is an unusual variant.
    const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

    function readPngChunks(bytes) {
      for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG')
      const chunks = []
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      let offset = 8
      while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset)
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
        chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) })
        offset += 12 + length
        if (type === 'IEND') break
      }
      return chunks
    }

    // Decodes 8-bit, non-interlaced PNGs (colour types 0, 2, 3, 4, 6) to straight RGBA.
    function decodePng(bytes) {
      const chunks = readPngChunks(bytes)
      const header = chunks.find((c) => c.type === 'IHDR')
      if (!header) throw new Error('no IHDR')
      const hv = new DataView(header.data.buffer, header.data.byteOffset, 13)
      const width = hv.getUint32(0), height = hv.getUint32(4)
      const bitDepth = header.data[8], colorType = header.data[9], interlace = header.data[12]
      if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType)) return null
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
      const idat = chunks.filter((c) => c.type === 'IDAT')
      const total = idat.reduce((n, c) => n + c.data.length, 0)
      const compressed = new Uint8Array(total)
      let p = 0
      for (const c of idat) { compressed.set(c.data, p); p += c.data.length }
      const raw = fflate.unzlibSync(compressed)
      const stride = width * channels
      if (raw.length < (stride + 1) * height) return null
      // Unfilter in place into `pixels` (no filter bytes).
      const pixels = new Uint8Array(stride * height)
      for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)]
        const src = y * (stride + 1) + 1
        const dst = y * stride
        const prev = dst - stride
        for (let x = 0; x < stride; x += 1) {
          const a = x >= channels ? pixels[dst + x - channels] : 0
          const b = y > 0 ? pixels[prev + x] : 0
          const c = (y > 0 && x >= channels) ? pixels[prev + x - channels] : 0
          let value = raw[src + x]
          if (filter === 1) value += a
          else if (filter === 2) value += b
          else if (filter === 3) value += (a + b) >> 1
          else if (filter === 4) {
            const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
            value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
          } else if (filter !== 0) return null
          pixels[dst + x] = value & 0xff
        }
      }
      // Expand to RGBA.
      const rgba = new Uint8Array(width * height * 4)
      if (colorType === 6) rgba.set(pixels)
      else if (colorType === 2) for (let i = 0, o = 0; i < pixels.length; i += 3, o += 4) { rgba[o] = pixels[i]; rgba[o + 1] = pixels[i + 1]; rgba[o + 2] = pixels[i + 2]; rgba[o + 3] = 255 }
      else if (colorType === 0) for (let i = 0, o = 0; i < pixels.length; i += 1, o += 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[i]; rgba[o + 3] = 255 }
      else if (colorType === 4) for (let i = 0, o = 0; i < pixels.length; i += 2, o += 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[i]; rgba[o + 3] = pixels[i + 1] }
      else {
        const plte = chunks.find((c) => c.type === 'PLTE'), trns = chunks.find((c) => c.type === 'tRNS')
        if (!plte) return null
        for (let i = 0, o = 0; i < pixels.length; i += 1, o += 4) {
          const k = pixels[i]
          rgba[o] = plte.data[k * 3]; rgba[o + 1] = plte.data[k * 3 + 1]; rgba[o + 2] = plte.data[k * 3 + 2]
          rgba[o + 3] = trns && k < trns.data.length ? trns.data[k] : 255
        }
      }
      return { width, height, rgba }
    }

    function pngChunk(type, data) {
      const out = new Uint8Array(12 + data.length)
      const view = new DataView(out.buffer)
      view.setUint32(0, data.length)
      for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
      out.set(data, 8)
      view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
      return out
    }

    // Picks the filter with the smallest sum of absolute (signed) residuals for each row —
    // the standard heuristic libpng/oxipng use — and returns the filtered scanlines.
    function filterScanlines(pixels, width, height, bpp) {
      const stride = width * bpp
      const out = new Uint8Array((stride + 1) * height)
      const candidates = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)]
      for (let y = 0; y < height; y += 1) {
        const row = y * stride, prev = row - stride
        let bestType = 0, bestScore = Infinity
        for (let type = 0; type < 5; type += 1) {
          const buf = candidates[type]
          let score = 0
          for (let x = 0; x < stride; x += 1) {
            const cur = pixels[row + x]
            const a = x >= bpp ? pixels[row + x - bpp] : 0
            const b = y > 0 ? pixels[prev + x] : 0
            const c = (y > 0 && x >= bpp) ? pixels[prev + x - bpp] : 0
            let v
            if (type === 0) v = cur
            else if (type === 1) v = cur - a
            else if (type === 2) v = cur - b
            else if (type === 3) v = cur - ((a + b) >> 1)
            else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = cur - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)) }
            v &= 0xff
            buf[x] = v
            score += v < 128 ? v : 256 - v
            if (score >= bestScore) break
          }
          if (score < bestScore) { bestScore = score; bestType = type }
        }
        out[y * (stride + 1)] = bestType
        out.set(candidates[bestType], y * (stride + 1) + 1)
      }
      return out
    }

    // ---- Near-lossless palette quantisation (pngquant / TinyPNG style) --------------------
    // Reduces an RGBA image to ≤256 colours (median cut on a 5-5-5-4 bit histogram, refined by
    // k-means) and maps pixels with reduced Floyd–Steinberg dithering. The caller checks the
    // returned error (PSNR of the undithered mapping) and only keeps the result when it is
    // close enough to the original to be indistinguishable.
    function quantizeRgba(rgba, width, height, maxColours) {
      const count = width * height
      const BINS = 1 << 19
      const binCount = new Uint32Array(BINS)
      const sums = [new Float64Array(BINS), new Float64Array(BINS), new Float64Array(BINS), new Float64Array(BINS)]
      const keyOf = (r, g, b, a) => ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4)
      let hasTransparent = false
      for (let i = 0, o = 0; i < count; i += 1, o += 4) {
        const a = rgba[o + 3]
        if (a === 0) { hasTransparent = true; continue } // fully transparent: colour is irrelevant
        const k = keyOf(rgba[o], rgba[o + 1], rgba[o + 2], a)
        binCount[k] += 1; sums[0][k] += rgba[o]; sums[1][k] += rgba[o + 1]; sums[2][k] += rgba[o + 2]; sums[3][k] += a
      }
      // Populated bins → colour list. When the image has few exact colours (flat art, gradients
      // with ≤ 64k shades) use them exactly; otherwise the 5-5-5-4 bins stand in for them.
      let bins = []
      const exact = new Map()
      const pixels32 = new Uint32Array(rgba.buffer, rgba.byteOffset, count)
      for (let i = 0; i < count && exact.size <= 65536; i += 1) {
        if (rgba[i * 4 + 3] === 0) continue
        const v = pixels32[i]
        exact.set(v, (exact.get(v) || 0) + 1)
      }
      if (exact.size <= 65536) {
        for (const [v, n] of exact) bins.push({ r: v & 0xff, g: (v >>> 8) & 0xff, b: (v >>> 16) & 0xff, a: (v >>> 24) & 0xff, n })
      } else {
        for (let k = 0; k < BINS; k += 1) {
          const n = binCount[k]
          if (n) bins.push({ r: sums[0][k] / n, g: sums[1][k] / n, b: sums[2][k] / n, a: sums[3][k] / n, n })
        }
      }
      const target = maxColours - (hasTransparent ? 1 : 0)
      // Median cut
      let boxes = [bins]
      const range = (box, ch) => { let lo = Infinity, hi = -Infinity; for (const c of box) { const v = c[ch]; if (v < lo) lo = v; if (v > hi) hi = v } return hi - lo }
      while (boxes.length < target) {
        let bestIndex = -1, bestScore = 0
        for (let i = 0; i < boxes.length; i += 1) {
          const box = boxes[i]
          if (box.length < 2) continue
          const spread = Math.max(range(box, 'r'), range(box, 'g'), range(box, 'b'), range(box, 'a') * 2)
          let weight = 0; for (const c of box) weight += c.n
          const score = spread * Math.sqrt(weight)
          if (score > bestScore) { bestScore = score; bestIndex = i }
        }
        if (bestIndex < 0) break
        const box = boxes[bestIndex]
        const spreads = { r: range(box, 'r'), g: range(box, 'g'), b: range(box, 'b'), a: range(box, 'a') * 2 }
        const axis = Object.keys(spreads).reduce((x, y) => (spreads[y] > spreads[x] ? y : x))
        box.sort((x, y) => x[axis] - y[axis])
        let total = 0; for (const c of box) total += c.n
        let acc = 0, cut = 0
        for (; cut < box.length - 1; cut += 1) { acc += box[cut].n; if (acc >= total / 2) { cut += 1; break } }
        cut = Math.max(1, Math.min(box.length - 1, cut))
        boxes.splice(bestIndex, 1, box.slice(0, cut), box.slice(cut))
      }
      const palette = boxes.map((box) => {
        let n = 0, r = 0, g = 0, b = 0, a = 0
        for (const c of box) { n += c.n; r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; a += c.a * c.n }
        return [r / n, g / n, b / n, a / n]
      })
      // k-means refinement on the bins (cheap: bins ≪ pixels)
      const nearestIndex = (r, g, b, a) => {
        let best = 0, bestD = Infinity
        for (let i = 0; i < palette.length; i += 1) {
          const p = palette[i]
          const dr = p[0] - r, dg = p[1] - g, db = p[2] - b, da = (p[3] - a) * 2
          const d = dr * dr + dg * dg + db * db + da * da
          if (d < bestD) { bestD = d; best = i }
        }
        return best
      }
      for (let iteration = 0; iteration < (bins.length > 20000 ? 2 : 3); iteration += 1) {
        const acc = palette.map(() => [0, 0, 0, 0, 0])
        for (const c of bins) { const i = nearestIndex(c.r, c.g, c.b, c.a); const t = acc[i]; t[0] += c.r * c.n; t[1] += c.g * c.n; t[2] += c.b * c.n; t[3] += c.a * c.n; t[4] += c.n }
        for (let i = 0; i < palette.length; i += 1) if (acc[i][4]) palette[i] = [acc[i][0] / acc[i][4], acc[i][1] / acc[i][4], acc[i][2] / acc[i][4], acc[i][3] / acc[i][4]]
      }
      // Final palette bytes; a fully transparent entry when needed
      const paletteBytes = new Uint8Array((palette.length + (hasTransparent ? 1 : 0)) * 4)
      palette.forEach((p, i) => { paletteBytes[i * 4] = Math.round(p[0]); paletteBytes[i * 4 + 1] = Math.round(p[1]); paletteBytes[i * 4 + 2] = Math.round(p[2]); paletteBytes[i * 4 + 3] = Math.round(p[3]) })
      const transparentIndex = hasTransparent ? palette.length : -1
      const n = palette.length + (hasTransparent ? 1 : 0)
      // Nearest-colour cache on a 6-6-6-4 grid (dithering produces many intermediate values)
      const cache = new Int16Array(1 << 22).fill(-1)
      const nearestByte = (r, g, b, a) => {
        const k = ((r >> 2) << 16) | ((g >> 2) << 10) | ((b >> 2) << 4) | (a >> 4)
        let i = cache[k]
        if (i < 0) {
          let bestD = Infinity; i = 0
          for (let j = 0; j < palette.length; j += 1) {
            const dr = paletteBytes[j * 4] - r, dg = paletteBytes[j * 4 + 1] - g, db = paletteBytes[j * 4 + 2] - b, da = (paletteBytes[j * 4 + 3] - a) * 2
            const d = dr * dr + dg * dg + db * db + da * da
            if (d < bestD) { bestD = d; i = j }
          }
          cache[k] = i
        }
        return i
      }
      // Undithered error (palette adequacy) — the quality gate
      let sq = 0
      for (let i = 0, o = 0; i < count; i += 1, o += 4) {
        if (rgba[o + 3] === 0) continue
        const j = nearestByte(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])
        const dr = paletteBytes[j * 4] - rgba[o], dg = paletteBytes[j * 4 + 1] - rgba[o + 1], db = paletteBytes[j * 4 + 2] - rgba[o + 2], da = paletteBytes[j * 4 + 3] - rgba[o + 3]
        sq += dr * dr + dg * dg + db * db + da * da
      }
      const mse = sq / (count * 4)
      const psnr = 10 * Math.log10(255 * 255 / Math.max(mse, 1e-9))
      // Reduced Floyd–Steinberg, serpentine. Error carried at 3/4 strength: enough to break banding, low grain.
      const indices = new Uint8Array(count)
      const errNext = new Float32Array((width + 2) * 4), errCur = new Float32Array((width + 2) * 4)
      const STRENGTH = 0.75
      for (let y = 0; y < height; y += 1) {
        errCur.set(errNext); errNext.fill(0)
        const ltr = (y & 1) === 0
        for (let step = 0; step < width; step += 1) {
          const x = ltr ? step : width - 1 - step
          const o = (y * width + x) * 4, e = (x + 1) * 4
          if (rgba[o + 3] === 0) { indices[y * width + x] = transparentIndex; continue }
          const r = Math.max(0, Math.min(255, Math.round(rgba[o] + errCur[e]))), g = Math.max(0, Math.min(255, Math.round(rgba[o + 1] + errCur[e + 1])))
          const b = Math.max(0, Math.min(255, Math.round(rgba[o + 2] + errCur[e + 2]))), a = Math.max(0, Math.min(255, Math.round(rgba[o + 3] + errCur[e + 3])))
          const j = nearestByte(r, g, b, a)
          indices[y * width + x] = j
          const dr = (r - paletteBytes[j * 4]) * STRENGTH, dg = (g - paletteBytes[j * 4 + 1]) * STRENGTH, db = (b - paletteBytes[j * 4 + 2]) * STRENGTH, da = (a - paletteBytes[j * 4 + 3]) * STRENGTH
          const ahead = ltr ? e + 4 : e - 4, behind = ltr ? e - 4 : e + 4
          errCur[ahead] += dr * 7 / 16; errCur[ahead + 1] += dg * 7 / 16; errCur[ahead + 2] += db * 7 / 16; errCur[ahead + 3] += da * 7 / 16
          errNext[behind] += dr * 3 / 16; errNext[behind + 1] += dg * 3 / 16; errNext[behind + 2] += db * 3 / 16; errNext[behind + 3] += da * 3 / 16
          errNext[e] += dr * 5 / 16; errNext[e + 1] += dg * 5 / 16; errNext[e + 2] += db * 5 / 16; errNext[e + 3] += da * 5 / 16
          errNext[ahead] += dr / 16; errNext[ahead + 1] += dg / 16; errNext[ahead + 2] += db / 16; errNext[ahead + 3] += da / 16
        }
      }
      return { indices, palette: paletteBytes, count: n, psnr, colours: bins.length }
    }

    // Assembles a PNG from prepared sample data (already in the target colour type).
    function packPng(data, colorType, bpp, width, height, paletteRgba, paletteCount) {
      const filtered = filterScanlines(data, width, height, bpp)
      // Level 9 everywhere except very large renders (3x), where 6 keeps export snappy.
      const level = filtered.length > 40 * 1048576 ? 6 : 9
      const idat = fflate.zlibSync(filtered, { level, mem: 12 })
      const header = new Uint8Array(13)
      const hv = new DataView(header.buffer)
      hv.setUint32(0, width); hv.setUint32(4, height)
      header[8] = 8; header[9] = colorType; header[10] = 0; header[11] = 0; header[12] = 0
      const parts = [new Uint8Array(PNG_SIGNATURE), pngChunk('IHDR', header)]
      if (colorType === 3) {
        const plte = new Uint8Array(paletteCount * 3)
        const trns = new Uint8Array(paletteCount)
        let lastTransparent = -1
        for (let i = 0; i < paletteCount; i += 1) {
          plte[i * 3] = paletteRgba[i * 4]; plte[i * 3 + 1] = paletteRgba[i * 4 + 1]; plte[i * 3 + 2] = paletteRgba[i * 4 + 2]
          trns[i] = paletteRgba[i * 4 + 3]
          if (trns[i] !== 255) lastTransparent = i
        }
        parts.push(pngChunk('PLTE', plte))
        if (lastTransparent >= 0) parts.push(pngChunk('tRNS', trns.subarray(0, lastTransparent + 1)))
      }
      parts.push(pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0)))
      return concatBytes(parts)
    }

    // Quantised results are used only when they are this close to the original — the level at
    // which pixel differences are below what the eye can pick up on a screen (≈ JPEG q90+).
    const PNG_NEAR_LOSSLESS_MIN_PSNR = 40

    function optimizePng(bytes) {
      const started = performance.now()
      let decoded
      try { decoded = decodePng(bytes) } catch (error) { console.warn(LOG, 'PNG kept as is (could not decode)', error); return bytes }
      if (!decoded) { console.log(LOG, 'PNG kept as is (unusual variant)'); return bytes }
      const { width, height, rgba } = decoded
      const count = width * height
      if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) return bytes // palette packing assumes little-endian
      // ~0.5 s per megapixel; beyond 16 MP (a 4x social frame) the wait outweighs the saving.
      if (count > 16 * 1048576) { console.log(LOG, `PNG kept as is: ${width}×${height} is too large to optimise quickly`); return bytes }
      // Analyse: opaque? grayscale? ≤256 distinct colours?
      let opaque = true, gray = true
      const colours = new Map() // rgba uint32 → palette index
      const pixels32 = new Uint32Array(rgba.buffer, rgba.byteOffset, count)
      for (let i = 0; i < count; i += 1) {
        const o = i * 4
        if (rgba[o + 3] !== 255) opaque = false
        if (rgba[o] !== rgba[o + 1] || rgba[o] !== rgba[o + 2]) gray = false
        if (colours.size <= 256 && !colours.has(pixels32[i])) colours.set(pixels32[i], colours.size)
      }
      const usePalette = colours.size <= 256
      let colorType, bpp, data, paletteRgba = null
      if (usePalette) {
        colorType = 3; bpp = 1
        data = new Uint8Array(count)
        for (let i = 0; i < count; i += 1) data[i] = colours.get(pixels32[i])
        paletteRgba = new Uint8Array(colours.size * 4)
        for (const [value, index] of colours) { paletteRgba[index * 4] = value & 0xff; paletteRgba[index * 4 + 1] = (value >>> 8) & 0xff; paletteRgba[index * 4 + 2] = (value >>> 16) & 0xff; paletteRgba[index * 4 + 3] = (value >>> 24) & 0xff }
      } else if (gray && opaque) {
        colorType = 0; bpp = 1
        data = new Uint8Array(count)
        for (let i = 0; i < count; i += 1) data[i] = rgba[i * 4]
      } else if (gray) {
        colorType = 4; bpp = 2
        data = new Uint8Array(count * 2)
        for (let i = 0; i < count; i += 1) { data[i * 2] = rgba[i * 4]; data[i * 2 + 1] = rgba[i * 4 + 3] }
      } else if (opaque) {
        colorType = 2; bpp = 3
        data = new Uint8Array(count * 3)
        for (let i = 0, o = 0; i < count; i += 1, o += 3) { data[o] = rgba[i * 4]; data[o + 1] = rgba[i * 4 + 1]; data[o + 2] = rgba[i * 4 + 2] }
      } else {
        colorType = 6; bpp = 4; data = rgba
      }
      let out = packPng(data, colorType, bpp, width, height, paletteRgba, usePalette ? colours.size : 0)
      let kind = { 0: 'gray', 2: 'RGB', 3: `palette(${colours.size})`, 4: 'gray+alpha', 6: 'RGBA' }[colorType]
      let lossless = true
      // More than 256 colours: try a 256-colour palette too (TinyPNG-style), keep it only when
      // it is both smaller and visually indistinguishable.
      if (!usePalette) {
        try {
          const q = quantizeRgba(rgba, width, height, 256)
          if (q.psnr >= PNG_NEAR_LOSSLESS_MIN_PSNR) {
            const quantised = packPng(q.indices, 3, 1, width, height, q.palette, q.count)
            if (quantised.length < out.length) { out = quantised; kind = `palette(${q.count}), near-lossless ${q.psnr.toFixed(1)} dB`; lossless = false }
            else console.log(LOG, `PNG palette version not smaller (${(quantised.length / 1024).toFixed(0)} KB) — keeping lossless`)
          } else {
            console.log(LOG, `PNG palette version would be visible (${q.psnr.toFixed(1)} dB) — keeping lossless`)
          }
        } catch (error) {
          console.warn(LOG, 'PNG palette attempt failed — keeping lossless', error)
        }
      }
      if (out.length >= bytes.length) {
        console.log(LOG, `PNG kept as is: ${width}×${height} ${(bytes.length / 1024).toFixed(0)} KB (repack as ${kind} would be ${(out.length / 1024).toFixed(0)} KB)`)
        return bytes
      }
      console.log(LOG, `PNG optimised: ${width}×${height} ${(bytes.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB as ${kind}${lossless ? ', lossless' : ''}, ${Math.round(performance.now() - started)} ms`)
      return out
    }

    function renderAt(source, scale) {
      if (!scale || scale === 1) return source.pngBytes
      return (source.renders && source.renders[String(scale)]) || source.pngBytes
    }

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
      const pdfName = options.typedName || frameName || options.fileName
      const typedName = options.typedName || frameName || options.fileName || ''
      const useTypedName = typedName && message.rasterSources.length === 1
      const typedStem = typedName.replace(/\.(jpe?g|png|webp|svg|pdf|zip)$/i, '')
      const imageName = (source, extension) => useTypedName ? normalizedFilename(typedStem, extension, source.baseName) : `${source.baseName}.${extension}`
      for (const [sourceIndex, source] of message.rasterSources.entries()) {
        // PDF — Image always uses the 1x render (unchanged quality path); JPEG follows its own scale.
        if (options.pdfImage) pdfImages.push(await convertPng(source.pngBytes, 'image/jpeg', 0.93))
        if (options.jpeg) {
          const jpeg = (options.pdfImage && (!scales.jpeg || scales.jpeg === 1))
            ? pdfImages[pdfImages.length - 1]
            : await convertPng(renderAt(source, scales.jpeg), 'image/jpeg', 0.93)
          files.push({ name: imageName(source, 'jpg'), mime: 'image/jpeg', bytes: jpeg.bytes })
        }
        if (options.png) files.push({ name: imageName(source, 'png'), mime: 'image/png', bytes: optimizePng(asBytes(renderAt(source, scales.png))) })
        if (options.webp) {
          const webp = await convertPng(renderAt(source, scales.webp), 'image/webp', 0.88)
          files.push({ name: imageName(source, 'webp'), mime: 'image/webp', bytes: webp.bytes })
        }
        if (options.svg && source.svg) files.push({ name: imageName(source, 'svg'), mime: 'image/svg+xml', bytes: asBytes(source.svg) })
        if (options.pdfVector && source.pdf) { vectorPages.push(asBytes(source.pdf)); vectorIndexes.push(sourceIndex) }
      }
      const bothPdfs = options.pdfImage && options.pdfVector && vectorPages.length > 0
      if (options.pdfImage) {
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
        if (activeDestination !== 'drive') setButtonState('busy', options.compressPdf ? 'COMPRESSING' : (individual ? 'CREATING PDFS' : 'MERGING PDF'))
        if (activeDestination === 'drive') setDriveStatus('busy', options.compressPdf ? 'Compressing PDF...' : (individual ? 'Creating PDFs...' : 'Merging PDF...'))
        if (individual) {
          const order = Array.isArray(options.order) ? options.order : []
          const framesKnown = order.length === message.rasterSources.length // only trust the names when every page lines up with a frame
          const taken = new Set(files.map((file) => file.name.toLowerCase()))
          for (let i = 0; i < vectorPages.length; i += 1) {
            const sourceIndex = vectorIndexes[i]
            const source = message.rasterSources[sourceIndex]
            const stem = (framesKnown && frameNames[order[sourceIndex]]) || source.baseName || String(i + 1).padStart(2, '0')
            let name = normalizedFilename(stem, 'pdf', source.baseName || 'Export')
            // Same frame name twice: "Card", "Card 2", "Card 3"
            for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = normalizedFilename(`${stem} ${n}`, 'pdf', 'Export')
            taken.add(name.toLowerCase())
            files.push({ name, mime: 'application/pdf', bytes: await buildVectorPdf([vectorPages[i]], compress) })
          }
        } else {
          const merged = await buildVectorPdf(vectorPages, compress)
          const base = normalizedFilename(pdfName, 'pdf', 'Export').slice(0, -4)
          files.push({
            name: bothPdfs ? `${base} — Vector.pdf` : `${base}.pdf`,
            mime: 'application/pdf',
            bytes: merged,
          })
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      return files
    }

