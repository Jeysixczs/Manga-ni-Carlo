import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMainTitle, getAltTitles, getDescription, getCoverImageUrl } from '../api.js';
import { createFallbackSVG } from '../utils.js';

// The grid renders covers at roughly 200px wide, so request the 256px
// thumbnail MangaDex already generates rather than the full-resolution
// original (often 1-2 MB each, times ten cards per page).
const COVER_SIZE = 256;

function formatCount(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function MangaCard({ manga, stats }) {
    const navigate = useNavigate();
    const attr = manga.attributes || {};
    const title = getMainTitle(attr);
    const altTitles = getAltTitles(attr);
    const desc = getDescription(attr);
    const shortDesc = desc.length > 180 ? `${desc.substring(0, 180)}...` : desc || 'No description available.';
    const [imgSrc, setImgSrc] = useState(() => getCoverImageUrl(manga, COVER_SIZE) || createFallbackSVG('No Cover Available'));
    const [loaded, setLoaded] = useState(false);

    if (!manga?.id) return null;

    return (
        <div className="manga-card" onClick={() => navigate(`/manga/${manga.id}`)}>
            <div className="manga-cover-wrap">
                <img
                    className={`manga-cover${loaded ? ' is-loaded' : ''}`}
                    alt={title}
                    src={imgSrc}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setLoaded(true)}
                    onError={() => { setImgSrc(createFallbackSVG('No Cover Available')); setLoaded(true); }}
                />
            </div>
            {(stats?.rating != null || stats?.follows != null) && (
                <div className="manga-stats-badge">
                    {stats.rating != null && (
                        <span className="stat-rating" title="Bayesian rating">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8L6 21l1.6-7L2.2 9.2l7.1-.6z" /></svg>
                            {stats.rating.toFixed(1)}
                        </span>
                    )}
                    {stats.follows != null && (
                        <span className="stat-follows" title="Follows">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            {formatCount(stats.follows)}
                        </span>
                    )}
                </div>
            )}
            <div className="manga-info">
                <div className="manga-title">{title}</div>
                {altTitles && <div className="manga-alt">{altTitles}</div>}
                <div className="manga-desc">{shortDesc}</div>
            </div>
        </div>
    );
}

// Cards are pure functions of their manga object (and now their stats
// object), so skip re-rendering the whole grid when only the parent's
// loading/search state changed. Stats arrive slightly after the grid itself
// (see the batched follow-up fetch in GalleryPage), so they need to be part
// of the comparison too, or a card would never pick up its badge.
export default React.memo(MangaCard, (prev, next) => prev.manga === next.manga && prev.stats === next.stats);
