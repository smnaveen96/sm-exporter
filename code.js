"use strict";
const PANEL_WIDTH = 386;
const PANEL_HEIGHT = 566; // initial window height; the UI resizes it to fit its content right after opening
const MIN_PANEL_HEIGHT = 200; // smallest height the UI may shrink the window to
let selectionVersion = 0;
// figma.currentPage.selection comes back in Figma's internal order (roughly layer stacking,
// and it varies with how the selection was made). Designers expect canvas reading order,
// so sort the frames by position: rows top to bottom, then left to right within a row.
function sortByReadingOrder(frames) {
    const placed = frames.map((frame) => {
        const box = frame.absoluteBoundingBox;
        return box
            ? { frame, x: box.x, y: box.y, height: box.height }
            : { frame, x: frame.x, y: frame.y, height: frame.height };
    });
    placed.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const rows = [];
    for (const item of placed) {
        const row = rows[rows.length - 1];
        // Same row when the tops are within half a frame height of each other.
        if (row && Math.abs(item.y - row.top) < Math.min(item.height, row.height) * 0.5) {
            row.items.push(item);
        }
        else {
            rows.push({ top: item.y, height: item.height, items: [item] });
        }
    }
    const ordered = [];
    for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        for (const item of row.items)
            ordered.push(item.frame);
    }
    return ordered;
}
function selectedFrames() {
    const frames = figma.currentPage.selection.filter((node) => node.type === 'FRAME');
    return sortByReadingOrder(frames);
}
// Applies the order the user arranged in the UI (thumbnail drag), keeping any frames the UI
// doesn't know about at the end in reading order.
function applyCustomOrder(frames, order) {
    if (!order || order.length === 0)
        return frames;
    const byId = new Map(frames.map((frame) => [frame.id, frame]));
    const ordered = [];
    for (const id of order) {
        const frame = byId.get(id);
        if (frame) {
            ordered.push(frame);
            byId.delete(id);
        }
    }
    for (const frame of frames)
        if (byId.has(frame.id))
            ordered.push(frame);
    return ordered;
}
function clampScale(scale) {
    return Math.min(4, Math.max(0.5, Number(scale) || 1));
}
function numberedName(index, total) {
    const width = Math.max(2, String(total).length);
    return String(index + 1).padStart(width, '0');
}
async function sendSelection() {
    const version = ++selectionVersion;
    const frames = selectedFrames();
    try {
        const thumbnails = await Promise.all(frames.map((frame) => frame.exportAsync({
            format: 'PNG',
            constraint: { type: 'WIDTH', value: 224 }, // crisp on Retina at the 112px thumbnail size
        })));
        if (version !== selectionVersion)
            return;
        figma.ui.postMessage({ type: 'selection', count: frames.length, thumbnails, ids: frames.map((frame) => frame.id), names: frames.map((frame) => frame.name) });
    }
    catch {
        if (version !== selectionVersion)
            return;
        figma.ui.postMessage({ type: 'selection', count: frames.length, thumbnails: [], ids: frames.map((frame) => frame.id), names: frames.map((frame) => frame.name) });
    }
}
async function runExport(options) {
    const frames = applyCustomOrder(selectedFrames(), options.order);
    if (frames.length === 0) {
        figma.ui.postMessage({ type: 'error', message: 'Select frames to export.' });
        return;
    }
    // Which PNG render scales are needed besides 1x (JPEG / PNG / WebP each have their own).
    const scales = options.scales || {};
    const extraScales = new Set();
    const wanted = [
        [options.jpeg, scales.jpeg], [options.png, scales.png], [options.webp, scales.webp],
    ];
    for (const [enabled, scale] of wanted) {
        if (enabled && scale && scale !== 1)
            extraScales.add(clampScale(scale));
    }
    const rasterSources = [];
    for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        figma.ui.postMessage({ type: 'progress', current: index + 1, total: frames.length });
        const source = {
            baseName: numberedName(index, frames.length),
            pngBytes: await frame.exportAsync({
                format: 'PNG',
                constraint: { type: 'SCALE', value: 1 },
            }),
        };
        if (extraScales.size > 0) {
            source.renders = {};
            for (const scale of extraScales) {
                source.renders[String(scale)] = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
            }
        }
        if (options.svg) {
            source.svg = await frame.exportAsync({ format: 'SVG', svgOutlineText: true, svgIdAttribute: false, svgSimplifyStroke: true });
        }
        if (options.pdfVector) {
            source.pdf = await frame.exportAsync({ format: 'PDF', colorProfile: 'SRGB' });
        }
        rasterSources.push(source);
    }
    figma.ui.postMessage({
        type: 'export-ready',
        rasterSources,
        options,
        frameCount: frames.length,
    });
}
// Google Drive settings and OAuth tokens live in figma.clientStorage (local to this
// Figma client, never in the plugin source). The UI iframe cannot access it directly,
// so it asks through these messages.
async function readStorage(keys) {
    const values = {};
    for (const key of keys)
        values[key] = await figma.clientStorage.getAsync(key);
    figma.ui.postMessage({ type: 'storage', values });
}
async function writeStorage(values) {
    for (const key of Object.keys(values)) {
        const value = values[key];
        if (value === null || value === undefined)
            await figma.clientStorage.deleteAsync(key);
        else
            await figma.clientStorage.setAsync(key, value);
    }
    figma.ui.postMessage({ type: 'storage-saved', keys: Object.keys(values) });
}
figma.showUI(__html__, { width: PANEL_WIDTH, height: PANEL_HEIGHT });
void sendSelection();
figma.on('selectionchange', () => { void sendSelection(); });
figma.ui.onmessage = (message) => {
    if (message.type === 'export') {
        void runExport(message.options).catch((error) => {
            const text = error instanceof Error ? error.message : String(error);
            figma.ui.postMessage({ type: 'error', message: text });
        });
        return;
    }
    if (message.type === 'resize') {
        const height = Math.max(MIN_PANEL_HEIGHT, Math.min(1000, Math.round(message.height)));
        figma.ui.resize(PANEL_WIDTH, height);
        return;
    }
    if (message.type === 'storage-get') {
        void readStorage(message.keys).catch((error) => console.error('[SM exporter] clientStorage read failed', error));
        return;
    }
    if (message.type === 'storage-set') {
        void writeStorage(message.values).catch((error) => console.error('[SM exporter] clientStorage write failed', error));
        return;
    }
    if (message.type === 'open-url') {
        if (/^https:\/\//i.test(message.url))
            figma.openExternal(message.url);
        return;
    }
    if (message.type === 'notify') {
        figma.notify(message.message, { error: message.error === true, timeout: 4000 });
    }
};
