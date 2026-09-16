// Fallback covers are identical for every card, so build each distinct one
// once instead of re-encoding base64 on every render of every card.
const fallbackCache = new Map();

export function createFallbackSVG(text, w = 300, h = 400) {
    const key = `${text}|${w}|${h}`;
    const cached = fallbackCache.get(key);
    if (cached) return cached;
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#333"/><text x="50%" y="50%" font-family="Arial, sans-serif" font-size="16" fill="#ccc" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
    // encodeURIComponent -> unescape was the old deprecated UTF-8 dance;
    // TextEncoder does the same job and is not deprecated.
    const bytes = new TextEncoder().encode(svg);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const uri = `data:image/svg+xml;base64,${btoa(binary)}`;
    // Bounded: the app only ever produces a handful of distinct fallbacks.
    if (fallbackCache.size < 64) fallbackCache.set(key, uri);
    return uri;
}

export function useLocalStorage(key, initialValue) {
    // Minimal helper kept out of React to avoid a hook-rules footgun; components import useState directly.
    try {
        const stored = localStorage.getItem(key);
        return stored !== null ? stored : initialValue;
    } catch {
        return initialValue;
    }
}

// ---- Bounded reader-progress storage ----
// The old version wrote one localStorage key per chapter, forever. A heavy
// reader accumulates thousands of `readerPage_*` keys that are never cleaned
// up, and localStorage has a hard ~5MB quota per origin — once it fills, every
// write throws. This keeps a single LRU-trimmed map instead.
const PROGRESS_KEY = 'readerProgress';
const MAX_TRACKED_CHAPTERS = 300;

function readProgress() {
    try {
        const raw = localStorage.getItem(PROGRESS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function getLastReadPage(chapterId) {
    if (!chapterId) return 0;
    const value = readProgress()[chapterId];
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function saveLastReadPage(chapterId, pageIdx) {
    if (!chapterId) return;
    try {
        const progress = readProgress();
        // Delete-then-set moves this chapter to the end of insertion order,
        // so the oldest keys are the ones trimmed below.
        delete progress[chapterId];
        progress[chapterId] = pageIdx;
        const keys = Object.keys(progress);
        if (keys.length > MAX_TRACKED_CHAPTERS) {
            for (const stale of keys.slice(0, keys.length - MAX_TRACKED_CHAPTERS)) delete progress[stale];
        }
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
        // Quota exceeded or storage disabled — progress tracking is optional.
    }
}

/** One-time migration of the old per-chapter keys into the single map. */
export function migrateLegacyReaderProgress() {
    try {
        const legacy = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('readerPage_')) legacy.push(key);
        }
        if (!legacy.length) return;
        const progress = readProgress();
        for (const key of legacy) {
            const id = key.slice('readerPage_'.length);
            const value = parseInt(localStorage.getItem(key), 10);
            if (!(id in progress) && Number.isInteger(value)) progress[id] = value;
            localStorage.removeItem(key);
        }
        const keys = Object.keys(progress);
        const trimmed = keys.length > MAX_TRACKED_CHAPTERS
            ? Object.fromEntries(keys.slice(-MAX_TRACKED_CHAPTERS).map((k) => [k, progress[k]]))
            : progress;
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(trimmed));
    } catch {
        // Nothing to do — worst case the old keys stay put.
    }
}
