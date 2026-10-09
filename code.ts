type ExportOptions = {
  jpeg: boolean
  pdfImage: boolean
  webp: boolean
  png?: boolean
  svg?: boolean
  pdfVector?: boolean
  compressPdf?: boolean
  compressLevel?: 'default' | 'smaller' // Compress strength (UI only; passed back with export-ready)
  scales?: { jpeg?: number; png?: number; webp?: number } // 0.5 … 4, default 1
  fileName: string
  typedName?: string
  order?: string[] // frame node ids in the order chosen in the UI (drag-reordered thumbnails)
}

// One image, as the UI hands it back for canvas placement: either raster bytes (any format Figma's
// own createImage() can decode) or SVG markup text (SVGs need figma.createNodeFromSvg() instead —
// createImage() only ever accepts raster bytes).
type PlaceableImage =
  | { name: string; bytes: Uint8Array; svg?: undefined }
  | { name: string; svg: string; bytes?: undefined }

type UiMessage =
  | { type: 'export'; options: ExportOptions }
  | { type: 'resize'; height: number }
  | { type: 'storage-get'; keys: string[] }
  | { type: 'storage-set'; values: { [key: string]: unknown } }
  | { type: 'open-url'; url: string }
  | { type: 'notify'; message: string; error?: boolean }
  | { type: 'place-images'; images: PlaceableImage[]; x: number | null; y: number | null }

type RasterSource = {
  baseName: string
  pngBytes: Uint8Array                       // 1x render — JPEG/WebP/PNG at 1x and PDF — Image (unchanged path)
  renders?: { [scale: string]: Uint8Array }  // extra PNG renders for scales other than 1x
  svg?: Uint8Array                           // native SVG export
  pdf?: Uint8Array                           // native vector PDF export (one page)
}

const PANEL_WIDTH = 386
const PANEL_HEIGHT = 566 // initial window height; the UI resizes it to fit its content right after opening
const MIN_PANEL_HEIGHT = 200 // smallest height the UI may shrink the window to

let selectionVersion = 0

// figma.currentPage.selection comes back in Figma's internal order (roughly layer stacking,
// and it varies with how the selection was made). Designers expect canvas reading order,
// so sort the frames by position: rows top to bottom, then left to right within a row.
function sortByReadingOrder(frames: FrameNode[]): FrameNode[] {
  type Placed = { frame: FrameNode; x: number; y: number; height: number }
  const placed: Placed[] = frames.map((frame) => {
    const box = frame.absoluteBoundingBox
    return box
      ? { frame, x: box.x, y: box.y, height: box.height }
      : { frame, x: frame.x, y: frame.y, height: frame.height }
  })
  placed.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const rows: { top: number; height: number; items: Placed[] }[] = []
  for (const item of placed) {
    const row = rows[rows.length - 1]
    // Same row when the tops are within half a frame height of each other.
    if (row && Math.abs(item.y - row.top) < Math.min(item.height, row.height) * 0.5) {
      row.items.push(item)
    } else {
      rows.push({ top: item.y, height: item.height, items: [item] })
    }
  }
  const ordered: FrameNode[] = []
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x)
    for (const item of row.items) ordered.push(item.frame)
  }
  return ordered
}

function selectedFrames(): FrameNode[] {
  const frames = figma.currentPage.selection.filter((node): node is FrameNode => node.type === 'FRAME')
  return sortByReadingOrder(frames)
}

// Applies the order the user arranged in the UI (thumbnail drag), keeping any frames the UI
// doesn't know about at the end in reading order.
function applyCustomOrder(frames: FrameNode[], order?: string[]): FrameNode[] {
  if (!order || order.length === 0) return frames
  const byId = new Map(frames.map((frame) => [frame.id, frame] as const))
  const ordered: FrameNode[] = []
  for (const id of order) {
    const frame = byId.get(id)
    if (frame) { ordered.push(frame); byId.delete(id) }
  }
  for (const frame of frames) if (byId.has(frame.id)) ordered.push(frame)
  return ordered
}

