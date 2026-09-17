// All requests go to our own server (see /server/index.js), which proxies
// MangaDex server-side. No more client-side CORS proxies.

export const LIMIT = 10;
export const CHAPTER_LIMIT = 100;
const DEFAULT_CONTENT_RATING = 'safe,suggestive,erotica';

// MangaDex rejects any collection request where offset + limit > 10.000, and
// caps limit at 100. See https://api.mangadex.org/docs/2-limitations/ —
// they state both are permanent, for performance reasons. The server clamps
// these too (defence in depth), but doing it here as well means the UI never
// offers a page that can't exist in the first place.
export const MAX_COLLECTION_WINDOW = 10_000;
export const MAX_LIMIT = 100;

/** Highest 1-based page number that is actually reachable for a result set. */
export function maxReachablePage(total, limit = LIMIT) {
    const byResults = Math.ceil((total || 0) / limit);
    const byWindow = Math.floor(MAX_COLLECTION_WINDOW / limit);
    return Math.max(1, Math.min(byResults, byWindow));
}

function clampWindow(limit, offset) {
    const l = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
    let o = Math.max(0, Math.floor(offset));
    if (o + l > MAX_COLLECTION_WINDOW) o = MAX_COLLECTION_WINDOW - l;
    return { limit: l, offset: o };
}

async function apiFetch(path, signal) {
    // res.json() parses straight off the stream. The old text() + JSON.parse
    // held the whole payload twice (string + parsed object) at once.
    const res = await fetch(path, { signal });
    let data;
    try {
        data = await res.json();
    } catch {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // The server already retries transient upstream hiccups (see
        // fetchUpstreamJson in server/app.js), so getting here means those
        // retries were exhausted too. Point people at "try again" rather
        // than a dead-end parse error.
        throw new Error('The manga source is temporarily unreachable. Please try again in a moment.');
    }
    if (!res.ok) {
        throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
    }
    return data;
}

/** True for the "the caller cancelled this on purpose" case, which is never a real error. */
export function isAbortError(err) {
    return err?.name === 'AbortError' || err?.name === 'TimeoutError';
}

export function getMainTitle(attr) {
    if (!attr?.title) return 'No Title';
    const t = attr.title;
    return t.en || t['en-us'] || t.romaji || Object.values(t)[0] || 'No Title';
}

export function getAltTitles(attr) {
    return (attr?.altTitles ?? [])
        .map((t) => Object.values(t)[0])
        .filter(Boolean)
        .slice(0, 5)
        .join(' • ');
}

export function getDescription(attr) {
    const d = attr?.description ?? {};
    return d.en || d['en-us'] || Object.values(d)[0] || '';
}

export function getCoverFileName(manga) {
    const coverRel = manga?.relationships?.find((r) => r.type === 'cover_art');
    return coverRel?.attributes?.fileName || null;
}

/**
 * MangaDex serves pre-generated 256px and 512px thumbnails by appending
 * `.256.jpg` / `.512.jpg` to the cover filename. The gallery grid renders
 * covers at ~200px wide, so pulling the full-size original there was moving
 * roughly ten times more bytes than the layout could ever use.
 */
