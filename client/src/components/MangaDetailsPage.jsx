import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HOME_URL, readUrl, getQueryParam } from '../routes.js';
import { cleanDescription } from '../utils.js';
import {
    CHAPTER_LIMIT,
    fetchMangaDetails,
    fetchChapters,
    fetchMangaStatistics,
    fetchMangaAggregate,
    getMainTitle,
    getAltTitles,
    getDescription,
    getCoverImageUrl,
    languageLabel,
    isAbortError,
    getChapterGroupName,
} from '../api.js';
import { MangaDetailsSkeleton, ChapterItemSkeleton } from './Skeleton.jsx';

export default function MangaDetailsPage() {
    // Its own HTML page: /manga.html?id=<id>
    const mangaId = getQueryParam('id');

    const [manga, setManga] = useState(null);
    const [chapters, setChapters] = useState([]);
    const [totalChapters, setTotalChapters] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(mangaId ? null : 'No manga selected');
    const [loadingMore, setLoadingMore] = useState(false);
    const [coverAspect, setCoverAspect] = useState(null);
    const [chapterLanguage, setChapterLanguage] = useState('');
    const [chaptersLoading, setChaptersLoading] = useState(true);
    const [stats, setStats] = useState(null);
    const [chapterView, setChapterView] = useState('list'); // 'list' | 'volumes'
    const [volumes, setVolumes] = useState([]);
    const [volumesLoading, setVolumesLoading] = useState(false);
    const [volumesError, setVolumesError] = useState(null);
    const [expandedVolumes, setExpandedVolumes] = useState(() => new Set());
    const [descOpen, setDescOpen] = useState(false);
    const loadMoreAbortRef = useRef(null);

    // Load manga details once per manga.
    useEffect(() => {
        if (!mangaId) { setLoading(false); return undefined; }
        // An AbortController does what the old `cancelled` flag did AND stops the
        // network request itself, instead of letting it finish and throwing the
        // result away.
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setChapterLanguage('');
        (async () => {
            try {
                const details = await fetchMangaDetails(mangaId, controller.signal);
                setManga(details);
            } catch (err) {
                if (!isAbortError(err)) setError(err.message || 'Failed to load manga');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [mangaId]);

    // Load (or reload) the chapter list whenever the manga or the language filter changes.
    useEffect(() => {
        const controller = new AbortController();
        setChaptersLoading(true);
        setChapters([]);
        (async () => {
            try {
                const chapterData = await fetchChapters(mangaId, 0, CHAPTER_LIMIT, chapterLanguage, controller.signal);
                setChapters(chapterData.chapters);
                setTotalChapters(chapterData.total);
            } catch (err) {
                if (!isAbortError(err)) setError((prev) => prev || err.message || 'Failed to load chapters');
            } finally {
                if (!controller.signal.aborted) setChaptersLoading(false);
            }
        })();
        return () => controller.abort();
    }, [mangaId, chapterLanguage]);

    // Rating/follows are cosmetic, so they're loaded independently and never
    // block or fail the rest of the page.
    useEffect(() => {
        const controller = new AbortController();
        setStats(null);
        fetchMangaStatistics(mangaId, controller.signal)
            .then((s) => { if (!controller.signal.aborted) setStats(s); })
            .catch(() => {});
        return () => controller.abort();
    }, [mangaId]);

    // The "by volume" tree is only fetched the first time that view is opened
    // (and refetched if the manga or language filter changes while it's the
    // active view) — most visits never switch away from the flat list.
    useEffect(() => {
        if (chapterView !== 'volumes') return;
        const controller = new AbortController();
        setVolumesLoading(true);
        setVolumesError(null);
        fetchMangaAggregate(mangaId, chapterLanguage, controller.signal)
            .then((v) => {
                if (controller.signal.aborted) return;
                setVolumes(v);
                setExpandedVolumes(new Set(v.slice(0, 1).map((vol) => vol.volume)));
            })
            .catch((err) => { if (!isAbortError(err)) setVolumesError(err.message || 'Failed to load volumes'); })
            .finally(() => { if (!controller.signal.aborted) setVolumesLoading(false); });
        return () => controller.abort();
    }, [mangaId, chapterLanguage, chapterView]);

    function toggleVolume(volKey) {
        setExpandedVolumes((prev) => {
            const next = new Set(prev);
            if (next.has(volKey)) next.delete(volKey); else next.add(volKey);
            return next;
        });
    }

    // "Load More" was the one request with no cancellation at all — navigating
    // away mid-load left it running and then set state on a dead component.
    useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

    async function loadMoreChapters() {
        loadMoreAbortRef.current?.abort();
        const controller = new AbortController();
        loadMoreAbortRef.current = controller;
        setLoadingMore(true);
        try {
            const more = await fetchChapters(mangaId, chapters.length, CHAPTER_LIMIT, chapterLanguage, controller.signal);
            setChapters((prev) => [...prev, ...more.chapters]);
        } catch (err) {
            if (!isAbortError(err)) setError((prev) => prev || err.message || 'Failed to load more chapters');
        } finally {
            if (!controller.signal.aborted) setLoadingMore(false);
        }
    }

    // Formatting 500 chapter rows — including a `new Date(...).toLocaleDateString()`
    // per row, which is genuinely expensive — used to happen on every single
    // render. Now it happens only when the chapter list itself changes.
    const chapterRows = useMemo(() => chapters.map((c, idx) => {
        const a = c.attributes || {};
        const chapterNum = a.chapter ? `Ch. ${a.chapter}` : 'Oneshot';
        const chapterTitle = a.title ? `: ${a.title}` : '';
        const volume = a.volume ? `Vol. ${a.volume}` : '';
        const pages = a.pages ? `${a.pages} pages` : '';
        const publishDate = a.publishAt ? new Date(a.publishAt).toLocaleDateString() : '';
        const lang = a.translatedLanguage ? a.translatedLanguage.toUpperCase() : '';
        return {
            id: c.id,
            idx,
            titleText: `${chapterNum}${chapterTitle}`,
            metaText: [lang, volume, pages, publishDate, getChapterGroupName(c)].filter(Boolean).join(' • '),
        };
    }), [chapters]);

    useEffect(() => {
        if (manga) document.title = `${getMainTitle(manga.attributes)} · Kitsunescan`;
    }, [manga]);

    if (loading) {
        return <MangaDetailsSkeleton />;
    }

    if (error || !manga) {
        return (
            <div id="manga-details-view" className="view active">
                <a className="back-btn" href={HOME_URL}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"></path>
                    </svg>
                    Back to gallery
                </a>
                <div className="error details-error">
                    <h3>Couldn't load this title</h3>
                    <p>{error || 'Manga not found'}</p>
                    <button className="error-action" onClick={() => location.reload()}>Reload page</button>
                </div>
            </div>
        );
    }

    const attr = manga.attributes || {};
    const title = getMainTitle(attr);
    const authorRel = manga.relationships?.find((r) => r.type === 'author');
    const artistRel = manga.relationships?.find((r) => r.type === 'artist');
    const tags = (attr.tags || []).map((t) => t.attributes?.name?.en).filter(Boolean);
    const genres = (attr.tags || []).filter((t) => t.attributes?.group === 'genre').map((t) => t.attributes?.name?.en).filter(Boolean);
    // The poster and the backdrop share one 512px thumbnail: still a fraction
    // of the original's weight, and the browser only downloads it once.
    const coverUrl = getCoverImageUrl(manga, 512);
    const coverClass = coverAspect === 'tall' ? 'detail-poster tall' : coverAspect === 'wide' ? 'detail-poster wide' : 'detail-poster';
    const availableLanguages = attr.availableTranslatedLanguages || [];
    const description = cleanDescription(getDescription(attr), { paragraphs: true }) || 'No description available';
    const longDescription = description.length > 420;
    const altTitles = getAltTitles(attr);
    const statusLabel = attr.status ? attr.status.charAt(0).toUpperCase() + attr.status.slice(1) : 'Unknown';
    const firstChapter = chapters[0];

    return (
        <div id="manga-details-view" className="view active">
            <section className="detail-hero">
                {coverUrl && <img className="detail-hero-bg" src={coverUrl} alt="" decoding="async" />}
                <div className="detail-hero-scrim" aria-hidden="true" />

                <div className="detail-hero-inner">
                    <a id="back-to-gallery" className="back-btn detail-back" href={HOME_URL}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"></path>
                        </svg>
                        Back to gallery
                    </a>

                    <div className="detail-hero-main">
                        {coverUrl && (
                            <img
                                className={coverClass}
                                src={coverUrl}
                                alt={title}
                                onLoad={(e) => {
                                    const ratio = e.target.naturalWidth / e.target.naturalHeight;
                                    setCoverAspect(ratio < 0.6 ? 'tall' : ratio > 0.8 ? 'wide' : null);
                                }}
                                decoding="async"
                                fetchpriority="high"
                                onError={(e) => { e.target.style.display = 'none'; }}
                            />
                        )}

                        <div className="detail-hero-copy">
                            <div className="detail-eyebrow">{[statusLabel, attr.year].filter(Boolean).join(' · ')}</div>
                            <h1 id="manga-details-title">{title}</h1>
                            {altTitles && <div className="detail-alt">{altTitles}</div>}

                            {stats && (stats.rating != null || stats.follows != null) && (
                                <div className="manga-stats-bar">
                                    {stats.rating != null && (
                                        <span className="stat-pill stat-pill-rating">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8L6 21l1.6-7L2.2 9.2l7.1-.6z" /></svg>
                                            {stats.rating.toFixed(1)} <span className="stat-pill-label">rating</span>
                                        </span>
                                    )}
                                    {stats.follows != null && (
                                        <span className="stat-pill stat-pill-follows">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                                            {stats.follows.toLocaleString()} <span className="stat-pill-label">follows</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {tags.length > 0 && (
                                <div className="detail-tags">
                                    {tags.slice(0, 8).map((t) => <span key={t} className="detail-tag">{t}</span>)}
                                </div>
                            )}

                            <div className="hero-actions">
                                {firstChapter ? (
                                    <a className="hero-btn hero-btn-primary" href={readUrl(manga.id, firstChapter.id)}>
                                        Start reading
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                                        </svg>
                                    </a>
                                ) : (
                                    <span className="hero-btn hero-btn-primary is-disabled">{chaptersLoading ? 'Loading chapters…' : 'No chapters yet'}</span>
                                )}
                                <a className="hero-btn hero-btn-ghost" href="#chapters">Browse chapters</a>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="detail-layout">
                <div className="detail-main">
                    <section className="detail-card manga-description">
                        <h3>Synopsis</h3>
                        <div id="manga-full-description" className={`detail-desc${longDescription && !descOpen ? ' clamped' : ''}`}>{description}</div>
                        {longDescription && (
                            <button type="button" className="detail-more" onClick={() => setDescOpen((o) => !o)}>
                                {descOpen ? 'Show less' : 'Read more'}
                            </button>
                        )}
                    </section>

                    <section id="chapters" className="detail-card manga-chapters">
                        <div className="chapters-header">
                            <h3>Chapters</h3>
                            <div className="chapter-view-toggle" role="tablist" aria-label="Chapter view">
                                <button type="button" className={chapterView === 'list' ? 'active' : ''} onClick={() => setChapterView('list')}>List</button>
                                <button type="button" className={chapterView === 'volumes' ? 'active' : ''} onClick={() => setChapterView('volumes')}>By volume</button>
                            </div>
                            {availableLanguages.length > 1 && (
                                <div className="chapter-lang-filter">
                                    <label htmlFor="chapter-lang-select">Language</label>
                                    <select id="chapter-lang-select" value={chapterLanguage} onChange={(e) => setChapterLanguage(e.target.value)}>
                                        <option value="">All languages</option>
                                        {availableLanguages.map((code) => (
                                            <option key={code} value={code}>{languageLabel(code)}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                        <div id="manga-chapters-list" className="chapters-list">
                            {chapterView === 'list' ? (
                                chaptersLoading ? (
                                    Array.from({ length: 6 }).map((_, i) => <ChapterItemSkeleton key={i} />)
                                ) : chapters.length === 0 ? (
                                    <div className="error full-span">No chapters available{chapterLanguage ? ' in this language' : ''}</div>
                                ) : (
                                    <>
                                        <div className="chapter-list-header">{totalChapters || chapters.length} chapters available</div>
                                        {chapterRows.map(({ id, titleText, metaText }) => (
                                            <a key={id} className="chapter-item" href={readUrl(manga.id, id)}>
                                                <span className="chapter-title">{titleText}</span>
                                                <span className="chapter-meta">{metaText}</span>
                                            </a>
                                        ))}
                                        {totalChapters > chapters.length && (
                                            <button className="load-more-chapters" disabled={loadingMore} onClick={loadMoreChapters}>
                                                {loadingMore ? 'Loading…' : 'Load more chapters'}
                                            </button>
                                        )}
                                    </>
                                )
                            ) : volumesLoading ? (
                                Array.from({ length: 4 }).map((_, i) => <ChapterItemSkeleton key={i} />)
                            ) : volumesError ? (
                                <div className="error full-span">{volumesError}</div>
                            ) : volumes.length === 0 ? (
                                <div className="error full-span">No volume data available{chapterLanguage ? ' in this language' : ''}</div>
                            ) : (
                                <div className="volume-accordion">
                                    {volumes.map((vol) => {
                                        const key = vol.volume ?? 'none';
                                        const isOpen = expandedVolumes.has(vol.volume);
                                        return (
                                            <div key={key} className={`volume-group${isOpen ? ' open' : ''}`}>
                                                <button type="button" className="volume-group-header" onClick={() => toggleVolume(vol.volume)}>
                                                    <svg className="volume-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                                                    <span>{vol.volume ? `Volume ${vol.volume}` : 'No volume'}</span>
                                                    <span className="volume-count">{vol.chapters.length} ch.</span>
                                                </button>
                                                {isOpen && (
                                                    <div className="volume-chapter-grid">
                                                        {vol.chapters.map((c) => (
                                                            <a
                                                                key={c.id}
                                                                className="volume-chapter-chip"
                                                                title={c.count > 1 ? `${c.count} translations` : undefined}
                                                                href={readUrl(manga.id, c.id)}
                                                            >
                                                                {c.chapter ? `Ch. ${c.chapter}` : 'Oneshot'}
                                                                {c.count > 1 && <span className="volume-chapter-chip-count">{c.count}</span>}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <aside className="detail-side">
                    <div className="detail-card manga-meta">
                        <h3>Details</h3>
                        <div className="meta-item"><strong>Status</strong> <span>{statusLabel}</span></div>
                        <div className="meta-item"><strong>Year</strong> <span>{attr.year || 'Unknown'}</span></div>
                        <div className="meta-item"><strong>Author</strong> <span>{authorRel?.attributes?.name || 'Unknown'}</span></div>
                        <div className="meta-item"><strong>Artist</strong> <span>{artistRel?.attributes?.name || 'Unknown'}</span></div>
                        <div className="meta-item"><strong>Genres</strong> <span>{genres.join(', ') || 'Unknown'}</span></div>
                        {availableLanguages.length > 0 && (
                            <div className="meta-item"><strong>Languages</strong> <span>{availableLanguages.length} available</span></div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
