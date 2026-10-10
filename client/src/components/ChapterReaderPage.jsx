import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mangaUrl, readUrl, getQueryParam } from '../routes.js';
import { CHAPTER_LIMIT, fetchChapters, fetchChapterPages, getPageImageUrl, getChapterGroupName, isAbortError } from '../api.js';
import { createFallbackSVG, getLastReadPage, saveLastReadPage } from '../utils.js';
import { ReaderPageSkeleton } from './Skeleton.jsx';
import ReaderSettings from '../reader/ReaderSettings.jsx';
import { useReaderSettings, WIDTHS, SPEEDS } from '../reader/useReaderSettings.js';
import { IconGear, IconExpand, IconCompress, IconPlay, IconPause, IconUp, IconKeys, IconClose } from '../reader/Icons.jsx';

// How many pages to load eagerly before handing off to native lazy loading.
const EAGER_PAGES = 3;

/**
 * One page image plus its own skeleton placeholder.
 *
 * The skeleton isn't only cosmetic here. An <img> with no width/height and no
 * loaded bytes lays out at zero height, so before this existed every
 * .page-container in the chapter stacked up at ~0px: the document had almost
 * no scrollable height, which (a) made `loading="lazy"` consider every page to
 * be in the viewport and fire all of them at once, (b) gave the
 * IntersectionObserver a pile of overlapping zero-height targets to pick a
 * "current page" from, and (c) made the restore-last-read-position
 * scrollIntoView land in the wrong place. Reserving a 2:3 box per page until
 * its image reports back fixes all three as a side effect.
 */
function ChapterPage({ index, src, innerRef, onFailure }) {
    const [loaded, setLoaded] = useState(false);
    const triedFallback = useRef(false);

    // A cached image can finish loading before React attaches this handler, in
    // which case onLoad never fires and the skeleton would sit there forever.
    // img.complete is the only reliable way to catch that race.
    const imgRef = useCallback((el) => {
        if (el?.complete && el.naturalWidth > 0) setLoaded(true);
    }, []);

    // When the reader gets a fresh MangaDex@Home server, src changes underneath
    // a component that isn't remounting (the key is the page filename, which is
    // stable across servers). Re-arm so the new URL gets a real attempt and its
    // own skeleton instead of being treated as already-failed.
    useEffect(() => {
        triedFallback.current = false;
        setLoaded(false);
    }, [src]);

    // Each chapter remounts these (the key is the page filename), so state
    // resets on its own — no effect needed to clear `loaded`.
    return (
        <div className="page-container" data-page-index={index} ref={innerRef}>
            <div className={`page-frame${loaded ? '' : ' is-loading'}`}>
                {!loaded && (
                    <div className="page-skeleton skeleton" aria-hidden="true">
                        <span className="page-skeleton-label">{index + 1}</span>
                    </div>
                )}
                <img
                    ref={imgRef}
                    className="page-image"
                    alt={`Page ${index + 1}`}
                    loading={index < EAGER_PAGES ? 'eager' : 'lazy'}
                    // Decoding off the main thread keeps scrolling smooth
                    // while large page images are being rasterised.
                    decoding="async"
                    // Lowercase: React 18 does not map the camelCase
                    // `fetchPriority` prop, so it must be passed as a
                    // plain DOM attribute.
                    fetchpriority={index < EAGER_PAGES ? 'high' : 'low'}
                    src={src}
                    onLoad={() => setLoaded(true)}
                    onError={(e) => {
                        // Swapping src starts another load, so without this guard
                        // a fallback that somehow failed would loop forever.
                        if (triedFallback.current) { setLoaded(true); return; }
                        triedFallback.current = true;
                        // Ask for a different @Home node first; if that works
                        // the new src arrives and re-arms this component.
                        onFailure?.();
                        e.currentTarget.src = createFallbackSVG(`Failed to load page ${index + 1}`, 600, 800);
                    }}
                />
            </div>
        </div>
    );
}

