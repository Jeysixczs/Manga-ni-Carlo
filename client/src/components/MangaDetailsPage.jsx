import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from '../api.js';
import { MangaDetailsSkeleton, ChapterItemSkeleton } from './Skeleton.jsx';

export default function MangaDetailsPage() {
    const { mangaId } = useParams();
    const navigate = useNavigate();

    const [manga, setManga] = useState(null);
    const [chapters, setChapters] = useState([]);
    const [totalChapters, setTotalChapters] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
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
    const loadMoreAbortRef = useRef(null);

    // Load manga details once per manga.
    useEffect(() => {
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
            metaText: [lang, volume, pages, publishDate].filter(Boolean).join(' • '),
        };
    }), [chapters]);

    if (loading) {
        return <MangaDetailsSkeleton />;
    }

    if (error || !manga) {
        return (
            <div id="manga-details-view" className="view active">
                <div className="container">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"></path>
                        </svg>
                        Back to Gallery
                    </button>
                    <div className="error">{error || 'Manga not found'}</div>
                </div>
            </div>
        );
    }

    const attr = manga.attributes || {};
    const title = getMainTitle(attr);
    const authorRel = manga.relationships?.find((r) => r.type === 'author');
    const artistRel = manga.relationships?.find((r) => r.type === 'artist');
    const tags = attr.tags || [];
    const genres = tags.filter((t) => t.attributes?.group === 'genre').map((t) => t.attributes?.name?.en || 'Unknown').join(', ');
    // The details view shows a large cover, so the 512px thumbnail is the right
    // trade-off here — still a fraction of the original's weight.
    const coverUrl = getCoverImageUrl(manga, 512);
    const coverClass = coverAspect === 'tall' ? 'details-cover tall' : coverAspect === 'wide' ? 'details-cover wide' : 'details-cover';
    const availableLanguages = attr.availableTranslatedLanguages || [];


    return (
        <div id="manga-details-view" className="view active">
            <div className="container">
                <button id="back-to-gallery" className="back-btn" onClick={() => navigate('/')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"></path>
                    </svg>
                    Back to Gallery
                </button>

                <h3 id="manga-details-title">{title}</h3>

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

                <div className="manga-details-content">
                    <div className="manga-cover-section">
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
                        <div className="manga-meta">
                            <div className="meta-item"><strong>Status:</strong> <span>{attr.status || 'Unknown'}</span></div>
                            <div className="meta-item"><strong>Year:</strong> <span>{attr.year || 'Unknown'}</span></div>
                            <div className="meta-item"><strong>Author:</strong> <span>{authorRel?.attributes?.name || 'Unknown'}</span></div>
                            <div className="meta-item"><strong>Artist:</strong> <span>{artistRel?.attributes?.name || 'Unknown'}</span></div>
                            <div className="meta-item"><strong>Genres:</strong> <span>{genres || 'Unknown'}</span></div>
                        </div>
                    </div>

                    <div className="manga-info-section">
                        <div className="manga-alternative-titles">
                            <h3>Alternative Titles</h3>
                            <div id="manga-alt-titles">{getAltTitles(attr) || 'No alternative titles'}</div>
                        </div>

                        <div className="manga-description">
                            <h3>Description</h3>
                            <div id="manga-full-description">{getDescription(attr) || 'No description available'}</div>
                        </div>

                        <div className="manga-chapters">
                            <div className="chapters-header">
                                <h3>Chapters</h3>
                                <div className="chapter-view-toggle" role="tablist" aria-label="Chapter view">
                                    <button
                                        type="button"
                                        className={chapterView === 'list' ? 'active' : ''}
                                        onClick={() => setChapterView('list')}
                                    >
                                        List
                                    </button>
                                    <button
                                        type="button"
                                        className={chapterView === 'volumes' ? 'active' : ''}
                                        onClick={() => setChapterView('volumes')}
                                    >
                                        By Volume
                                    </button>
                                </div>
                                {availableLanguages.length > 1 && (
                                    <div className="chapter-lang-filter">
                                        <label htmlFor="chapter-lang-select">Language</label>
                                        <select
                                            id="chapter-lang-select"
                                            value={chapterLanguage}
                                            onChange={(e) => setChapterLanguage(e.target.value)}
                                        >
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
                                        <div className="error">No chapters available{chapterLanguage ? ' in this language' : ''}</div>
                                    ) : (
                                        <>
                                            <div className="chapter-list-header">{totalChapters || chapters.length} Chapters Available</div>
                                            {chapterRows.map(({ id, idx, titleText, metaText }) => (
                                                <div key={id} className="chapter-item" onClick={() => navigate(`/manga/${manga.id}/chapter/${id}`, { state: { chapterIndex: idx } })}>
                                                    <span className="chapter-title">{titleText}</span>
                                                    <span className="chapter-meta">{metaText}</span>
                                                </div>
                                            ))}
                                            {totalChapters > chapters.length && (
                                                <button className="load-more-chapters" disabled={loadingMore} onClick={loadMoreChapters}>
                                                    {loadingMore ? 'Loading...' : 'Load More Chapters'}
                                                </button>
                                            )}
                                        </>
                                    )
                                ) : volumesLoading ? (
                                    Array.from({ length: 4 }).map((_, i) => <ChapterItemSkeleton key={i} />)
                                ) : volumesError ? (
                                    <div className="error">{volumesError}</div>
                                ) : volumes.length === 0 ? (
                                    <div className="error">No volume data available{chapterLanguage ? ' in this language' : ''}</div>
                                ) : (
                                    <div className="volume-accordion">
                                        {volumes.map((vol) => {
                                            const key = vol.volume ?? 'none';
                                            const isOpen = expandedVolumes.has(vol.volume);
                                            return (
                                                <div key={key} className={`volume-group${isOpen ? ' open' : ''}`}>
                                                    <button type="button" className="volume-group-header" onClick={() => toggleVolume(vol.volume)}>
                                                        <svg className="volume-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                                                        <span>{vol.volume ? `Volume ${vol.volume}` : 'No Volume'}</span>
                                                        <span className="volume-count">{vol.chapters.length} ch.</span>
                                                    </button>
                                                    {isOpen && (
                                                        <div className="volume-chapter-grid">
                                                            {vol.chapters.map((c) => (
                                                                <button
                                                                    type="button"
                                                                    key={c.id}
                                                                    className="volume-chapter-chip"
                                                                    title={c.count > 1 ? `${c.count} translations` : undefined}
                                                                    onClick={() => navigate(`/manga/${manga.id}/chapter/${c.id}`)}
                                                                >
                                                                    {c.chapter ? `Ch. ${c.chapter}` : 'Oneshot'}
                                                                    {c.count > 1 && <span className="volume-chapter-chip-count">{c.count}</span>}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
