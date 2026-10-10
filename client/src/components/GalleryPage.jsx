import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '../useUrlParams.js';
import { NAV_TABS as TABS, SEASON } from '../navLinks.js';
import MangaCard from './MangaCard.jsx';
import { MangaCardSkeleton } from './Skeleton.jsx';
import SearchAndFilters from './SearchAndFilters.jsx';
import HeroBanner from './HeroBanner.jsx';
import HomeDashboard from './HomeDashboard.jsx';
import { LIMIT, maxReachablePage, fetchMangaList, searchManga, fetchBatchStatistics, fetchAuthors, fetchGroups, isAbortError } from '../api.js';

const TAB_ORDER = { popular: 'followedCount', 'recent-updates': 'latestUploadedChapter', 'new-releases': 'createdAt', season: 'followedCount' };
const DEFAULT_FILTERS = { status: '', year: '', contentRating: 'safe,suggestive,erotica', sortBy: 'latestUploadedChapter', genres: [] };

export default function GalleryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get('tab') || 'featured';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const urlQuery = searchParams.get('q') || '';
    // Deep links from the dashboard: /?genre=<tagId>&label=Action and /?author=<id>&label=Name
    const urlGenre = searchParams.get('genre') || '';
    const urlAuthor = searchParams.get('author') || '';
    const scopeLabel = searchParams.get('label') || '';
    const urlScoped = Boolean(urlGenre || urlAuthor);

    const [query, setQuery] = useState(urlQuery);
    const [isSearchMode, setIsSearchMode] = useState(Boolean(urlQuery) || urlScoped);
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [mangaList, setMangaList] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [resultsInfo, setResultsInfo] = useState(null);
    const [statsById, setStatsById] = useState({});
    const [matches, setMatches] = useState({ authors: [], groups: [] });

    // URL scope (genre / author) layered over the filter panel's own state.
    const activeFilters = useMemo(() => ({
        ...filters,
        genres: urlGenre ? [urlGenre] : filters.genres,
        authors: urlAuthor ? [urlAuthor] : [],
    }), [filters, urlGenre, urlAuthor]);

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
            if (tab === 'featured' && !isSearchMode) {
                // The dashboard owns this view and loads its own sections.
                setMangaList([]);
                setTotal(0);
                setResultsInfo(null);
            } else if (isSearchMode && (urlQuery || hasActiveFilters(activeFilters))) {
                const hasFilters = hasActiveFilters(activeFilters);
                const { data, total: t } = await searchManga({ query: urlQuery, page, filters: activeFilters, signal });
                setMangaList(data);
                setTotal(t);
                if (scopeLabel && !urlQuery) setResultsInfo(`${t.toLocaleString()} titles in ${scopeLabel}`);
                else if (urlQuery && hasFilters) setResultsInfo(`Found ${t} results for "${urlQuery}" with filters`);
                else if (urlQuery) setResultsInfo(`Found ${t} results for "${urlQuery}"`);
                else if (hasFilters) setResultsInfo(`Found ${t} results with filters`);
                else setResultsInfo(null);
            } else {
                const { data, total: t } = await fetchMangaList({ page, order: TAB_ORDER[tab], createdAtSince: tab === 'season' ? SEASON.since : undefined, signal });
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
    }, [tab, page, isSearchMode, urlQuery, activeFilters, scopeLabel]);

    // Every tab switch / page change cancels the request it supersedes. Clicking
    // "Next" three times used to leave three requests racing, and whichever
    // landed last won — often not the page actually selected.
    useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        return () => controller.abort();
    }, [load]);

    // Rating/follows badges are non-essential polish, so they're fetched as a
    // single batched follow-up request after the grid itself has rendered —
    // never something the grid's own loading state waits on.
    useEffect(() => {
        if (!mangaList.length) { setStatsById({}); return; }
        const controller = new AbortController();
        setStatsById({});
        fetchBatchStatistics(mangaList.map((m) => m.id), controller.signal)
            .then((stats) => { if (!controller.signal.aborted) setStatsById(stats); })
            .catch(() => {});
        return () => controller.abort();
    }, [mangaList]);

    useEffect(() => {
        setQuery(urlQuery);
        setIsSearchMode(Boolean(urlQuery) || urlScoped || hasActiveFilters(filters));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlQuery, urlGenre, urlAuthor]);

    // Creator and scanlation-group matches for a text search
    // (GET /author?name= and GET /group?name=), shown above the results.
    useEffect(() => {
        if (!urlQuery || urlQuery.length < 2) { setMatches({ authors: [], groups: [] }); return undefined; }
        const controller = new AbortController();
        Promise.all([
            fetchAuthors({ name: urlQuery, signal: controller.signal }).catch(() => []),
            fetchGroups({ name: urlQuery, limit: 4, signal: controller.signal }).catch(() => []),
        ]).then(([authors, groups]) => { if (!controller.signal.aborted) setMatches({ authors, groups }); });
        return () => controller.abort();
    }, [urlQuery]);

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
        setParam({ tab: 'featured', page: 1, q: null, genre: null, author: null, label: null });
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

    // Not just ceil(total / LIMIT): a 90.000-result set is real, but only the
    // first 10.000 of it is addressable, so anything past that is a button
    // that can only ever produce an error.
    const maxPages = maxReachablePage(total, LIMIT);
    const activeTabInfo = useMemo(() => TABS.find((t) => t.key === tab) || TABS[0], [tab]);
    const heading = scopeLabel && !urlQuery ? scopeLabel : isSearchMode ? 'Search Results' : activeTabInfo.heading;

    const showDashboard = !isSearchMode && tab === 'featured';

    return (
        <div id="gallery-view" className="view active">
            {showDashboard && <HeroBanner />}

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

            {showDashboard ? <HomeDashboard /> : (
                <>
                    {(matches.authors.length > 0 || matches.groups.length > 0) && (
                        <div className="match-strip">
                            {matches.authors.length > 0 && (
                                <div className="match-row">
                                    <span className="match-label">Creators</span>
                                    {matches.authors.map((a) => (
                                        <a key={a.id} className="genre-chip" href={`/?author=${encodeURIComponent(a.id)}&label=${encodeURIComponent(a.name)}`}>{a.name}</a>
                                    ))}
                                </div>
                            )}
                            {matches.groups.length > 0 && (
                                <div className="match-row">
                                    <span className="match-label">Groups</span>
                                    {matches.groups.map((g) => (
                                        <a key={g.id} className="genre-chip" href={`https://mangadex.org/group/${g.id}`} target="_blank" rel="noopener noreferrer">{g.name}</a>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="section-header">
                        <h2 className="section-title gradient-text">{heading}</h2>
                        {!loading && !error && mangaList.length > 0 && <span className="section-meta">Page {page}</span>}
                    </div>

                    <div id="manga-list" className="manga-grid">
                        {loading && SKELETONS}
                        {!loading && error && (
                            <div className="error full-span">
                                <h3>Loading failed</h3>
                                <p>{error}</p>
                                <button className="error-action" onClick={() => location.reload()}>Reload page</button>
                            </div>
                        )}
                        {!loading && !error && mangaList.length === 0 && (
                            <div className="error full-span">
                                <h3>No manga found</h3>
                                <p>Try adjusting your search terms or filters.</p>
                            </div>
                        )}
                        {!loading && !error && mangaList.map((manga) => <MangaCard key={manga.id} manga={manga} stats={statsById[manga.id]} />)}
                    </div>

                    <div className="pagination-controls">
                        <button disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>Previous</button>
                        <button disabled={page >= maxPages || loading} onClick={() => goToPage(page + 1)}>Next</button>
                    </div>
                </>
            )}
        </div>
    );
}

// Skeletons are static markup — building ten fresh elements on every loading
// render was pure churn.
const SKELETONS = Array.from({ length: LIMIT }, (_, i) => <MangaCardSkeleton key={i} />);

function hasActiveFilters(filters) {
    return Boolean(filters.status) || Boolean(filters.year) || Boolean(filters.authors?.length) || filters.contentRating !== DEFAULT_FILTERS.contentRating
        || filters.sortBy !== DEFAULT_FILTERS.sortBy || Boolean(filters.genres?.length);
}