export function getCoverImageUrl(manga, size = null) {
    const fileName = getCoverFileName(manga);
    if (!fileName) return null;
    const suffix = size === 256 || size === 512 ? `.${size}.jpg` : '';
    const directUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}${suffix}`;
    return `/api/image?url=${encodeURIComponent(directUrl)}`;
}

export function getPageImageUrl(baseUrl, chapterHash, fileName, useDataSaver) {
    const part = useDataSaver ? 'data-saver' : 'data';
    const directUrl = `${baseUrl}/${part}/${chapterHash}/${fileName}`;
    return `/api/image?url=${encodeURIComponent(directUrl)}`;
}

function buildParams({ limit = LIMIT, offset = 0, title, filters = {}, order }) {
    const p = new URLSearchParams();
    const bounded = clampWindow(limit, offset);
    p.set('limit', bounded.limit);
    p.set('offset', bounded.offset);
    p.set('hasAvailableChapters', 'true');
    p.append('includes[]', 'cover_art');
    p.append('includes[]', 'author');
    p.append('includes[]', 'artist');
    if (title) p.set('title', title);
    (filters.contentRating || DEFAULT_CONTENT_RATING).split(',').forEach((r) => p.append('contentRating[]', r.trim()));
    if (filters.status) p.append('status[]', filters.status);
    if (filters.year) p.set('year', filters.year);
    if (filters.genres?.length) {
        filters.genres.forEach((tagId) => p.append('includedTags[]', tagId));
        p.set('includedTagsMode', 'AND');
    }
    const sortBy = order || filters.sortBy || 'latestUploadedChapter';
    if (sortBy === 'relevance' && !title) p.set('order[latestUploadedChapter]', 'desc');
    else if (sortBy === 'relevance') p.set('order[relevance]', 'desc');
    else p.set(`order[${sortBy}]`, 'desc');
    return p;
}

export async function fetchMangaList({ page = 1, limit = LIMIT, order, signal } = {}) {
    const offset = (page - 1) * limit;
    const params = buildParams({ limit, offset, order });
    const data = await apiFetch(`/api/manga?${params.toString()}`, signal);
    return { data: data.data || [], total: data.total ?? 0 };
}

export async function fetchRandomMangaList({ offset, limit = LIMIT, signal } = {}) {
    const params = buildParams({ limit, offset });
    const data = await apiFetch(`/api/manga?${params.toString()}`, signal);
    return { data: data.data || [], total: data.total ?? 0 };
}

export async function fetchMangaCount(signal) {
    const params = buildParams({ limit: 1, offset: 0 });
    const data = await apiFetch(`/api/manga?${params.toString()}`, signal);
    return data.total ?? 5000;
}

export async function searchManga({ query, page = 1, limit = LIMIT, filters = {}, signal }) {
    const offset = (page - 1) * limit;
    const params = buildParams({ limit, offset, title: query, filters });
    const data = await apiFetch(`/api/manga?${params.toString()}`, signal);
    return { data: data.data || [], total: data.total ?? 0 };
}

export async function fetchSearchSuggestions(query, signal) {
    if (!query || query.length < 2) return [];
    const params = buildParams({ limit: 5, offset: 0, title: query, order: 'relevance' });
    const data = await apiFetch(`/api/manga?${params.toString()}`, signal);
    return (data.data || []).slice(0, 5).map((manga) => {
        const attr = manga.attributes || {};
        const author = manga.relationships?.find((r) => r.type === 'author')?.attributes?.name || 'Unknown';
        // 64px is plenty for the suggestion row; MangaDex doesn't generate that
        // exact size, so 256px is the smallest pre-generated thumbnail available.
        return { title: getMainTitle(attr), author, id: manga.id, coverUrl: getCoverImageUrl(manga, 256) };
    });
}

export async function fetchMangaDetails(mangaId, signal) {
    const params = new URLSearchParams();
    params.append('includes[]', 'cover_art');
    params.append('includes[]', 'author');
    params.append('includes[]', 'artist');
    const data = await apiFetch(`/api/manga/${mangaId}?${params.toString()}`, signal);
    if (!data?.data) throw new Error('Invalid manga details response');
    return data.data;
}

export async function fetchChapters(mangaId, offset = 0, limit = CHAPTER_LIMIT, language = '', signal) {
    const params = new URLSearchParams({ manga: mangaId, limit, offset });
    params.append('order[chapter]', 'asc');
    ['safe', 'suggestive', 'erotica'].forEach((r) => params.append('contentRating[]', r));
    if (language) params.append('translatedLanguage[]', language);
    const data = await apiFetch(`/api/chapter?${params.toString()}`, signal);
    return { chapters: Array.isArray(data.data) ? data.data : [], total: data.total ?? 0 };
}

// Intl.DisplayNames is expensive to construct and was being rebuilt for every
// row of the language dropdown. Build it once, lazily, and reuse it.
let displayNames;
export function languageLabel(code) {
    if (!code) return 'Unknown';
    try {
        if (!displayNames) displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
        const name = displayNames.of(code);
        return name && name !== code ? name : code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

// ---- Tags (genres/themes/formats) — GET /api/tag -> /manga/tag ----
// The taxonomy is effectively static, so this is fetched once per page load
// and reused everywhere a genre picker is shown.
let tagsPromise = null;
export function fetchTags(signal) {
    if (!tagsPromise) {
        tagsPromise = apiFetch('/api/tag', signal)
            .then((data) => (data.data || [])
                .map((t) => ({
                    id: t.id,
                    name: t.attributes?.name?.en || Object.values(t.attributes?.name || {})[0] || 'Unknown',
                    group: t.attributes?.group || 'other',
                }))
                .filter((t) => t.group === 'genre')
                .sort((a, b) => a.name.localeCompare(b.name)))
            .catch((err) => { tagsPromise = null; throw err; });
    }
    return tagsPromise;
}

function parseStatsEntry(entry) {
    if (!entry) return null;
    const rating = entry.rating?.bayesian ?? entry.rating?.average ?? null;
    return {
        rating: typeof rating === 'number' ? Math.round(rating * 10) / 10 : null,
        follows: typeof entry.follows === 'number' ? entry.follows : null,
    };
}

// ---- Statistics (bayesian rating + follows) ----
export async function fetchMangaStatistics(mangaId, signal) {
    const data = await apiFetch(`/api/statistics/manga/${mangaId}`, signal);
    return parseStatsEntry(data?.statistics?.[mangaId]);
}

/** Batched: one request for a whole grid of cards instead of one per card. */
export async function fetchBatchStatistics(mangaIds, signal) {
    if (!mangaIds?.length) return {};
    const params = new URLSearchParams();
    mangaIds.forEach((id) => params.append('manga[]', id));
    const data = await apiFetch(`/api/statistics/manga?${params.toString()}`, signal);
    const out = {};
    for (const [id, entry] of Object.entries(data?.statistics || {})) {
        out[id] = parseStatsEntry(entry);
    }
    return out;
}

// ---- Aggregate (full volume -> chapter tree in one call) ----
export async function fetchMangaAggregate(mangaId, language, signal) {
    const params = new URLSearchParams();
    if (language) params.append('translatedLanguage[]', language);
    const qs = params.toString();
    const data = await apiFetch(`/api/manga/${mangaId}/aggregate${qs ? `?${qs}` : ''}`, signal);
    const volumesObj = data?.volumes || {};
    // Sort volumes descending (newest first), "none" last; sort chapters
    // within a volume descending too, numeric-aware so "10" sorts before "9".
    const numericDesc = (a, b) => {
        const na = Number(a), nb = Number(b);
        if (Number.isNaN(na) || Number.isNaN(nb)) return String(b).localeCompare(String(a), undefined, { numeric: true });
        return nb - na;
    };
    return Object.keys(volumesObj)
        .sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : numericDesc(a, b)))
        .map((volKey) => {
            const chaptersObj = volumesObj[volKey]?.chapters || {};
            const chapters = Object.keys(chaptersObj)
                .sort(numericDesc)
                .map((chKey) => {
                    const c = chaptersObj[chKey];
                    return {
                        chapter: chKey === 'none' ? null : chKey,
                        id: c.id,
                        otherIds: Array.isArray(c.others) ? c.others : [],
                        count: c.count ?? 1,
                    };
                });
            return { volume: volKey === 'none' ? null : volKey, chapters };
        });
}

export async function fetchChapterPages(chapterId, signal) {
    const data = await apiFetch(`/api/at-home/server/${chapterId}`, signal);
    if (!data?.chapter) throw new Error('Invalid chapter pages response');
    const pages = data.chapter.data?.length ? data.chapter.data : data.chapter.dataSaver;
    if (!pages?.length) throw new Error('No pages available for this chapter');
    const usingDataSaver = !data.chapter.data?.length;
    return { ...data, pages, usingDataSaver };
}