function clampScale(scale: number): number {
  return Math.min(4, Math.max(0.5, Number(scale) || 1))
}

function numberedName(index: number, total: number): string {
  const width = Math.max(2, String(total).length)
  return String(index + 1).padStart(width, '0')
}

async function sendSelection(): Promise<void> {
  const version = ++selectionVersion
  const frames = selectedFrames()
  const ids = frames.map((frame) => frame.id)
  const names = frames.map((frame) => frame.name)
  if (frames.length === 0) {
    figma.ui.postMessage({ type: 'selection', count: 0, thumbnails: [], ids, names, version })
    return
  }
  // Tell the UI which frames are selected right away (count, names, Export button), then send
  // each thumbnail the moment it is ready instead of waiting for the slowest frame. The
  // thumbnails themselves are rendered exactly as before: same size, all started at once.
  figma.ui.postMessage({ type: 'selection', count: frames.length, thumbnails: [], ids, names, pending: true, version })
  let failed = 0
  await Promise.all(frames.map(async (frame) => {
    try {
      const bytes = await frame.exportAsync({
        format: 'PNG',
        constraint: { type: 'WIDTH', value: 224 }, // crisp on Retina at the thumbnail size
      })
      if (version !== selectionVersion) return
      figma.ui.postMessage({ type: 'thumbnail', version, id: frame.id, bytes })
    } catch {
      failed += 1
      if (version !== selectionVersion) return
      figma.ui.postMessage({ type: 'thumbnail', version, id: frame.id, bytes: null })
    }
  }))
  if (version !== selectionVersion) return
  // Nothing could be rendered at all: behave as before ("Preview unavailable").
  if (failed === frames.length) {
    figma.ui.postMessage({ type: 'selection', count: frames.length, thumbnails: [], ids, names, version })
  }
}

async function runExport(options: ExportOptions): Promise<void> {
  const frames = applyCustomOrder(selectedFrames(), options.order)
  if (frames.length === 0) {
    figma.ui.postMessage({ type: 'error', message: 'Select frames to export.' })
    return
  }

  // Which PNG render scales are needed besides 1x (JPEG / PNG / WebP each have their own).
  const scales = options.scales || {}
  const extraScales = new Set<number>()
  const wanted: Array<[boolean | undefined, number | undefined]> = [
    [options.jpeg, scales.jpeg], [options.png, scales.png], [options.webp, scales.webp],
  ]
  for (const [enabled, scale] of wanted) {
    if (enabled && scale && scale !== 1) extraScales.add(clampScale(scale))
  }

  const rasterSources: RasterSource[] = []
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    figma.ui.postMessage({ type: 'progress', current: index + 1, total: frames.length })
    const source: RasterSource = {
      baseName: numberedName(index, frames.length),
      pngBytes: await frame.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 1 },
      }),
    }
    if (extraScales.size > 0) {
      source.renders = {}
      for (const scale of extraScales) {
        source.renders[String(scale)] = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } })
      }
    }
    if (options.svg) {
      source.svg = await frame.exportAsync({ format: 'SVG', svgOutlineText: true, svgIdAttribute: false, svgSimplifyStroke: true })
    }
    if (options.pdfVector) {
      source.pdf = await frame.exportAsync({ format: 'PDF', colorProfile: 'SRGB' })
    }
    rasterSources.push(source)
  }

  figma.ui.postMessage({
    type: 'export-ready',
    rasterSources,
    options,
    frameCount: frames.length,
  })
}

// Google Drive settings and OAuth tokens live in figma.clientStorage (local to this
// Figma client, never in the plugin source). The UI iframe cannot access it directly,
// so it asks through these messages.
async function readStorage(keys: string[]): Promise<void> {
  const values: { [key: string]: unknown } = {}
  for (const key of keys) values[key] = await figma.clientStorage.getAsync(key)
  figma.ui.postMessage({ type: 'storage', values })
}

async function writeStorage(values: { [key: string]: unknown }): Promise<void> {
  for (const key of Object.keys(values)) {
    const value = values[key]
    if (value === null || value === undefined) await figma.clientStorage.deleteAsync(key)
    else await figma.clientStorage.setAsync(key, value)
  }
  figma.ui.postMessage({ type: 'storage-saved', keys: Object.keys(values) })
}

