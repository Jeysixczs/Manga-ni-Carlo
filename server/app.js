import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANGADEX_API = 'https://api.mangadex.org';

// Every outbound request gets a deadline. Without one, a stalled upstream
// connection keeps its socket, its response buffer and the whole Express
// req/res pair alive indefinitely — that is the main way a proxy like this
// grows memory under real traffic.
const UPSTREAM_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 30_000;

const JSON_CACHE_TTL_MS = 60_000;
const JSON_CACHE_MAX_ENTRIES = 400;
const JSON_CACHE_MAX_BYTES = 8 * 1024 * 1024;

const MANGADEX_UPLOADS_HOSTS = new Set(['uploads.mangadex.org', 'mangadex.org', 'api.mangadex.org']);
// Chapter page images are served from a per-request CDN node like
// "cmdxd98sb0x3yprd.mangadex.network" (from the /at-home/server response),
// so the allow-list needs a suffix check for that, not just a fixed set.
function isAllowedImageHost(hostname) {
    return MANGADEX_UPLOADS_HOSTS.has(hostname) || hostname.endsWith('.mangadex.network');
}

// Not every cover has a pre-generated .256.jpg/.512.jpg thumbnail, and when
// one is missing MangaDex's CDN doesn't always answer with a clean 404 — it
// can hand back a bare 502 instead. Rather than trust that as "the image is
// gone", build a fallback candidate pointing at the original full-size file
// so a missing thumbnail degrades to a bigger image instead of a broken one.
const COVER_THUMB_RE = /^(\/covers\/[^/]+\/[^/]+)\.(?:256|512)\.jpg$/;
function buildImageCandidates(parsedUrl) {
    const candidates = [parsedUrl.toString()];
    const m = parsedUrl.pathname.match(COVER_THUMB_RE);
    if (m) {
        const fallback = new URL(parsedUrl.toString());
        fallback.pathname = m[1];
        candidates.push(fallback.toString());
    }
    return candidates;
}

/**
 * Bounded LRU + TTL cache. Bounded on BOTH entry count and total bytes so the
 * cache can never itself become the leak it is meant to prevent.
 */
class TtlCache {
    constructor({ ttl, maxEntries, maxBytes }) {
        this.ttl = ttl;
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.bytes = 0;
        this.map = new Map();
    }

    get(key) {
        const hit = this.map.get(key);
        if (!hit) return null;
        if (Date.now() > hit.expires) {
            this.map.delete(key);
            this.bytes -= hit.size;
            return null;
        }
        // Re-insert to mark as most-recently-used.
        this.map.delete(key);
        this.map.set(key, hit);
        return hit;
    }

    set(key, value) {
        const size = Buffer.byteLength(value.body);
        if (size > this.maxBytes) return; // never cache something that would evict everything
        const existing = this.map.get(key);
        if (existing) this.bytes -= existing.size;
        this.map.set(key, { ...value, size, expires: Date.now() + this.ttl });
        this.bytes += size;
        // Evict oldest until back under both limits.
        while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldestKey = this.map.keys().next().value;
            if (oldestKey === undefined) break;
            this.bytes -= this.map.get(oldestKey).size;
            this.map.delete(oldestKey);
        }
    }
}

const jsonCache = new TtlCache({
    ttl: JSON_CACHE_TTL_MS,
    maxEntries: JSON_CACHE_MAX_ENTRIES,
    maxBytes: JSON_CACHE_MAX_BYTES,
});

// Single-flight: if ten browsers ask for the same manga list at once we make
// one upstream request, not ten. Entries are always removed in a finally block.
const inFlight = new Map();

const app = express();
app.set('etag', 'strong');
app.use(compression({
    filter: (req, res) => (req.path === '/api/image' ? false : compression.filter(req, res))
}));
app.use(cors());

// Basic protection against hammering the upstream API from one client.
const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