const SHORTCUTS = [
    ['S', 'Open settings'],
    ['P', 'Start / pause auto-scroll'],
    ['+  /  −', 'Auto-scroll faster / slower'],
    ['J  /  K', 'Scroll down / up'],
    ['← →', 'Previous / next page (paged mode)'],
    ['Shift + ← →', 'Previous / next chapter'],
    ['[  /  ]', 'Previous / next chapter'],
    ['T', 'Back to top'],
    ['F', 'Fullscreen'],
    ['?', 'Show this list'],
    ['Esc', 'Close panels, stop auto-scroll'],
];

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const chapterLabel = (c) => {
    const a = c?.attributes || {};
    return a.chapter ? `Ch. ${a.chapter}${a.title ? ` · ${a.title}` : ''}` : (a.title || 'Oneshot');
};

export default function ChapterReaderPage() {
    // The reader is its own HTML page: ?manga=<id>&chapter=<id>. Switching
    // chapters pushes a history entry and swaps state instead of reloading, so
    // the (already fetched) chapter list stays warm.
    const mangaId = getQueryParam('manga');
    const [chapterId, setChapterId] = useState(() => getQueryParam('chapter'));

    useEffect(() => {
        const onPop = () => setChapterId(getQueryParam('chapter'));
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    // Let the reader use the full width of the screen.
    useEffect(() => {
        document.body.classList.add('is-reader');
        return () => document.body.classList.remove('is-reader');
    }, []);

    const MAX_CHAPTER_PAGES = 10;
    const chapterIdRef = useRef(chapterId);
    chapterIdRef.current = chapterId;
    const [allChapters, setAllChapters] = useState([]);
    const [chapterData, setChapterData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const [settings, updateSettings, resetSettings] = useReaderSettings();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [keysOpen, setKeysOpen] = useState(false);
    const [jumpOpen, setJumpOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(0);
    const [autoScroll, setAutoScroll] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [toast, setToast] = useState('');
    const [atEnd, setAtEnd] = useState(false);
    const pageRefs = useRef([]);
    const contentRef = useRef(null);
    const endRef = useRef(null);
    const progressRef = useRef(null);
    const restoredRef = useRef(false);
    const toastTimer = useRef(0);
    const preloaded = useRef('');
    // Which chapter `chapterData` belongs to; stops restore/save logic from
    // acting on the previous chapter's data during a chapter switch.
    const dataForRef = useRef('');

    const paged = settings.mode === 'paged';
    const rtl = settings.direction === 'rtl';

    const showToast = useCallback((msg) => {
        setToast(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), 2200);
    }, []);
    useEffect(() => () => clearTimeout(toastTimer.current), []);

    // Load the manga's chapter list once (or when manga changes).
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                // The list is paginated (100 per page, max offset+limit 10.000).
                // Series with more chapters than that used to lose Prev/Next
                // whenever the open chapter sat past page one, so keep paging
                // until it is found. Bounded so a bad id can't become a loop.
                let { chapters, total } = await fetchChapters(mangaId, 0, CHAPTER_LIMIT, '', controller.signal);
                for (let pages = 1; pages < MAX_CHAPTER_PAGES && chapters.length < total && !chapters.some((c) => c.id === chapterIdRef.current); pages++) {
                    const next = await fetchChapters(mangaId, chapters.length, CHAPTER_LIMIT, '', controller.signal);
                    if (!next.chapters.length) break;
                    chapters = chapters.concat(next.chapters);
                }
                setAllChapters(chapters);
            } catch (err) {
                if (!isAbortError(err)) setAllChapters([]);
            }
        })();
        return () => controller.abort();
    }, [mangaId]);

    // MangaDex guarantees a base URL for only 15 minutes, and explicitly says
    // to call /at-home/server/:id again when an image fails so a bad volunteer
    // node can be swapped out. Both cases surface here as an image that won't
    // load, so one handler covers them: fetch a fresh server, let the new URLs
    // flow down, and cap the attempts so a genuinely dead chapter can't turn
    // into a request loop against an endpoint budgeted at 40/min.
    const serverRefreshes = useRef(0);
    const refreshing = useRef(false);
    const MAX_SERVER_REFRESHES = 3;

    const handlePageFailure = useCallback(async () => {
        if (refreshing.current || serverRefreshes.current >= MAX_SERVER_REFRESHES) return;
        refreshing.current = true;
        serverRefreshes.current += 1;
        try {
            const fresh = await fetchChapterPages(chapterId);
            setChapterData(fresh);
        } catch {
            // Leave the existing (broken) URLs in place; the per-page fallback
            // image already tells the reader that page didn't load.
        } finally {
            refreshing.current = false;
        }
    }, [chapterId]);

    // Load the current chapter's pages whenever chapterId changes.
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setAutoScroll(false);
        setCurrentPage(0);
        restoredRef.current = false;
        dataForRef.current = '';
        serverRefreshes.current = 0;
        // Drop references to the previous chapter's DOM nodes. Truncating the
        // array (rather than leaving it long) means a 200-page chapter can't
        // keep 200 detached <div> elements reachable after a 5-page one loads.
        pageRefs.current.length = 0;
        (async () => {
            try {
                const data = await fetchChapterPages(chapterId, controller.signal);
                dataForRef.current = chapterId;
                setChapterData(data);
            } catch (err) {
                if (!isAbortError(err)) setError(err.message || 'Failed to load chapter');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        window.scrollTo({ top: 0 });
        return () => controller.abort();
    }, [chapterId]);

    // Image quality: the user's data-saver choice, or the server's fallback.
    const files = useMemo(() => {
        if (!chapterData) return { list: [], saver: false };
        const saverList = chapterData.chapter.dataSaver;
        const wantSaver = settings.dataSaver && saverList?.length;
        return wantSaver
            ? { list: saverList, saver: true }
            : { list: chapterData.pages, saver: chapterData.usingDataSaver };
    }, [chapterData, settings.dataSaver]);
    const total = files.list.length;

    // Page URLs are pure derivations of chapterData; recomputing them (and
    // building a fresh encodeURIComponent string per page) on every header
    // show/hide re-render was wasted work on long chapters.
    const pageUrls = useMemo(() => {
        if (!chapterData) return [];
        return files.list.map((pg) => getPageImageUrl(chapterData.baseUrl, chapterData.chapter.hash, pg, files.saver));
    }, [chapterData, files]);

    // Restore the last-read page once the pages are mounted.
    useEffect(() => {
        if (!chapterData || loading || dataForRef.current !== chapterId) return undefined;
        const lastIdx = Math.min(getLastReadPage(chapterId), Math.max(total - 1, 0));
        if (lastIdx > 0) showToast(`Resumed at page ${lastIdx + 1}`);
        if (paged) {
            setCurrentPage(lastIdx);
            restoredRef.current = true;
            return undefined;
        }
        const t = setTimeout(() => {
            // Page 1 needs no jump (and would hide behind the sticky toolbar).
            if (lastIdx > 0) pageRefs.current[lastIdx]?.scrollIntoView({ behavior: 'instant', block: 'start' });
            setCurrentPage(lastIdx);
            // Give the jump (and the scroll events it triggers) time to settle
            // before progress tracking is allowed to overwrite the saved page.
            setTimeout(() => { restoredRef.current = true; }, 250);
        }, 30);
        return () => clearTimeout(t);
        // Mode changes are handled separately below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chapterData, loading, chapterId]);

    // Persist progress (cheap: one small localStorage write per page change).
    useEffect(() => {
        if (!restoredRef.current || loading || !total || dataForRef.current !== chapterId) return;
        saveLastReadPage(chapterId, currentPage);
    }, [currentPage, chapterId, loading, total]);

    // Switching mode keeps the reader on the same page.
    const prevMode = useRef(settings.mode);
    useEffect(() => {
        if (prevMode.current === settings.mode) return;
        prevMode.current = settings.mode;
        setAutoScroll(false);
        if (settings.mode === 'webtoon') {
            requestAnimationFrame(() => pageRefs.current[currentPage]?.scrollIntoView({ behavior: 'instant', block: 'start' }));
        } else {
            window.scrollTo({ top: 0 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.mode]);

    // Webtoon mode: work out the current page + chapter progress from scroll
    // position. (An IntersectionObserver can't do this for tall webtoon strips:
    // a page taller than the screen never reaches a high visibility ratio.)
    useEffect(() => {
        if (paged || !chapterData || loading) return undefined;
        let raf = 0;
        const compute = () => {
            raf = 0;
            const els = pageRefs.current;
            const line = window.innerHeight * 0.4;
            let lo = 0, hi = els.length - 1, ans = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const el = els[mid];
                if (el && el.getBoundingClientRect().top <= line) { ans = mid; lo = mid + 1; } else hi = mid - 1;
            }
            setCurrentPage((p) => (p === ans ? p : ans));
            const endEl = endRef.current;
            setAtEnd(Boolean(endEl) && endEl.getBoundingClientRect().top < window.innerHeight * 0.6);
            const box = contentRef.current;
            if (box && progressRef.current) {
                const r = box.getBoundingClientRect();
                const span = r.height - window.innerHeight;
                const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
                progressRef.current.style.transform = `scaleX(${p})`;
            }
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        compute();
        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [paged, chapterData, loading, files]);

    // Paged mode: progress is simply page / total.
    useEffect(() => {
        if (!paged || !progressRef.current) return;
        progressRef.current.style.transform = `scaleX(${total > 1 ? currentPage / (total - 1) : 1})`;
    }, [paged, currentPage, total]);

    // Smart toolbar: hides while scrolling down, returns on a short scroll up
    // or when the pointer visits the top edge.
    useEffect(() => {
        if (!settings.autoHide || paged) return undefined;
        let lastY = window.scrollY, upStart = lastY, goingUp = false, ticking = false;
        const evaluate = () => {
            ticking = false;
            const y = window.scrollY;
            if (y > lastY + 6 && y > 120) { goingUp = false; setHeaderHidden(true); }
            else if (y < lastY - 2) {
                if (!goingUp) { goingUp = true; upStart = lastY; }
                if (upStart - y > 70 || y < 80) setHeaderHidden(false);
            }
            lastY = y;
        };
        const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(evaluate); } };
        const onMouseMove = (e) => { if (e.clientY < 70) setHeaderHidden((h) => (h ? false : h)); };
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            document.removeEventListener('mousemove', onMouseMove);
        };
    }, [settings.autoHide, paged]);

    // Auto-scroll (webtoon mode). Keeps its own float position so slow speeds
    // aren't lost to integer rounding, and re-syncs if the reader scrolls by hand.
    useEffect(() => {
        if (!autoScroll || paged) return undefined;
        let raf = 0, last = performance.now(), pos = window.scrollY, set = window.scrollY;
        const tick = (now) => {
            const dt = Math.min(now - last, 64) / 1000;
            last = now;
            if (Math.abs(window.scrollY - set) > 2) pos = window.scrollY;
            pos += SPEEDS[settings.speed] * dt;
            window.scrollTo({ top: pos, behavior: 'instant' });
            set = window.scrollY;
            const end = endRef.current;
            if (end && end.getBoundingClientRect().top < window.innerHeight * 0.55) {
                setAutoScroll(false);
                return;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [autoScroll, paged, settings.speed]);

    const currentIndex = allChapters.findIndex((c) => c.id === chapterId);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < allChapters.length - 1;
    const currentChapter = currentIndex >= 0 ? allChapters[currentIndex] : null;
    const nextChapter = hasNext ? allChapters[currentIndex + 1] : null;
    const a = currentChapter?.attributes || {};
    const chapterNum = a.chapter ? `Chapter ${a.chapter}` : 'Oneshot';
    const chapterTitleText = a.title ? `: ${a.title}` : '';
    const groupName = getChapterGroupName(currentChapter);

    useEffect(() => {
        document.title = `${chapterNum}${chapterTitleText} · Kitsunescan`;
    }, [chapterNum, chapterTitleText]);

    // Warm up the next chapter once the reader is most of the way through.
    useEffect(() => {
        if (!nextChapter || !total || currentPage < total * 0.7 || preloaded.current === nextChapter.id) return;
        preloaded.current = nextChapter.id;
        fetchChapterPages(nextChapter.id)
            .then((d) => {
                const list = d.pages.slice(0, 2);
                list.forEach((pg) => { new Image().src = getPageImageUrl(d.baseUrl, d.chapter.hash, pg, d.usingDataSaver); });
            })
            .catch(() => { preloaded.current = ''; });
    }, [currentPage, total, nextChapter]);

    // Paged mode: preload the next couple of pages.
    useEffect(() => {
        if (!paged) return;
        for (let i = currentPage + 1; i <= currentPage + 2 && i < total; i++) new Image().src = pageUrls[i];
    }, [paged, currentPage, total, pageUrls]);

    // A stable ref callback. An inline arrow is a new function every render, so
    // React would detach and re-attach every page ref on each re-render.
    const setPageRef = useCallback((el) => {
        if (!el) return;
        pageRefs.current[Number(el.dataset.pageIndex)] = el;
    }, []);

    const goToChapter = useCallback((idx) => {
        const chapter = allChapters[idx];
        if (!chapter) return;
        window.history.pushState({}, '', readUrl(mangaId, chapter.id));
        setChapterId(chapter.id);
        setHeaderHidden(false);
    }, [allChapters, mangaId]);

    const goToPage = useCallback((i) => {
        const idx = Math.min(Math.max(i, 0), Math.max(total - 1, 0));
        if (paged) { setCurrentPage(idx); window.scrollTo({ top: 0 }); }
        else if (idx === 0) window.scrollTo({ top: 0, behavior: 'instant' });
        else pageRefs.current[idx]?.scrollIntoView({ behavior: 'instant', block: 'start' });
    }, [paged, total]);

    // Paged-mode stepping; running off either end moves to the neighbouring chapter.
    const step = useCallback((d) => {
        const next = currentPage + d;
        if (next < 0) { if (hasPrev) goToChapter(currentIndex - 1); else showToast('This is the first chapter'); return; }
        if (next >= total) { if (hasNext) goToChapter(currentIndex + 1); else showToast("You're all caught up"); return; }
        setCurrentPage(next);
        window.scrollTo({ top: 0 });
    }, [currentPage, total, hasPrev, hasNext, currentIndex, goToChapter, showToast]);

    const toggleFullscreen = useCallback(() => {
        try {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen?.();
        } catch { /* not supported */ }
    }, []);
    useEffect(() => {
        const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onFs);
        return () => document.removeEventListener('fullscreenchange', onFs);
    }, []);

    const changeSpeed = useCallback((d) => {
        updateSettings({ speed: Math.min(10, Math.max(1, settings.speed + d)) });
    }, [settings.speed, updateSettings]);

    // Keyboard shortcuts
    useEffect(() => {
        const onKey = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
            const k = e.key;
            if (k === 'Escape') {
                if (keysOpen) setKeysOpen(false);
                else if (settingsOpen) setSettingsOpen(false);
                else if (jumpOpen) setJumpOpen(false);
                else if (autoScroll) setAutoScroll(false);
                return;
            }
            if (k === 's' || k === 'S') { setSettingsOpen((o) => !o); return; }
            if (k === '?') { setKeysOpen((o) => !o); return; }
            if (k === 'f' || k === 'F') { toggleFullscreen(); return; }
            if (k === 't' || k === 'T') { window.scrollTo({ top: 0, behavior: 'smooth' }); setCurrentPage(0); return; }
            if (k === 'p' || k === 'P') { if (!paged) setAutoScroll((v) => !v); return; }
            if (k === '+' || k === '=') { changeSpeed(1); return; }
            if (k === '-' || k === '_') { changeSpeed(-1); return; }
            if (k === ']') { if (hasNext) goToChapter(currentIndex + 1); return; }
            if (k === '[') { if (hasPrev) goToChapter(currentIndex - 1); return; }
            if (k === 'ArrowRight' || k === 'ArrowLeft') {
                const fwd = k === 'ArrowRight' ? !rtl : rtl;
                if (e.shiftKey || !paged) {
                    // Chapter navigation (plain arrows are reserved for pages in paged mode).
                    if (e.shiftKey) { e.preventDefault(); const to = k === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1; if (allChapters[to]) goToChapter(to); }
                    return;
                }
                e.preventDefault();
                step(fwd ? 1 : -1);
                return;
            }
            if (paged && (k === ' ' || k === 'PageDown')) { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
            if (paged && k === 'PageUp') { e.preventDefault(); step(-1); return; }
            if (!paged && (k === 'j' || k === 'J')) { window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' }); return; }
            if (!paged && (k === 'k' || k === 'K')) { window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' }); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [paged, rtl, keysOpen, settingsOpen, jumpOpen, autoScroll, hasNext, hasPrev, currentIndex, allChapters, goToChapter, step, toggleFullscreen, changeSpeed]);

    // Taps: toggle the toolbar; in paged mode the edges turn pages.
    const onReaderClick = (e) => {
        if (e.target.closest('a,button,select,input,label')) return;
        if (jumpOpen) { setJumpOpen(false); return; }
        if (paged) {
            const x = e.clientX / window.innerWidth;
            if (x < 0.3) step(rtl ? 1 : -1);
            else if (x > 0.7) step(rtl ? -1 : 1);
            else setHeaderHidden((h) => !h);
        } else if (window.matchMedia('(pointer: coarse)').matches) {
            setHeaderHidden((h) => !h);
        }
    };

    const rootStyle = {
        '--reader-width': WIDTHS[settings.width],
        '--reader-gap': `${settings.gap}px`,
        '--reader-bright': settings.brightness / 100,
    };
    const showHeader = !headerHidden || settingsOpen;
    const pageNum = Math.min(currentPage + 1, Math.max(total, 1));

    const visiblePages = paged ? [currentPage] : files.list.map((_, i) => i);

    return (
        <div id="chapter-reader-view" className={`reader-root view active is-${paged ? 'paged' : 'webtoon'} bg-${settings.bg}`} style={rootStyle}>
            <div className="reader-progress" aria-hidden="true"><span ref={progressRef} /></div>

            <div className={`reader-header${showHeader ? '' : ' hidden'}`}>
                <div className="reader-header-content">
                    <div className="reader-nav-controls">
                        <a id="back-to-details" className="back-btn" href={mangaUrl(mangaId)}><span>Back</span></a>
                    </div>
                    <div className="reader-title-block">
                        <h2 id="chapter-title">{chapterNum}{chapterTitleText}</h2>
                        {groupName && <span className="reader-credit">Translated by {groupName}</span>}
                    </div>
                    <div className="reader-chapter-nav">
                        <button id="prev-chapter" disabled={!hasPrev} onClick={() => goToChapter(currentIndex - 1)} aria-label="Previous chapter"><span>Prev</span></button>
                        <select
                            className="chapter-select"
                            aria-label="Jump to chapter"
                            value={currentIndex >= 0 ? chapterId : ''}
                            onChange={(e) => goToChapter(allChapters.findIndex((c) => c.id === e.target.value))}
                            disabled={!allChapters.length}
                        >
                            {currentIndex < 0 && <option value="">{chapterNum}</option>}
                            {allChapters.map((c) => <option key={c.id} value={c.id}>{chapterLabel(c)}</option>)}
                        </select>
                        <button id="next-chapter" disabled={!hasNext} onClick={() => goToChapter(currentIndex + 1)} aria-label="Next chapter"><span>Next</span></button>
                    </div>
                    <div className="reader-tools">
                        <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)">
                            {fullscreen ? <IconCompress /> : <IconExpand />}
                        </button>
                        <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Reader settings" title="Settings (S)">
                            <IconGear />
                        </button>
                    </div>
                </div>
            </div>

            <div className="reader-content" ref={contentRef} onClick={onReaderClick}>
                <div className="chapter-pages">
                    {loading && <ReaderPageSkeleton />}
                    {!loading && error && (
                        <div className="error">
                            <h3>Couldn't load this chapter</h3>
                            <p>{error}</p>
                            <button type="button" className="error-action" onClick={() => window.location.reload()}>Try again</button>
                        </div>
                    )}
                    {!loading && !error && chapterData && (
                        <>
                            {files.saver && (
                                <div className="reader-warning">
                                    {settings.dataSaver ? 'Data-saver images are on.' : 'Lower-quality data-saver images are shown for this chapter.'}
                                </div>
                            )}
                            {visiblePages.map((idx) => (
                                <ChapterPage key={files.list[idx]} index={idx} src={pageUrls[idx]} innerRef={setPageRef} onFailure={handlePageFailure} />
                            ))}
                        </>
                    )}
                </div>

                {!loading && !error && chapterData && !paged && (
                    <section className="reader-end" ref={endRef} aria-label="End of chapter">
                        <p className="reader-end-kicker">End of {chapterNum}</p>
                        <h3>{hasNext ? 'Ready for more?' : "You're all caught up"}</h3>
                        <div className="reader-end-actions">
                            {hasNext && (
                                <button type="button" className="reader-end-btn primary" onClick={() => goToChapter(currentIndex + 1)}>
                                    Next: {chapterLabel(nextChapter)}
                                </button>
                            )}
                            {hasPrev && (
                                <button type="button" className="reader-end-btn" onClick={() => goToChapter(currentIndex - 1)}>Previous chapter</button>
                            )}
                            <a className="reader-end-btn" href={mangaUrl(mangaId)}>Back to series</a>
                        </div>
                    </section>
                )}
            </div>

            {/* Floating controls */}
            {!loading && !error && total > 0 && (
                <div className={`reader-dock${atEnd && !paged ? ' at-end' : ''}`}>
                    <div className={`reader-dock-side${showHeader || autoScroll ? '' : ' faded'}`}>
                        {!paged && autoScroll && (
                            <div className="speed-stepper" role="group" aria-label="Auto-scroll speed">
                                <button type="button" onClick={() => changeSpeed(-1)} aria-label="Slower" disabled={settings.speed <= 1}>−</button>
                                <span>{settings.speed}</span>
                                <button type="button" onClick={() => changeSpeed(1)} aria-label="Faster" disabled={settings.speed >= 10}>+</button>
                            </div>
                        )}
                        {!paged && (
                            <button type="button" className={`dock-btn${autoScroll ? ' on' : ''}`} onClick={() => setAutoScroll((v) => !v)}
                                aria-pressed={autoScroll} aria-label={autoScroll ? 'Pause auto-scroll' : 'Start auto-scroll'} title="Auto-scroll (P)">
                                {autoScroll ? <IconPause /> : <IconPlay />}
                            </button>
                        )}
                        <button type="button" className="dock-btn" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); if (paged) setCurrentPage(0); }} aria-label="Back to top" title="Top (T)">
                            <IconUp />
                        </button>
                    </div>

                    <div className="reader-pill-wrap">
                        {jumpOpen && (
                            <div className="reader-jump" role="dialog" aria-label="Jump to page">
                                <input type="range" min="1" max={total} value={pageNum} onChange={(e) => goToPage(Number(e.target.value) - 1)} aria-label="Page" />
                                <div className="reader-jump-row"><span>1</span><span>{total}</span></div>
                            </div>
                        )}
                        <button type="button" className="reader-pill" onClick={() => setJumpOpen((o) => !o)} aria-expanded={jumpOpen} aria-label={`Page ${pageNum} of ${total}. Jump to page`}>
                            {pageNum} <i>/</i> {total}
                        </button>
                    </div>
                </div>
            )}

            {toast && <div className="reader-toast" role="status">{toast}</div>}

            <ReaderSettings
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={settings}
                update={updateSettings}
                reset={resetSettings}
                onShowKeys={() => { setSettingsOpen(false); setKeysOpen(true); }}
            />

            {keysOpen && (
                <div className="keys-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setKeysOpen(false)}>
                    <div className="keys-card" onClick={(e) => e.stopPropagation()}>
                        <div className="rs-head">
                            <h3><IconKeys /> Keyboard shortcuts</h3>
                            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setKeysOpen(false)}><IconClose /></button>
                        </div>
                        <dl>
                            {SHORTCUTS.map(([k, d]) => (
                                <div key={k}><dt>{k}</dt><dd>{d}</dd></div>
                            ))}
                        </dl>
                    </div>
                </div>
            )}
        </div>
    );
}
