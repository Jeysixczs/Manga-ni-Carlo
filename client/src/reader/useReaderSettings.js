import { useCallback, useState } from 'react';

const KEY = 'kitsune.reader.v1';

export const DEFAULTS = {
    mode: 'webtoon',     // 'webtoon' (continuous vertical scroll) | 'paged'
    direction: 'ltr',    // paged mode only: 'ltr' | 'rtl'
    width: 'wide',       // narrow | medium | wide | full
    gap: 0,              // px between pages in webtoon mode
    bg: 'default',       // default | black | dim | sepia | white
    brightness: 100,     // 50-100
    dataSaver: false,
    speed: 4,            // auto-scroll level 1-10
    autoHide: true,      // hide the toolbar while scrolling down
};

export const WIDTHS = { narrow: '560px', medium: '720px', wide: '840px', full: '100%' };
export const SPEEDS = [0, 40, 80, 130, 190, 260, 340, 440, 560, 700, 880]; // px per second

const ALLOWED = {
    mode: ['webtoon', 'paged'],
    direction: ['ltr', 'rtl'],
    width: Object.keys(WIDTHS),
    gap: [0, 6, 16],
    bg: ['default', 'black', 'dim', 'sepia', 'white'],
};

function sanitize(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    for (const k of Object.keys(ALLOWED)) if (ALLOWED[k].includes(raw[k])) out[k] = raw[k];
    if (Number.isFinite(raw.brightness)) out.brightness = Math.min(100, Math.max(50, raw.brightness));
    if (Number.isInteger(raw.speed)) out.speed = Math.min(10, Math.max(1, raw.speed));
    if (typeof raw.dataSaver === 'boolean') out.dataSaver = raw.dataSaver;
    if (typeof raw.autoHide === 'boolean') out.autoHide = raw.autoHide;
    return out;
}

function load() {
    try { return sanitize(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULTS }; }
}

export function useReaderSettings() {
    const [settings, setSettings] = useState(load);
    const update = useCallback((patch) => {
        setSettings((cur) => {
            const next = sanitize({ ...cur, ...patch });
            try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
            return next;
        });
    }, []);
    const reset = useCallback(() => update({ ...DEFAULTS }), [update]);
    return [settings, update, reset];
}
