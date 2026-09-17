import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSearchSuggestions, fetchTags, isAbortError } from '../api.js';
import { createFallbackSVG } from '../utils.js';

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1950 + 1 }, (_, i) => currentYear - i);

export default function SearchAndFilters({
    query,
    onQueryChange,
    onSearch,
    onClear,
    filters,
    onApplyFilters,
    onResetFilters,
    resultsInfo,
}) {
    const [inputValue, setInputValue] = useState(query);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [localFilters, setLocalFilters] = useState(filters);
    const [genreOptions, setGenreOptions] = useState([]);
    const debounceRef = useRef(null);
    const suggestAbortRef = useRef(null);
    const wrapRef = useRef(null);

    useEffect(() => setInputValue(query), [query]);
    useEffect(() => setLocalFilters(filters), [filters]);

    // Genre chips are only fetched once the panel is opened for the first
    // time — most visits never touch filters at all.
    useEffect(() => {
        if (!showFilters || genreOptions.length) return;
        let cancelled = false;
        fetchTags().then((tags) => { if (!cancelled) setGenreOptions(tags); }).catch(() => {});
        return () => { cancelled = true; };
    }, [showFilters, genreOptions.length]);

    function toggleGenre(tagId) {
        setLocalFilters((f) => {
            const current = f.genres || [];
            const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
            return { ...f, genres: next };
        });
    }

    useEffect(() => {
        function handleClickOutside(e) {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowSuggestions(false);
        }
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    // The debounce timer and the suggestion request both outlived this component.
    // If the user typed and then navigated away, the timer still fired, the fetch
    // still ran to completion, and its setState kept the whole unmounted subtree
    // reachable. Both are torn down here.
    useEffect(() => () => {
        clearTimeout(debounceRef.current);
        suggestAbortRef.current?.abort();
    }, []);

    function handleInput(e) {
        const val = e.target.value;
        setInputValue(val);
        onQueryChange(val);
        clearTimeout(debounceRef.current);
        // Cancel the previous keystroke's request. Without this, a slow early
        // request could resolve after a fast later one and overwrite fresher
        // suggestions with stale ones.
        suggestAbortRef.current?.abort();
        if (val.trim().length < 2) {
            setShowSuggestions(false);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            const controller = new AbortController();
            suggestAbortRef.current = controller;
            try {
                const s = await fetchSearchSuggestions(val.trim(), controller.signal);
                if (controller.signal.aborted) return;
                setSuggestions(s);
                setShowSuggestions(s.length > 0);
            } catch (err) {
                if (!isAbortError(err)) setShowSuggestions(false);
            }
        }, 300);
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            setShowSuggestions(false);
            onSearch(inputValue.trim());
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    }

    function pickSuggestion(s) {
        setInputValue(s.title);
        onQueryChange(s.title);
        setShowSuggestions(false);
        onSearch(s.title);
    }

    const filtersActive = useMemo(() => Object.entries(localFilters).some(([k, v]) => {
        if (k === 'contentRating') return v && v !== 'safe,suggestive,erotica';
        if (k === 'sortBy') return v && v !== 'latestUploadedChapter';
        if (k === 'genres') return Array.isArray(v) && v.length > 0;
        return Boolean(v);
    }), [localFilters]);

    return (
        <div className="search-section">
            <div className="search-container" ref={wrapRef}>
                <div className="search-input-wrapper">
                    <input
                        type="text"
                        id="search-input"
                        placeholder="Search manga by title, author, or artist..."
                        autoComplete="off"
                        value={inputValue}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                    />
                    <button className="search-button" onClick={() => { setShowSuggestions(false); onSearch(inputValue.trim()); }} aria-label="Search">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="M21 21L16.65 16.65"></path>
                        </svg>
                    </button>
                    {(inputValue || query) && (
                        <button className="clear-search-button" onClick={() => { setInputValue(''); onClear(); }} aria-label="Clear search">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    )}
                </div>

                {showSuggestions && (
                    <div id="search-suggestions" className="search-suggestions" style={{ display: 'block' }}>
                        {suggestions.map((s) => (
                            <div key={s.id} className="suggestion-item" onClick={() => pickSuggestion(s)}>
                                <img
                                    className="suggestion-cover"
                                    src={s.coverUrl || createFallbackSVG('No Cover', 32, 32)}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => { e.target.src = createFallbackSVG('No Cover', 32, 32); }}
                                />
                                <span className="suggestion-text">{s.title}</span>
                                <span className="suggestion-meta">{s.author}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="filters-container">
                <button className={`filter-toggle-btn${filtersActive ? ' active' : ''}`} onClick={() => setShowFilters((v) => !v)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"></polygon>
                    </svg>
                    Filters
                </button>

                {showFilters && (
                    <div id="advanced-filters" className="advanced-filters" style={{ display: 'block' }}>
                        <div className="filter-group">
                            <label htmlFor="status-filter">Status:</label>
                            <select id="status-filter" value={localFilters.status} onChange={(e) => setLocalFilters((f) => ({ ...f, status: e.target.value }))}>
                                <option value="">All Status</option>
                                <option value="ongoing">Ongoing</option>
                                <option value="completed">Completed</option>
                                <option value="hiatus">Hiatus</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </div>

                        <div className="filter-group">
                            <label htmlFor="year-filter">Year:</label>
                            <select id="year-filter" value={localFilters.year} onChange={(e) => setLocalFilters((f) => ({ ...f, year: e.target.value }))}>
                                <option value="">All Years</option>
                                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>

                        <div className="filter-group">
                            <label htmlFor="rating-filter">Content Rating:</label>
                            <select id="rating-filter" value={localFilters.contentRating} onChange={(e) => setLocalFilters((f) => ({ ...f, contentRating: e.target.value }))}>
                                <option value="safe,suggestive,erotica">All Ratings</option>
                                <option value="safe">Safe</option>
                                <option value="suggestive">Suggestive</option>
                                <option value="erotica">Erotica</option>
                            </select>
                        </div>

                        <div className="filter-group">
                            <label htmlFor="sort-filter">Sort By:</label>
                            <select id="sort-filter" value={localFilters.sortBy} onChange={(e) => setLocalFilters((f) => ({ ...f, sortBy: e.target.value }))}>
                                <option value="latestUploadedChapter">Latest Chapter</option>
                                <option value="title">Title</option>
                                <option value="year">Year</option>
                                <option value="createdAt">Created Date</option>
                                <option value="updatedAt">Updated Date</option>
                                <option value="followedCount">Most Followed</option>
                                <option value="relevance">Relevance</option>
                            </select>
                        </div>

                        <div className="filter-group filter-group-genres">
                            <label>Genres:</label>
                            <div className="genre-chip-row">
                                {genreOptions.length === 0 ? (
                                    <span className="genre-chip-loading">Loading genres…</span>
                                ) : (
                                    genreOptions.map((g) => (
                                        <button
                                            type="button"
                                            key={g.id}
                                            className={`genre-chip${(localFilters.genres || []).includes(g.id) ? ' selected' : ''}`}
                                            onClick={() => toggleGenre(g.id)}
                                        >
                                            {g.name}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <button className="apply-filters-btn" onClick={() => onApplyFilters(localFilters)}>Apply Filters</button>
                        <button
                            className="reset-filters-btn"
                            onClick={() => {
                                const reset = { status: '', year: '', contentRating: 'safe,suggestive,erotica', sortBy: 'latestUploadedChapter', genres: [] };
                                setLocalFilters(reset);
                                onResetFilters(reset);
                            }}
                        >
                            Reset
                        </button>
                    </div>
                )}
            </div>

            {resultsInfo && (
                <div id="search-results-info" className="search-results-info" style={{ display: 'flex' }}>
                    <span className="search-results-text" style={{ marginRight: 10 }}>{resultsInfo}</span>
                    <button className="clear-results-btn" onClick={onClear}>Clear Search</button>
                </div>
            )}
        </div>
    );
}