async function fetchUpstreamJson(url, { cache = true } = {}) {
    const cached = cache ? jsonCache.get(url) : null;
    if (cached) return cached;

    const pending = inFlight.get(url);
    if (pending) return pending;

    const task = (async () => {
        const upstream = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ManhwaNiCarlo/2.0 (+server-side proxy)'
            },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const body = await upstream.text();
        const result = { body, status: upstream.status };
        // Only successful responses are worth caching; errors should be retried.
        if (cache && upstream.ok) jsonCache.set(url, result);
        return result;
    })();

    inFlight.set(url, task);
    try {
        return await task;
    } finally {
        inFlight.delete(url);
    }
}

// Vercel's catch-all function (api/[...path].js) folds the matched route
// segments back into the query string under the key `___path` — a request for
// /api/manga?limit=10 arrives here as /api/manga?limit=10&___path=manga.
// MangaDex's query schema sets additionalProperties:false, so that single
// unexpected key fails validation and the whole request comes back 400. The
// injected keys must be dropped before forwarding. This is a no-op for the
// plain Node deployment, where nothing injects them.
const INJECTED_QUERY_KEYS = new Set(['path', '___path']);
function buildUpstreamSearch(req) {
    const qIndex = req.originalUrl.indexOf('?');
    if (qIndex === -1) return '';
    const params = new URLSearchParams(req.originalUrl.slice(qIndex + 1));
    for (const key of [...params.keys()]) {
        if (INJECTED_QUERY_KEYS.has(key) || key.startsWith('__') || key.startsWith('nxtP')) {
            params.delete(key);
        }
    }
    const search = params.toString();
    return search ? `?${search}` : '';
}

/**
 * Forwards a request to MangaDex, preserving the original query string.
 * This runs server-side, so there's no CORS problem and no need to bounce
 * through third-party CORS proxies the way the original client-only app did.
 */
async function proxyToMangaDex(upstreamPath, req, res, { maxAge = 60, cache = true } = {}) {
    const url = `${MANGADEX_API}${upstreamPath}${buildUpstreamSearch(req)}`;
    try {
        const { body, status } = await fetchUpstreamJson(url, { cache });
        // A 4xx from MangaDex means the request we built was wrong, and its body
        // names the offending parameter. Without this the reason never surfaces.
        if (status >= 400) console.error(`[proxy] ${url} -> ${status}: ${body.slice(0, 500)}`);
        if (res.writableEnded) return;
        res.status(status);
        res.type('application/json');
        // Lets the browser (and any CDN in front of this) serve repeat views of
        // the same gallery page without a network round-trip at all.
        if (status === 200) {
            res.setHeader('Cache-Control', maxAge > 0
                ? `public, max-age=${maxAge}, stale-while-revalidate=300`
                : 'no-store');
        }
        res.send(body);
    } catch (err) {
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        // Node's fetch wraps the real network error (DNS failure, TLS error,
        // connection refused, etc.) in err.cause and leaves err.message as the
        // unhelpful literal string "fetch failed" — log the cause or this is
        // invisible in every log line.
        const causeDetail = err.cause ? `${err.cause.code || err.cause.name || ''} ${err.cause.message || err.cause}`.trim() : null;
        console.error(`[proxy] ${url} failed:`, err.message, causeDetail ? `| cause: ${causeDetail}` : '');
        if (res.headersSent) return res.destroy();
        res.status(timedOut ? 504 : 502).json({
            error: timedOut ? 'Upstream MangaDex request timed out' : 'Upstream MangaDex request failed',
            detail: causeDetail || err.message,
        });
    }
}

// ---- Manga list / search ----
// GET /api/manga?limit=10&offset=0&title=...&contentRating[]=safe&order[latestUploadedChapter]=desc ...
app.get('/api/manga', (req, res) => proxyToMangaDex('/manga', req, res));

// ---- Manga details ----
app.get('/api/manga/:id', (req, res) => proxyToMangaDex(`/manga/${req.params.id}`, req, res, { maxAge: 300 }));

// ---- Chapters for a manga (list) ----
// Client calls /api/chapter?manga=<id>&limit=&offset=&...
app.get('/api/chapter', (req, res) => proxyToMangaDex('/chapter', req, res, { maxAge: 120 }));

