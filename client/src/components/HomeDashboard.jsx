import React, { useEffect, useRef, useState } from 'react';
import MangaCard from './MangaCard.jsx';
import { MangaCardSkeleton } from './Skeleton.jsx';
import {
    fetchMangaSection,
    fetchSeasonalPicks,
    fetchLatestChapters,
    fetchRandomManga,
    fetchGroups,
    fetchTags,
    fetchBatchStatistics,
    getMainTitle,
    getCoverImageUrl,
    isAbortError,
} from '../api.js';
import { mangaUrl, readUrl } from '../routes.js';
import { timeAgo } from '../utils.js';
import { SEASON } from '../navLinks.js';

/**
 * Runs `fetcher` once, the first time the section scrolls near the viewport.
 * A dashboard of six sections would otherwise fire six requests at once on
 * load; this keeps the first paint cheap and respects MangaDex's rate limit.
 */
function useLazyData(fetcher, { eager = false } = {}) {
    const ref = useRef(null);
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const [visible, setVisible] = useState(eager);

    useEffect(() => {
        if (visible || !ref.current) return undefined;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
        }, { rootMargin: '500px 0px' });
        io.observe(ref.current);
        return () => io.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible) return undefined;
        const controller = new AbortController();
        fetcher(controller.signal)
            .then((data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); })
            .catch((err) => { if (!isAbortError(err)) setState({ data: null, error: err.message || 'Failed to load', loading: false }); });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    return { ref, ...state };
}

function SectionHead({ title, href, hint }) {
    return (
        <div className="dash-head">
            <div>
                <h2 className="dash-title">{title}</h2>
                {hint && <p className="dash-hint">{hint}</p>}
            </div>
            {href && <a className="dash-more" href={href}>View all <span aria-hidden="true">→</span></a>}
        </div>
    );
}

function SectionError({ message }) {
    return <div className="dash-error">{message}</div>;
}

// ---- Horizontal rail of manga cards (GET /manga with a given order) ----
function Rail({ title, hint, href, fetcher }) {
    const { ref, data, error, loading } = useLazyData(fetcher);
    const [stats, setStats] = useState({});

    useEffect(() => {
        if (!data?.length) return undefined;
        const controller = new AbortController();
        fetchBatchStatistics(data.map((m) => m.id), controller.signal)
            .then((s) => { if (!controller.signal.aborted) setStats(s); })
            .catch(() => {});
        return () => controller.abort();
    }, [data]);

    return (
        <section className="dash-section" ref={ref}>
            <SectionHead title={title} hint={hint} href={href} />
            {error ? <SectionError message={error} /> : (
                <div className="rail">
                    {loading
                        ? Array.from({ length: 6 }, (_, i) => <MangaCardSkeleton key={i} />)
                        : data.map((m) => <MangaCard key={m.id} manga={m} stats={stats[m.id]} />)}
                </div>
            )}
        </section>
    );
}

// ---- Latest chapter feed (GET /chapter + GET /manga?ids[]) ----
function LatestUpdates() {
    const { ref, data, error, loading } = useLazyData((signal) => fetchLatestChapters({ limit: 12, signal }), { eager: true });
    return (
        <section className="dash-section" ref={ref}>
            <SectionHead title="Latest updates" hint="Fresh English chapters, newest first" href="/?tab=recent-updates" />
            {error ? <SectionError message={error} /> : (
                <div className="latest-grid">
                    {loading
                        ? Array.from({ length: 6 }, (_, i) => <div key={i} className="latest-row skeleton" style={{ height: 76 }} />)
                        : data.map((r) => {
                            const cover = getCoverImageUrl(r.manga, 256);
                            return (
                                <a key={r.chapterId} className="latest-row" href={readUrl(r.mangaId, r.chapterId)}>
                                    {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <span className="latest-noimg" />}
                                    <span className="latest-text">
                                        <span className="latest-title">{getMainTitle(r.manga.attributes)}</span>
                                        <span className="latest-meta">
                                            <b>{r.label}</b>
                                            {r.group && <span>{r.group}</span>}
                                            <span>{timeAgo(r.publishAt)}</span>
                                        </span>
                                    </span>
                                </a>
                            );
                        })}
                </div>
            )}
        </section>
    );
}

// ---- Genre chips (GET /manga/tag) + Surprise me (GET /manga/random) ----
function GenreStrip() {
    const [tags, setTags] = useState([]);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchTags().then((t) => { if (!cancelled) setTags(t); }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    async function surprise() {
        if (busy) return;
        setBusy(true);
        setFailed(false);
        try {
            const m = await fetchRandomManga();
            window.location.href = mangaUrl(m.id);
        } catch {
            setFailed(true);
            setBusy(false);
        }
    }

    return (
        <section className="dash-section genre-strip">
            <div className="genre-chips" role="list" aria-label="Browse by genre">
                {tags.map((t) => (
                    <a key={t.id} role="listitem" className="genre-chip" href={`/?genre=${encodeURIComponent(t.id)}&label=${encodeURIComponent(t.name)}`}>{t.name}</a>
                ))}
                {!tags.length && Array.from({ length: 10 }, (_, i) => <span key={i} className="genre-chip skeleton" style={{ width: 70, height: 34 }} />)}
            </div>
            <button type="button" className="surprise-btn" onClick={surprise} disabled={busy}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
                {busy ? 'Finding…' : failed ? 'Try again' : 'Surprise me'}
            </button>
        </section>
    );
}

// ---- Top scanlation groups (GET /group) ----
function GroupsStrip() {
    const { ref, data, error, loading } = useLazyData((signal) => fetchGroups({ limit: 10, signal }));
    if (error) return null;
    return (
        <section className="dash-section groups-side" ref={ref}>
            <SectionHead title="Top scanlation groups" hint="The teams translating your favourites" />
            <div className="group-list">
                {loading
                    ? Array.from({ length: 6 }, (_, i) => <span key={i} className="group-chip skeleton" style={{ width: 120, height: 40 }} />)
                    : data.map((g) => (
                        <a key={g.id} className="group-chip" href={`https://mangadex.org/group/${g.id}`} target="_blank" rel="noopener noreferrer">
                            <span className="group-dot" aria-hidden="true">{g.name.charAt(0).toUpperCase()}</span>
                            {g.name}
                        </a>
                    ))}
            </div>
        </section>
    );
}

const thirtyDaysAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19);

export default function HomeDashboard() {
    return (
        <div className="dashboard">
            <GenreStrip />
            <div className="season-band">
                <Rail
                    title={`${SEASON.name} ${SEASON.year} picks`}
                    hint={`Most-followed series added since the ${SEASON.name.toLowerCase()} season began`}
                    href="/?tab=season"
                    fetcher={(signal) => fetchSeasonalPicks({ since: SEASON.since, prevSince: SEASON.prevSince, signal })}
                />
            </div>
            <div className="dash-split">
                <LatestUpdates />
                <GroupsStrip />
            </div>
            <Rail
                title="Popular new titles"
                hint="Most followed among series added this month"
                href="/?tab=popular"
                fetcher={(signal) => fetchMangaSection({ order: 'followedCount', createdAtSince: thirtyDaysAgo(), signal })}
            />
            <Rail
                title="Top rated"
                hint="Highest community ratings"
                href="/?tab=popular"
                fetcher={(signal) => fetchMangaSection({ order: 'rating', signal })}
            />
            <Rail
                title="Recently added"
                hint="Just landed on the site"
                href="/?tab=new-releases"
                fetcher={(signal) => fetchMangaSection({ order: 'createdAt', signal })}
            />
        </div>
    );
}