// ---- Drive -> canvas: dragging a file onto the canvas, or "Place on canvas" in the ⋮ menu ---------------
// The UI starts a drag (or sends place-images directly) carrying the file's bytes; both paths end up here.
// figma.on('drop') fires for an in-canvas drag; the UI's own drag payload is tagged "smDriveImages" so a
// drop of something else (a layer, a normal image) is left for Figma to handle as usual.
figma.on('drop', (event: DropEvent) => {
  // Matching on the marker string alone (not a strict type === 'text/plain') in case the host ever
  // reports the dataTransfer item's type with different casing or an added charset suffix — the goal
  // here is just "is this one of ours", not an exact MIME match.
  const item = (event.items || []).find((i) => typeof i.data === 'string' && i.data.indexOf('"smDriveImages"') !== -1)
  console.log('[SM exporter] canvas drop', { itemTypes: (event.items || []).map((i) => i.type), matched: Boolean(item) })
  if (!item) return true // not ours: let Figma handle it
  figma.ui.postMessage({ type: 'drive-drop', data: item.data, x: event.absoluteX, y: event.absoluteY })
  return false
})

async function placeImages(msg: { images: PlaceableImage[]; x: number | null; y: number | null }): Promise<void> {
  let x = msg.x == null ? figma.viewport.center.x : msg.x
  const y = msg.y == null ? figma.viewport.center.y : msg.y
  const nodes: SceneNode[] = []
  for (const img of msg.images) {
    try {
      let node: SceneNode
      if (img.svg) {
        // createImage() only accepts raster bytes (PNG/JPEG/GIF) — an SVG has to come in as markup
        // text through createNodeFromSvg() instead, which builds real vector layers from it.
        const svgNode = figma.createNodeFromSvg(img.svg)
        svgNode.name = img.name
        svgNode.x = x
        svgNode.y = y
        node = svgNode
      } else {
        const image = figma.createImage(img.bytes as Uint8Array)
        const size = await image.getSizeAsync()
        const rect = figma.createRectangle()
        rect.name = img.name
        rect.resize(size.width, size.height)
        rect.x = x
        rect.y = y
        rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }]
        node = rect
      }
      figma.currentPage.appendChild(node)
      nodes.push(node)
      x += node.width + 40
    } catch (e) {
      figma.notify(`Couldn’t place ${img.name}: Figma can’t read that image type.`)
    }
  }
  if (nodes.length) {
    figma.currentPage.selection = nodes
    figma.viewport.scrollAndZoomIntoView(nodes)
  }
}

figma.showUI(__html__, { width: PANEL_WIDTH, height: PANEL_HEIGHT })
void sendSelection()
figma.on('selectionchange', () => { void sendSelection() })

figma.ui.onmessage = (message: UiMessage) => {
  if (message.type === 'export') {
    void runExport(message.options).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      figma.ui.postMessage({ type: 'error', message: text })
    })
    return
  }
  if (message.type === 'resize') {
    const height = Math.max(MIN_PANEL_HEIGHT, Math.min(1000, Math.round(message.height)))
    figma.ui.resize(PANEL_WIDTH, height)
    return
  }
  if (message.type === 'storage-get') {
    void readStorage(message.keys).catch((error: unknown) => console.error('[SM exporter] clientStorage read failed', error))
    return
  }
  if (message.type === 'storage-set') {
    void writeStorage(message.values).catch((error: unknown) => console.error('[SM exporter] clientStorage write failed', error))
    return
  }
  if (message.type === 'open-url') {
    if (/^https:\/\//i.test(message.url)) figma.openExternal(message.url)
    return
  }
  if (message.type === 'notify') {
    figma.notify(message.message, { error: message.error === true, timeout: 4000 })
    return
  }
  if (message.type === 'place-images') {
    void placeImages(message).catch((error: unknown) => console.error('[SM exporter] place-images failed', error))
  }
}
