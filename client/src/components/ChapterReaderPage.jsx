import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CHAPTER_LIMIT, fetchChapters, fetchChapterPages, getPageImageUrl, isAbortError } from '../api.js';
import { createFallbackSVG, getLastReadPage, saveLastReadPage } from '../utils.js';
import { ReaderPageSkeleton } from './Skeleton.jsx';

// How many pages to load eagerly before handing off to native lazy loading.
const EAGER_PAGES = 2;

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

    // Load the current chapter's pages whenever chapterId changes.
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
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
                                <div className="warning" style={{ color: '#ffb300', margin: '10px 0', textAlign: 'center' }}>
                                    Note: Low quality images (data-saver) are shown for this chapter.
                                </div>
                            )}
                            {chapterData.pages.map((pg, idx) => (
                                <div className="page-container" key={pg} data-page-index={idx} ref={setPageRef}>
                                    <img
                                        className="page-image"
                                        alt={`Page ${idx + 1}`}
                                        loading={idx < EAGER_PAGES ? 'eager' : 'lazy'}
                                        // Decoding off the main thread keeps scrolling smooth
                                        // while large page images are being rasterised.
                                        decoding="async"
                                        // Lowercase: React 18 does not map the camelCase
                                        // `fetchPriority` prop, so it must be passed as a
                                        // plain DOM attribute.
                                        fetchpriority={idx < EAGER_PAGES ? 'high' : 'low'}
                                        src={pageUrls[idx]}
                                        onError={(e) => { e.target.src = createFallbackSVG(`Failed to load page ${idx + 1}`, 600, 800); }}
                                    />
                                </div>
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
