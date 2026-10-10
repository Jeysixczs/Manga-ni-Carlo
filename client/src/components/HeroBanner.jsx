import React, { useCallback, useEffect, useRef, useState } from 'react';
import { mangaUrl } from '../routes.js';
import { cleanDescription } from '../utils.js';
import { fetchMangaList, getMainTitle, getDescription, getCoverImageUrl, isAbortError } from '../api.js';

const TOP_COUNT = 10;
const AUTOPLAY_MS = 7000;

export default function HeroBanner() {
    const [items, setItems] = useState([]);
    const [index, setIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [paused, setPaused] = useState(false);
    const touchX = useRef(null);

    useEffect(() => {
        const controller = new AbortController();
        fetchMangaList({ page: 1, limit: TOP_COUNT, order: 'followedCount', signal: controller.signal })
            .then(({ data }) => { setItems(data.slice(0, TOP_COUNT)); setLoading(false); })
            .catch((err) => { if (!isAbortError(err)) setLoading(false); });
        return () => controller.abort();
    }, []);

    const go = useCallback((i) => {
        setIndex((cur) => {
            const n = items.length || 1;
            return ((typeof i === 'function' ? i(cur) : i) % n + n) % n;
        });
    }, [items.length]);

    useEffect(() => {
        if (paused || items.length < 2) return undefined;
        const id = setInterval(() => go((c) => c + 1), AUTOPLAY_MS);
        return () => clearInterval(id);
    }, [paused, items.length, go, index]);

    if (loading) return <div className="hero hero-loading" aria-hidden="true"><div className="hero-skel" /></div>;
    // If the list can't load, skip the hero rather than show a broken block.
    if (!items.length) return null;

    const manga = items[index];
    const attr = manga.attributes || {};
    const title = getMainTitle(attr);
    const desc = cleanDescription(getDescription(attr)) || 'No description available.';
    const bg = getCoverImageUrl(manga, 512);

    return (
        <section
            className="hero"
            aria-roledescription="carousel"
            aria-label="Top 10 manga"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
                if (touchX.current == null) return;
                const dx = e.changedTouches[0].clientX - touchX.current;
                touchX.current = null;
                if (Math.abs(dx) > 50) go((c) => c + (dx < 0 ? 1 : -1));
            }}
        >
            {bg && <img key={`bg-${manga.id}`} className="hero-bg" src={bg} alt="" decoding="async" />}
            <div className="hero-scrim" aria-hidden="true" />

            <div key={`copy-${manga.id}`} className="hero-content" aria-live="polite">
                <span className="hero-rank-badge">#{index + 1}</span>
                <h1 className="hero-title">{title}</h1>
                <p className="hero-desc">{desc}</p>
                <div className="hero-actions">
                    <a className="hero-btn hero-btn-primary" href={mangaUrl(manga.id)}>
                        Read details
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                    </a>
                </div>
            </div>

            <div className="hero-controls">
                <button type="button" className="hero-arrow" aria-label="Previous" onClick={() => go((c) => c - 1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
                </button>
                <div className="hero-dots" role="tablist" aria-label="Choose title">
                    {items.map((m, i) => (
                        <button
                            key={m.id}
                            type="button"
                            role="tab"
                            aria-selected={i === index}
                            aria-label={`${i + 1}: ${getMainTitle(m.attributes)}`}
                            className={`hero-dot${i === index ? ' active' : ''}`}
                            onClick={() => go(i)}
                        />
                    ))}
                </div>
                <button type="button" className="hero-arrow" aria-label="Next" onClick={() => go((c) => c + 1)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
                </button>
            </div>
        </section>
    );
}