// ---- Chapter page server info ----
// These URLs are short-lived tokens from MangaDex, so they are deliberately
// left uncached.
app.get('/api/at-home/server/:id', (req, res) => proxyToMangaDex(`/at-home/server/${req.params.id}`, req, res, { maxAge: 0, cache: false }));

// ---- Cover art lookup by cover id ----
app.get('/api/cover/:id', (req, res) => proxyToMangaDex(`/cover/${req.params.id}`, req, res, { maxAge: 3600 }));

// ---- Image proxy (covers + chapter pages) ----
// Streams the actual image bytes through our own server so the browser
// never needs to talk to uploads.mangadex.org directly.
app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url parameter' });

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid url parameter' });
    }
    if (!isAllowedImageHost(parsed.hostname)) {
        return res.status(403).json({ error: 'Only mangadex.org / mangadex.network image hosts are allowed' });
    }

    // A manga reader cancels image requests constantly: the user scrolls past
    // lazy images, hits Next, or closes the tab. Without this the browser goes
    // away but we keep pulling the full image from MangaDex into memory.
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    res.once('close', abortUpstream);
    const timer = setTimeout(abortUpstream, IMAGE_TIMEOUT_MS);

    const candidates = buildImageCandidates(parsed);
    let lastFailure = null;

    try {
        for (let i = 0; i < candidates.length; i++) {
            const isLastCandidate = i === candidates.length - 1;
            let upstream;
            try {
                upstream = await fetch(candidates[i], {
                    headers: {
                        'User-Agent': 'ManhwaNiCarlo/2.0 (+server-side proxy)',
                        // A bare custom User-Agent with no Referer/Accept is exactly
                        // the shape of request some image CDNs are quickest to drop.
                        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                        'Referer': 'https://mangadex.org/',
                    },
                    signal: controller.signal,
                });
            } catch (err) {
                if (controller.signal.aborted) throw err; // real cancellation/timeout — stop retrying
                lastFailure = { status: 502, message: err.message };
                continue;
            }

            if (!upstream.ok || !upstream.body) {
                // The body must be drained or cancelled even when we don't want it,
                // otherwise undici holds the socket and its buffer open.
                await upstream.body?.cancel().catch(() => {});
                lastFailure = { status: upstream.ok ? 502 : upstream.status, message: `upstream returned ${upstream.status}` };
                if (!isLastCandidate) continue;
                return res.status(lastFailure.status).end();
            }

            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
            const contentLength = upstream.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);
            // MangaDex image URLs are content-addressed, so the bytes behind a URL
            // never change — they can be cached hard and revalidation skipped.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            const etag = upstream.headers.get('etag');
            if (etag) res.setHeader('ETag', etag);
            // Pipe with proper backpressure instead of manually pumping chunks —
            // much faster for larger images and doesn't block the event loop.
            await pipeline(Readable.fromWeb(upstream.body), res);
            return;
        }
        // Every candidate failed (thumbnail and, if tried, the full-size original).
        if (lastFailure) console.error(`[image proxy] all candidates failed for ${url}:`, lastFailure.message);
        if (!res.headersSent) res.status(lastFailure?.status || 502).end();
    } catch (err) {
        // A client that navigated away is normal traffic, not an error.
        if (!controller.signal.aborted) console.error('[image proxy] failed:', err.message);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
    } finally {
        clearTimeout(timer);
        res.off('close', abortUpstream);
    }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, cache: { entries: jsonCache.map.size, bytes: jsonCache.bytes } }));

// ---- Serve the built React client (traditional Node deployment only) ----
// On Vercel the static build is served straight from its CDN/output directory
// and only /api/* requests ever reach this function, so none of this runs
// there — process.env.VERCEL is set automatically in that environment.
if (!process.env.VERCEL) {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    const indexHtml = path.join(clientDist, 'index.html');
    app.use(express.static(clientDist, {
        index: false,
        // Vite fingerprints every asset filename, so they can be cached forever.
        maxAge: '1y',
        immutable: true,
        setHeaders(res, filePath) {
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
    }));
    app.get(/^(?!\/api).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
    });
}

export default app;
