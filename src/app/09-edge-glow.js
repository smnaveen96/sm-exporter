    // ---- The working glow: a light travelling round a field's edge ------------------------------------------
    // While the Drive search runs (.is-working on the search box) or an upload is busy (.is-busy on the Drive
    // link box), a soft light circles the field's border. It moves at one even speed along the actual
    // rounded outline: the outline is measured, walked (straights and corner arcs), and every point is
    // placed at its share of the total length, so the light doesn't hurry round the ends and dawdle along
    // the sides the way a spin around the centre does. The styles draw the light at --gx / --gy.
    const EDGE_GLOW_SPEED = 230 // px per second along the edge
    const edgeGlows = new Map() // element → its running animation

    function edgeOutline(width, height, radius) {
      const r = Math.max(0, Math.min(radius, width / 2, height / 2))
      const points = []
      const arc = (cx, cy, from) => {
        for (let i = 1; i <= 8; i++) {
          const angle = from + (Math.PI / 2) * (i / 8)
          points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
        }
      }
      // Clockwise from the start of the top edge.
      points.push([r, 0], [width - r, 0])
      arc(width - r, r, -Math.PI / 2)
      points.push([width, height - r])
      arc(width - r, height - r, 0)
      points.push([r, height])
      arc(r, height - r, Math.PI / 2)
      points.push([0, r])
      arc(r, r, Math.PI)
      return points
    }

    function startEdgeGlow(el) {
      if (edgeGlows.has(el)) return
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
      const points = edgeOutline(box.width, box.height, radius)
      let total = 0
      const lengths = [0]
      for (let i = 1; i < points.length; i++) {
        total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
        lengths.push(total)
      }
      const frames = points.map(([x, y], i) => ({ offset: lengths[i] / total, '--gx': `${x.toFixed(2)}px`, '--gy': `${y.toFixed(2)}px` }))
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // No travelling light: it rests at the middle of the bottom edge.
        el.style.setProperty('--gx', `${box.width / 2}px`)
        el.style.setProperty('--gy', `${box.height}px`)
        edgeGlows.set(el, null)
        return
      }
      const duration = Math.max(1600, Math.min(3600, (total / EDGE_GLOW_SPEED) * 1000))
      edgeGlows.set(el, el.animate(frames, { duration, iterations: Infinity, easing: 'linear' }))
    }
    function stopEdgeGlow(el) {
      if (!edgeGlows.has(el)) return
      const animation = edgeGlows.get(el)
      if (animation) animation.cancel()
      el.style.removeProperty('--gx')
      el.style.removeProperty('--gy')
      edgeGlows.delete(el)
    }

    for (const [el, workingClass] of [[pickerSearch, 'is-working'], [uploadPill, 'is-busy']]) {
      const sync = () => { if (el.classList.contains(workingClass)) startEdgeGlow(el); else stopEdgeGlow(el) }
      new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] })
      sync()
    }
