import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMainTitle, getAltTitles, getDescription, getCoverImageUrl } from '../api.js';
import { createFallbackSVG } from '../utils.js';

// The grid renders covers at roughly 200px wide, so request the 256px
// thumbnail MangaDex already generates rather than the full-resolution
// original (often 1-2 MB each, times ten cards per page).
const COVER_SIZE = 256;

function MangaCard({ manga }) {
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
            <img
                className="manga-cover"
                alt={title}
                src={imgSrc}
                loading="lazy"
                decoding="async"
                style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease', backgroundColor: '#333' }}
                onLoad={() => setLoaded(true)}
                onError={() => { setImgSrc(createFallbackSVG('No Cover Available')); setLoaded(true); }}
            />
            <div className="manga-info">
                <div className="manga-title">{title}</div>
                {altTitles && <div className="manga-alt">{altTitles}</div>}
                <div className="manga-desc">{shortDesc}</div>
            </div>
        </div>
    );
}

// Cards are pure functions of their manga object, so skip re-rendering the
// whole grid when only the parent's loading/search state changed.
export default React.memo(MangaCard, (prev, next) => prev.manga === next.manga);
