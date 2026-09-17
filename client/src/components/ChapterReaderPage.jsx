import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CHAPTER_LIMIT, fetchChapters, fetchChapterPages, getPageImageUrl, isAbortError } from '../api.js';
import { createFallbackSVG, getLastReadPage, saveLastReadPage } from '../utils.js';
import { ReaderPageSkeleton } from './Skeleton.jsx';

// How many pages to load eagerly before handing off to native lazy loading.
const EAGER_PAGES = 2;

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

export default function ChapterReaderPage() {
    const { mangaId, chapterId } = useParams();
    const navigate = useNavigate();

    const [allChapters, setAllChapters] = useState([]);
    const [chapterData, setChapterData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const pageRefs = useRef([]);
    const headerStateRef = useRef({ lastPos: 0, scrollUpStart: 0, isScrollingUp: false });

    // Load the manga's chapter list once (or when manga changes).
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const { chapters } = await fetchChapters(mangaId, 0, CHAPTER_LIMIT, '', controller.signal);
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
        serverRefreshes.current = 0;
        // Drop references to the previous chapter's DOM nodes. Truncating the
        // array (rather than leaving it long) means a 200-page chapter can't
        // keep 200 detached <div> elements reachable after a 5-page one loads.
        pageRefs.current.length = 0;
        (async () => {
            try {
                const data = await fetchChapterPages(chapterId, controller.signal);
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

    // Restore last-read scroll position + track it as the user scrolls.
    useEffect(() => {
        if (!chapterData || loading) return;
        const containers = pageRefs.current.filter(Boolean);
        if (!containers.length) return;

        const lastIdx = getLastReadPage(chapterId);
        const t = setTimeout(() => {
            containers[Math.min(lastIdx, containers.length - 1)]?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 10);

        // A Map lookup replaces the old containers.indexOf() scan, which ran on
        // every intersection and was O(pages) each time — noticeable on long
        // chapters where the observer fires constantly while scrolling.
        const indexOf = new Map(containers.map((el, i) => [el, i]));
        let lastSaved = lastIdx;
        let rafId = 0;
        let pendingIdx = null;

        const flush = () => {
            rafId = 0;
            if (pendingIdx !== null && pendingIdx !== lastSaved) {
                lastSaved = pendingIdx;
                // localStorage writes are synchronous and block the main
                // thread; doing one per intersection made fast scrolling janky.
                saveLastReadPage(chapterId, pendingIdx);
            }
            pendingIdx = null;
        };

        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const idx = indexOf.get(entry.target);
                if (idx === undefined) continue;
                pendingIdx = idx;
            }
            if (pendingIdx !== null && !rafId) rafId = requestAnimationFrame(flush);
        }, { threshold: 0.6 });
        containers.forEach((c) => observer.observe(c));

        return () => {
            clearTimeout(t);
            if (rafId) cancelAnimationFrame(rafId);
            observer.disconnect();
            indexOf.clear();
        };
    }, [chapterData, loading, chapterId]);

    // Smart header: hides on scroll-down, reappears on a decent scroll-up.
    useEffect(() => {
        const SCROLL_THRESHOLD = 100, SCROLL_UP_THRESHOLD = 500, HIDE_DELAY = 2000, SHOW_DELAY = 300;
        let timeout;
        let ticking = false;

        function evaluate() {
            ticking = false;
            const state = headerStateRef.current;
            const curr = window.scrollY;
            const diff = state.lastPos - curr;
            clearTimeout(timeout);
            if (curr > state.lastPos && curr > SCROLL_THRESHOLD) {
                state.isScrollingUp = false;
                timeout = setTimeout(() => setHeaderHidden(true), 100);
            } else if (diff > 0) {
                if (!state.isScrollingUp) { state.scrollUpStart = curr; state.isScrollingUp = true; }
                if (state.scrollUpStart - curr > SCROLL_UP_THRESHOLD) {
                    timeout = setTimeout(() => {
                        setHeaderHidden(false);
                        timeout = setTimeout(() => {
                            if (window.scrollY > SCROLL_THRESHOLD) setHeaderHidden(true);
                        }, HIDE_DELAY);
                    }, SHOW_DELAY);
                }
            }
            state.lastPos = curr;
        }

        // Coalesce scroll events to one frame. Reading window.scrollY inside the
        // raw handler forces layout on every event, which is the classic cause
        // of scroll jank on a long image list.
        function onScroll() {
            if (!ticking) { ticking = true; requestAnimationFrame(evaluate); }
        }
        function onMouseMove(e) {
            // Bail before touching state on the vast majority of mousemoves.
            if (e.clientY >= 100) return;
            setHeaderHidden((hidden) => (hidden ? false : hidden));
        }
        // passive: true tells the browser it never needs to wait on these
        // handlers before scrolling.
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        return () => {
            clearTimeout(timeout);
            window.removeEventListener('scroll', onScroll);
            document.removeEventListener('mousemove', onMouseMove);
        };
    }, []);

    const currentIndex = allChapters.findIndex((c) => c.id === chapterId);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < allChapters.length - 1;
    const currentChapter = currentIndex >= 0 ? allChapters[currentIndex] : null;
    const a = currentChapter?.attributes || {};
    const chapterNum = a.chapter ? `Chapter ${a.chapter}` : 'Oneshot';
    const chapterTitleText = a.title ? `: ${a.title}` : '';

    // Page URLs are pure derivations of chapterData; recomputing them (and
    // building a fresh encodeURIComponent string per page) on every header
    // show/hide re-render was wasted work on long chapters.
    const pageUrls = useMemo(() => {
        if (!chapterData) return [];
        return chapterData.pages.map((pg) =>
            getPageImageUrl(chapterData.baseUrl, chapterData.chapter.hash, pg, chapterData.usingDataSaver)
        );
    }, [chapterData]);

    // A single stable ref callback. An inline `ref={(el) => ...}` arrow is a new
    // function on every render, so React detaches and re-attaches every page ref
    // each time the header toggles — the index comes off the DOM node instead.
    const setPageRef = useCallback((el) => {
        if (!el) return;
        pageRefs.current[Number(el.dataset.pageIndex)] = el;
    }, []);

    function goToChapter(idx) {
        const chapter = allChapters[idx];
        if (chapter) navigate(`/manga/${mangaId}/chapter/${chapter.id}`);
    }

    return (
        <div id="chapter-reader-view" className="view active">
            <div className={`reader-header${headerHidden ? ' hidden' : ''}`}>
                <div className="reader-header-content">
                    <div className="reader-nav-controls">
                        <button id="back-to-details" className="back-btn" onClick={() => navigate(`/manga/${mangaId}`)}><span>Back</span></button>
                    </div>
                    <h2 id="chapter-title">{chapterNum}{chapterTitleText}</h2>
                    <div className="reader-chapter-nav">
                        <button id="prev-chapter" disabled={!hasPrev} onClick={() => goToChapter(currentIndex - 1)}><span>Previous</span></button>
                        <span id="chapter-info">{chapterNum}</span>
                        <button id="next-chapter" disabled={!hasNext} onClick={() => goToChapter(currentIndex + 1)}><span>Next</span></button>
                    </div>
                </div>
            </div>

            <div className="reader-content">
                <div className="chapter-pages">
                    {loading && <ReaderPageSkeleton />}
                    {!loading && error && <div className="error">{error}</div>}
                    {!loading && !error && chapterData && (
                        <>
                            {chapterData.usingDataSaver && (
                                <div className="reader-warning">
                                    Lower-quality data-saver images are shown for this chapter.
                                </div>
                            )}
                            {chapterData.pages.map((pg, idx) => (
                                <ChapterPage key={pg} index={idx} src={pageUrls[idx]} innerRef={setPageRef} onFailure={handlePageFailure} />
                            ))}
                        </>
                    )}
                </div>
            </div>

            <div className="reader-footer">
                <div className="reader-controls">
                    <button id="prev-chapter-bottom" disabled={!hasPrev} onClick={() => goToChapter(currentIndex - 1)}>Previous Chapter</button>
                    <span id="chapter-info-bottom">{chapterNum}</span>
                    <button id="next-chapter-bottom" disabled={!hasNext} onClick={() => goToChapter(currentIndex + 1)}>Next Chapter</button>
                </div>
            </div>
        </div>
    );
}
