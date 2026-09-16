import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import MangaCard from './MangaCard.jsx';
import { MangaCardSkeleton } from './Skeleton.jsx';
import SearchAndFilters from './SearchAndFilters.jsx';
import { LIMIT, fetchMangaList, fetchRandomMangaList, fetchMangaCount, searchManga, isAbortError } from '../api.js';

const TABS = [
    { key: 'featured', label: 'Explore', heading: 'Explore Manga' },
    { key: 'popular', label: 'Popular', heading: 'Popular Manga' },
    { key: 'recent-updates', label: 'Recent Updates', heading: 'Recent Updates' },
    { key: 'new-releases', label: 'New Releases', heading: 'New Releases' },
];

const TAB_ORDER = { popular: 'followedCount', 'recent-updates': 'latestUploadedChapter', 'new-releases': 'createdAt' };
const DEFAULT_FILTERS = { status: '', year: '', contentRating: 'safe,suggestive,erotica', sortBy: 'latestUploadedChapter' };

export default function GalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get('tab') || 'featured';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const urlQuery = searchParams.get('q') || '';

    const [query, setQuery] = useState(urlQuery);
    const [isSearchMode, setIsSearchMode] = useState(Boolean(urlQuery));
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [mangaList, setMangaList] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [resultsInfo, setResultsInfo] = useState(null);

    const randomOffsetRef = useRef(0);
    const featuredTotalRef = useRef(null);

    const setParam = useCallback((updates) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([k, v]) => {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, v);
        });
        setSearchParams(next);
    }, [searchParams, setSearchParams]);

    const load = useCallback(async (signal) => {
        setLoading(true);
        setError(null);
        try {
            if (isSearchMode && (urlQuery || hasActiveFilters(filters))) {
                const hasFilters = hasActiveFilters(filters);
                const { data, total: t } = await searchManga({ query: urlQuery, page, filters, signal });
                setMangaList(data);
                setTotal(t);
                if (urlQuery && hasFilters) setResultsInfo(`Found ${t} results for "${urlQuery}" with filters`);
                else if (urlQuery) setResultsInfo(`Found ${t} results for "${urlQuery}"`);
                else if (hasFilters) setResultsInfo(`Found ${t} results with filters`);
                else setResultsInfo(null);
            } else if (tab === 'featured') {
                if (featuredTotalRef.current === null) {
                    try {
                        featuredTotalRef.current = await fetchMangaCount(signal);
                    } catch (err) {
                        if (isAbortError(err)) return;
                        featuredTotalRef.current = 5000;
                    }
                }
                if (page === 1) {
                    const maxTotal = featuredTotalRef.current;
                    randomOffsetRef.current = Math.floor(Math.random() * Math.max(1, Math.min(maxTotal, 10000 - 10)));
                }
                const { data, total: t } = await fetchRandomMangaList({ offset: randomOffsetRef.current + (page - 1) * LIMIT, signal });
                setMangaList(data);
                setTotal(t);
                setResultsInfo(null);
            } else {
                const { data, total: t } = await fetchMangaList({ page, order: TAB_ORDER[tab], signal });
                setMangaList(data);
                setTotal(t);
                setResultsInfo(null);
            }
        } catch (err) {
            // An aborted request means the user already moved on; leave the
            // spinner up for whichever request replaced this one.
            if (isAbortError(err)) return;
            setError(err.message || 'Something went wrong');
            setMangaList([]);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [tab, page, isSearchMode, urlQuery, filters]);

    // Every tab switch / page change cancels the request it supersedes. Clicking
    // "Next" three times used to leave three requests racing, and whichever
    // landed last won — often not the page actually selected.
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);

    useEffect(() => {
        setQuery(urlQuery);
        setIsSearchMode(Boolean(urlQuery) || hasActiveFilters(filters));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlQuery]);

    function handleTabChange(newTab) {
        if (loading) return;
        setIsSearchMode(false);
        setQuery('');
        setFilters(DEFAULT_FILTERS);
        setParam({ tab: newTab, page: 1, q: null });
    }

    function handleSearch(q) {
        if (!q && !hasActiveFilters(filters)) {
            handleClearSearch();
            return;
        }
        setIsSearchMode(true);
        setParam({ q: q || null, page: 1 });
    }

    function handleClearSearch() {
        setIsSearchMode(false);
        setQuery('');
        setFilters(DEFAULT_FILTERS);
        setParam({ tab: 'featured', page: 1, q: null });
    }

    function handleApplyFilters(newFilters) {
        setFilters(newFilters);
        setIsSearchMode(true);
        setParam({ page: 1 });
    }

    function handleResetFilters(resetVals) {
        setFilters(resetVals);
        if (!query) {
            setIsSearchMode(false);
            setParam({ page: 1 });
        } else {
            setParam({ page: 1 });
        }
    }

    function goToPage(newPage) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setParam({ page: newPage });
    }

    const maxPages = Math.max(1, Math.ceil(total / LIMIT));
    const activeTabInfo = useMemo(() => TABS.find((t) => t.key === tab) || TABS[0], [tab]);
    const heading = isSearchMode ? 'Search Results' : activeTabInfo.heading;

    return (
        <div id="gallery-view" className="view active">
            <h1>Manhwa ni Carlo</h1>
            <p style={{ textAlign: 'center', margin: 20 }}>This website is for personal use only.</p>

            <div className="nav-tabs">
                {TABS.map((t) => (
                    <div
                        key={t.key}
                        className={`nav-tab${tab === t.key && !isSearchMode ? ' active' : ''}`}
                        onClick={() => handleTabChange(t.key)}
                    >
                        {t.label}
                    </div>
                ))}
            </div>

            <SearchAndFilters
                query={query}
                onQueryChange={setQuery}
                onSearch={handleSearch}
                onClear={handleClearSearch}
                filters={filters}
                onApplyFilters={handleApplyFilters}
                onResetFilters={handleResetFilters}
                resultsInfo={resultsInfo}
            />

            <div className="section-header">
                <h2 className="section-title gradient-text">{heading}</h2>
            </div>

            <div id="manga-list" className="manga-grid">
                {loading && SKELETONS}
                {!loading && error && (
                    <div className="error" style={{ gridColumn: '1 / -1' }}>
                        <h3>Loading Failed</h3>
                        <p>{error}</p>
                        <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#667eea', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Reload Page</button>
                    </div>
                )}
                {!loading && !error && mangaList.length === 0 && (
                    <div className="error" style={{ gridColumn: '1 / -1' }}>
                        <h3>No manga found</h3>
                        <p>Try adjusting your search terms or filters</p>
                    </div>
                )}
                {!loading && !error && mangaList.map((manga) => <MangaCard key={manga.id} manga={manga} />)}
            </div>

            <div className="pagination-controls">
                <button disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>Previous</button>
                <button disabled={page >= maxPages || loading} onClick={() => goToPage(page + 1)}>Next</button>
            </div>
        </div>
    );
}

// Skeletons are static markup — building ten fresh elements on every loading
// render was pure churn.
const SKELETONS = Array.from({ length: LIMIT }, (_, i) => <MangaCardSkeleton key={i} />);

function hasActiveFilters(filters) {
    return Boolean(filters.status) || Boolean(filters.year) || filters.contentRating !== DEFAULT_FILTERS.contentRating || filters.sortBy !== DEFAULT_FILTERS.sortBy;
}
