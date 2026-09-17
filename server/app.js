import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANGADEX_API = 'https://api.mangadex.org';

// Optional static-IP proxy for every upstream MangaDex/image call. Vercel
// functions egress from a shared, rotating IP pool, which is what makes
// Cloudflare's per-IP blocking of that pool intermittent and hard to retry
// around (see fetchUpstreamJson below). Pointing this at a small proxy you
// control — a cheap VPS, or a service like QuotaGuard/Fixie — gives
// MangaDex's Cloudflare a single stable IP to see instead, which is a real
// fix rather than a mitigation. Set UPSTREAM_PROXY_URL (falls back to the
// conventional HTTPS_PROXY/https_proxy) to something like
// "http://user:pass@proxy-host:port" to enable it; leave it unset and every
// fetch() below behaves exactly as it did before — a direct connection.
const PROXY_URL = process.env.UPSTREAM_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || null;
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : null;
if (proxyDispatcher) {
    try {
        console.log(`[proxy] Routing upstream requests through configured proxy (${new URL(PROXY_URL).hostname})`);
    } catch {
        console.log('[proxy] Routing upstream requests through configured proxy');
    }
}

// Every outbound request gets a deadline. Without one, a stalled upstream
// connection keeps its socket, its response buffer and the whole Express
// req/res pair alive indefinitely — that is the main way a proxy like this
// grows memory under real traffic.
const UPSTREAM_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 30_000;

// MangaDex bans/rate-limits at the IP level (per their own docs), and
// serverless platforms like Vercel share a rotating outbound-IP pool across
// every project deployed there. So a request can fail not because the
// resource is missing, but because *this particular invocation* happened to
// egress from a currently-flagged IP — the next invocation, from a different
// IP, succeeds against the exact same URL. A couple of quick retries absorbs
// that flakiness instead of surfacing it to the user as a permanent error.
const UPSTREAM_MAX_RETRIES = 2;
const UPSTREAM_RETRY_BASE_MS = 300;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Outbound rate limiting — https://api.mangadex.org/docs/2-limitations/
//
// The docs are explicit about the consequences of getting this wrong: exceed
// ~5 req/s per IP and you get 429s; keep sending while being 429'd and their
// DDoS protection issues a temporary IP ban (a blanket 403 on *.mangadex.org);
// keep going after *that* and they stop answering your IP entirely, with the
// cooldown renewed by every further request. The inbound limiter below caps
// one client, not the sum of all of them, so this is the piece that actually
// protects us — and it has to gate egress, not ingress.
//
// Caveat worth knowing: on Vercel each invocation is its own isolate, so these
// buckets only coordinate requests that happen to share a warm instance. They
// are a large improvement over nothing, but the real fix for a busy deployment
// is a single long-lived server (or UPSTREAM_PROXY_URL pointing at one).
// ---------------------------------------------------------------------------

class TokenBucket {
    constructor(name, capacity, refillPerSecond) {
        this.name = name;
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.tokens = capacity;
        this.last = Date.now();
    }

    #refill() {
        const now = Date.now();
        this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond);
        this.last = now;
    }

    /** Resolves once a token is available. Never rejects. */
    async take() {
        for (;;) {
            this.#refill();
            if (this.tokens >= 1) {
                this.tokens -= 1;
                return;
            }
            // Sleep for exactly as long as the next token needs, not a fixed poll.
            await sleep(Math.max(20, Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000)));
        }
    }
}

// Docs: "a global limit of approximately 5 requests per second per IP". That's
// a minimum guaranteed allowance rather than a hard ceiling, so sitting a
// little under it costs nothing and leaves headroom for the shared-IP case
// (Vercel's egress pool, VPNs, CGNAT) where other people's traffic counts
// against the same budget.
const globalBucket = new TokenBucket('global', 4, 4);

// Docs, endpoint-specific table: GET /at-home/server/{id} is 40 per 1 minute.
const atHomeBucket = new TokenBucket('at-home', 40, 40 / 60);

// A 429 means we are already over the line. The documented failure mode is
// that continuing to send while being 429'd escalates to an IP ban, so a 429
// stops *all* upstream traffic until the window they name has passed, rather
// than just failing the one request that happened to hit it.
let rateLimitedUntil = 0;

function noteRateLimit(headers) {
    // X-RateLimit-Retry-After is a UNIX timestamp (seconds) per the docs;
    // Retry-After is the standard delta-seconds. Accept either.
    const stamp = Number(headers.get('x-ratelimit-retry-after'));
    const delta = Number(headers.get('retry-after'));
    let until;
    if (Number.isFinite(stamp) && stamp > 1_000_000_000) until = stamp * 1000;
    else if (Number.isFinite(delta) && delta > 0) until = Date.now() + delta * 1000;
    else until = Date.now() + 5_000;
    // Cap it so a bogus header can't wedge the server for hours.
    rateLimitedUntil = Math.max(rateLimitedUntil, Math.min(until, Date.now() + 120_000));
    console.error(`[ratelimit] upstream 429; pausing outbound requests for ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`);
}

class RateLimitedError extends Error {
    constructor(retryAfterMs) {
        super('Upstream rate limit in effect');
        this.name = 'RateLimitedError';
        this.retryAfterMs = retryAfterMs;
    }
}

function assertNotRateLimited() {
    const remaining = rateLimitedUntil - Date.now();
    if (remaining > 0) throw new RateLimitedError(remaining);
}

// The User-Agent is mandatory ("The request MUST have a User-Agent header, and
// it must not be spoofed"), so identify this app honestly and give them
// somewhere to look if this deployment ever misbehaves. Override
// MANGADEX_CONTACT with your own repo/email when you deploy.
const CONTACT = process.env.MANGADEX_CONTACT || 'https://github.com/Jeysixczs/manhwa-ni-carlo';
const USER_AGENT = `ManhwaNiCarlo/2.0 (+${CONTACT})`;

// MangaDex's real API errors are always JSON, e.g. {"result":"error","errors":[...]}.
// A non-JSON body on a non-2xx (typically an HTML Cloudflare/WAF block or
// challenge page) is a strong signal this response didn't actually come from
// the MangaDex application layer at all — that's the case worth retrying,
// as opposed to a genuine "this manga doesn't exist" JSON 404.
function looksLikeJson(body) {
    const trimmed = body.trimStart();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
}

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

// MangaDex sits behind Cloudflare, and Vercel functions share a rotating
// outbound-IP pool across every project hosted there. When that shared IP
// gets rate-limited/flagged, Cloudflare answers with an HTML block/challenge
// page instead of MangaDex's real JSON — and because a single invocation's
// retries all go out from that same flagged IP, retrying alone often can't
// recover within one request. This second, much longer-lived cache holds the
// last *known-good* (2xx) response for a URL so a transient block degrades
// to briefly-stale data instead of a hard error in the client.
const STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const staleCache = new TtlCache({
    ttl: STALE_CACHE_TTL_MS,
    maxEntries: JSON_CACHE_MAX_ENTRIES,
    maxBytes: JSON_CACHE_MAX_BYTES,
});

// Single-flight: if ten browsers ask for the same manga list at once we make
// one upstream request, not ten. Entries are always removed in a finally block.
const inFlight = new Map();

const app = express();
app.set('etag', 'strong');
// On Vercel (and any reverse proxy) the client IP arrives in X-Forwarded-For.
// Without this, express-rate-limit sees every request as coming from the same
// proxy address and the 180/min budget below becomes a *global* limit instead
// of a per-client one. Trust exactly one hop — trusting all of them would let
// a client spoof the header and dodge the limiter entirely.
app.set('trust proxy', 1);
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

async function fetchUpstreamJson(url, { cache = true, bucket = null } = {}) {
    const cached = cache ? jsonCache.get(url) : null;
    if (cached) return cached;

    const pending = inFlight.get(url);
    if (pending) return pending;

    const task = (async () => {
        let lastResult = null;
        let lastErr = null;

        for (let attempt = 0; attempt <= UPSTREAM_MAX_RETRIES; attempt++) {
            try {
                // Both gates, in order: the blanket "we're being 429'd right
                // now" check first (cheap, and the whole point is to send
                // nothing at all), then wait our turn in the buckets.
                assertNotRateLimited();
                if (bucket) await bucket.take();
                await globalBucket.take();
                assertNotRateLimited();

                const upstream = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': USER_AGENT,
                    },
                    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
                    ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
                });
                const body = await upstream.text();
                const result = { body, status: upstream.status };

                if (upstream.ok) {
                    if (cache) jsonCache.set(url, result);
                    staleCache.set(url, result);
                    return result;
                }

                // 429 (over the rate limit) and 403 (already banned for
                // ignoring one) are the two responses where retrying is
                // actively harmful — each further request extends the
                // penalty. Record the cooldown, serve stale if we can, and
                // otherwise let the 429 through to the client honestly.
                if (upstream.status === 429) {
                    noteRateLimit(upstream.headers);
                    return staleCache.get(url) || result;
                }
                if (upstream.status === 403 && !looksLikeJson(body)) {
                    // A non-JSON 403 isn't MangaDex's app layer refusing a
                    // resource, it's their edge refusing *us*. Same treatment.
                    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + 30_000);
                    console.error('[ratelimit] upstream 403 from the edge; pausing outbound requests for 30s');
                    return staleCache.get(url) || result;
                }

                // A non-2xx with a non-JSON body is very likely an edge block/
                // challenge page rather than MangaDex's own error response —
                // worth a retry. A non-2xx with a real JSON error body is
                // MangaDex actually answering (e.g. a genuine 404), so accept
                // it immediately rather than retrying something that will
                // just fail the same way again.
                if (!looksLikeJson(body)) {
                    lastResult = result;
                    if (attempt < UPSTREAM_MAX_RETRIES) {
                        console.error(`[proxy] ${url} -> ${upstream.status} with non-JSON body, retrying (attempt ${attempt + 1}/${UPSTREAM_MAX_RETRIES})`);
                        await sleep(UPSTREAM_RETRY_BASE_MS * 2 ** attempt);
                        continue;
                    }
                    // Retries exhausted and it's still not real JSON — almost
                    // certainly a Cloudflare/WAF block rather than MangaDex
                    // actually answering. Serve the last known-good response
                    // for this exact URL if we have one, rather than surface
                    // this as a hard failure to the client.
                    const stale = staleCache.get(url);
                    if (stale) {
                        console.error(`[proxy] ${url} -> ${upstream.status} with non-JSON body after retries; serving stale cached response instead`);
                        return stale;
                    }
                    continue; // fall through to the loop end (no more attempts left)
                }

                return result;
            } catch (err) {
                lastErr = err;
                // Retrying our own cooldown would just burn the attempts and
                // then fail anyway — the cooldown outlasts the backoff by design.
                if (err.name === 'RateLimitedError') {
                    const stale = staleCache.get(url);
                    if (stale) return stale;
                    throw err;
                }
                const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
                if (!timedOut && attempt < UPSTREAM_MAX_RETRIES) {
                    console.error(`[proxy] ${url} threw, retrying (attempt ${attempt + 1}/${UPSTREAM_MAX_RETRIES}):`, err.message);
                    await sleep(UPSTREAM_RETRY_BASE_MS * 2 ** attempt);
                    continue;
                }
                const stale = staleCache.get(url);
                if (stale) {
                    console.error(`[proxy] ${url} threw after retries (${err.message}); serving stale cached response instead`);
                    return stale;
                }
                throw err;
            }
        }

        // Every attempt returned a non-JSON error body and no stale fallback
        // was available; surface the last one.
        if (lastResult) return lastResult;
        throw lastErr;
    })();

    inFlight.set(url, task);
    try {
        return await task;
    } finally {
        inFlight.delete(url);
    }
}

// Vercel's catch-all function (api/[...path].js) folds the matched route
// segments back into the query string — a request for /api/manga?limit=10
// arrives here with an extra key identifying the matched route (seen so far
// as `path`, `___path`, and other underscore/`nxtP`-prefixed names, and the
// exact name has changed across deployments). MangaDex's query schema sets
// additionalProperties:false, so ANY unexpected key fails validation and the
// whole request comes back 400. Denylisting the names we've observed is
// fragile — the safe fix is to allowlist only the query keys this app
// actually sends, and drop everything else, whatever Vercel calls it. This
// is a no-op for the plain Node deployment, where nothing injects extra keys.
const ALLOWED_QUERY_BASE_NAMES = new Set([
    'limit', 'offset', 'title', 'includes', 'contentRating', 'status', 'year',
    'order', 'manga', 'translatedLanguage',
    // Genre/tag filtering (GET /manga) and language-scoped aggregate lookups
    // (GET /manga/:id/aggregate) — both previously stripped by the allowlist,
    // which silently dropped any includedTags[]/excludedTags[] the client sent.
    'includedTags', 'excludedTags', 'includedTagsMode', 'excludedTagsMode',
]);
function buildUpstreamSearch(req) {
    const qIndex = req.originalUrl.indexOf('?');
    if (qIndex === -1) return '';
    const params = new URLSearchParams(req.originalUrl.slice(qIndex + 1));
    for (const key of [...params.keys()]) {
        // 'order[latestUploadedChapter]' -> base name 'order'; 'includes[]' -> 'includes'.
        const baseName = key.split('[')[0];
        if (!ALLOWED_QUERY_BASE_NAMES.has(baseName)) {
            params.delete(key);
        }
    }
    clampCollectionParams(params);
    const search = params.toString();
    return search ? `?${search}` : '';
}

// Docs, "Collection result sizes": requests where offset + size > 10.000 are
// *rejected*, and size is capped at 100. Both are stated to be permanent, for
// performance reasons. Before this, deep pagination in the gallery (the page
// buttons happily offered page 8000 of a ~80k-result set) sent offsets far
// past 10.000 and every one of them came back 400 with no useful message.
// Clamping here means the last reachable page degrades to "the same results
// again" instead of an error page.
const MAX_COLLECTION_LIMIT = 100;
const MAX_COLLECTION_WINDOW = 10_000;

function clampCollectionParams(params) {
    if (!params.has('limit') && !params.has('offset')) return;

    let limit = Number(params.get('limit'));
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    limit = Math.min(Math.floor(limit), MAX_COLLECTION_LIMIT);

    let offset = Number(params.get('offset'));
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    offset = Math.floor(offset);

    if (offset + limit > MAX_COLLECTION_WINDOW) {
        offset = Math.max(0, MAX_COLLECTION_WINDOW - limit);
    }

    if (params.has('limit')) params.set('limit', String(limit));
    if (params.has('offset')) params.set('offset', String(offset));
}

/**
 * Forwards a request to MangaDex, preserving the original query string.
 * This runs server-side, so there's no CORS problem and no need to bounce
 * through third-party CORS proxies the way the original client-only app did.
 */
async function proxyToMangaDex(upstreamPath, req, res, { maxAge = 60, cache = true, bucket = null } = {}) {
    const url = `${MANGADEX_API}${upstreamPath}${buildUpstreamSearch(req)}`;
    try {
        const { body, status } = await fetchUpstreamJson(url, { cache, bucket });
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
        if (err.name === 'RateLimitedError') {
            const seconds = Math.ceil(err.retryAfterMs / 1000);
            if (res.headersSent) return res.destroy();
            res.setHeader('Retry-After', String(seconds));
            return res.status(429).json({
                error: `MangaDex is rate-limiting this server. Try again in about ${seconds}s.`,
            });
        }
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
// The docs give this endpoint its own budget of 40 requests per minute, well
// below the global 5/s, so it gets its own bucket on top of the global one.
app.get('/api/at-home/server/:id', (req, res) => proxyToMangaDex(`/at-home/server/${req.params.id}`, req, res, { maxAge: 0, cache: false, bucket: atHomeBucket }));

// ---- Cover art lookup by cover id ----
app.get('/api/cover/:id', (req, res) => proxyToMangaDex(`/cover/${req.params.id}`, req, res, { maxAge: 3600 }));

// ---- Tag list (genres, themes, formats, content warnings) ----
// GET https://api.mangadex.org/docs/redoc.html#tag=Manga/operation/get-manga-tag
// This is the full, effectively-static ~90-entry taxonomy MangaDex uses for
// `includedTags[]`/`excludedTags[]` on /manga — the client had no way to
// build a genre picker without it, so search was title-only.
app.get('/api/tag', (req, res) => proxyToMangaDex('/manga/tag', req, res, { maxAge: 86_400 }));

// ---- Manga statistics (bayesian rating + follower count) ----
// GET /statistics/manga/:id for a single manga (the details page), and the
// batch form GET /statistics/manga?manga[]=<id>&manga[]=<id> for a whole grid
// of cards at once — one request instead of one per card.
app.get('/api/statistics/manga/:id', (req, res) => proxyToMangaDex(`/statistics/manga/${req.params.id}`, req, res, { maxAge: 300 }));
app.get('/api/statistics/manga', (req, res) => proxyToMangaDex('/statistics/manga', req, res, { maxAge: 300 }));

// ---- Chapter aggregate (full volume -> chapter tree in one call) ----
// GET /manga/:id/aggregate. Unlike /chapter (paginated, one language filter
// param, no volume grouping), this returns every volume/chapter number in a
// single response with per-chapter alternate-translation ids — what the new
// "by volume" chapter view on the details page is built on.
app.get('/api/manga/:id/aggregate', (req, res) => proxyToMangaDex(`/manga/${req.params.id}/aggregate`, req, res, { maxAge: 300 }));

// ---------------------------------------------------------------------------
// MangaDex@Home network reports — https://api.mangadex.org/docs/04-chapter/retrieving-chapter/
//
// "For each image you retrieve (successfully or not) from a base url that
// doesn't contain mangadex.org ... call the network report endpoint." This is
// how they detect and evict unhealthy volunteer cache nodes; a reader that
// skips it is freeloading on the network and, more selfishly, keeps getting
// handed the same broken node with no way for anyone to know.
//
// Deliberately excluded: uploads.mangadex.org and friends. Those are
// MangaDex's own servers, not @Home nodes, and reporting them is noise.
// ---------------------------------------------------------------------------
const MANGADEX_REPORT_URL = 'https://api.mangadex.network/report';
const REPORTS_ENABLED = process.env.MANGADEX_REPORT !== 'false';
const REPORT_TIMEOUT_MS = 3_000;

function isAtHomeNode(hostname) {
    return !hostname.endsWith('mangadex.org');
}

async function reportToNetwork({ url, success, bytes, duration, cached }) {
    if (!REPORTS_ENABLED) return;
    try {
        await fetch(MANGADEX_REPORT_URL, {
            method: 'POST',
            // The docs are emphatic that this must be exactly application/json.
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
            body: JSON.stringify({ url, success, bytes, duration, cached }),
            signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
            ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
        });
    } catch (err) {
        // A failed report is never worth failing a page load over, and this
        // runs after the image bytes are already on their way to the browser.
        console.error('[report] failed:', err.message);
    }
}

/** Counts bytes flowing through a pipeline without buffering any of them. */
function byteCounter(onDone) {
    let total = 0;
    return new Transform({
        transform(chunk, _enc, cb) {
            total += chunk.length;
            cb(null, chunk);
        },
        flush(cb) {
            onDone(total);
            cb();
        },
    });
}

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
            const candidate = candidates[i];
            const reportable = REPORTS_ENABLED && isAtHomeNode(new URL(candidate).hostname);
            const startedAt = Date.now();
            let upstream;
            try {
                upstream = await fetch(candidate, {
                    headers: {
                        // Mandatory, and the docs say it must not be spoofed.
                        'User-Agent': USER_AGENT,
                        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                        // No Referer: forging one to look like mangadex.org is
                        // exactly the hotlinking their docs tell you to avoid.
                        // Proxying server-side, which is what this route does,
                        // is the sanctioned way to serve these images — so the
                        // forged header bought nothing and misrepresented us.
                        //
                        // Also per the docs: never send authentication headers
                        // to image hosts. An @Home node is a third party's
                        // machine, and a token sent there is a token leaked.
                    },
                    signal: controller.signal,
                    ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
                });
            } catch (err) {
                if (controller.signal.aborted) throw err; // real cancellation/timeout — stop retrying
                // "On a failure that doesn't result in any response
                // (connection failure, bad SSL certificate, ...) just put 0
                // for bytes."
                if (reportable) reportToNetwork({ url: candidate, success: false, bytes: 0, duration: Date.now() - startedAt, cached: false });
                lastFailure = { status: 502, message: err.message };
                continue;
            }

            // cached is true iff the node sent an X-Cache header starting with HIT.
            const cached = (upstream.headers.get('x-cache') || '').startsWith('HIT');

            if (!upstream.ok || !upstream.body) {
                // The body must be drained or cancelled even when we don't want it,
                // otherwise undici holds the socket and its buffer open.
                await upstream.body?.cancel().catch(() => {});
                if (reportable) reportToNetwork({ url: candidate, success: false, bytes: 0, duration: Date.now() - startedAt, cached });
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
            // The counter sits inline so the report can carry a real byte count
            // even when the node omits Content-Length; it buffers nothing.
            let transferred = 0;
            try {
                await pipeline(Readable.fromWeb(upstream.body), byteCounter((n) => { transferred = n; }), res);
            } catch (err) {
                // The transfer died partway. That still counts as a failed
                // retrieval from that node's point of view, and it's precisely
                // the case they want to hear about.
                if (reportable && !controller.signal.aborted) {
                    await reportToNetwork({ url: candidate, success: false, bytes: transferred, duration: Date.now() - startedAt, cached });
                }
                throw err;
            }
            // Awaited rather than fired-and-forgotten: the response is already
            // complete, so this only delays teardown, and on a serverless
            // platform an un-awaited promise after the response is likely to be
            // frozen and never sent at all.
            if (reportable) await reportToNetwork({ url: candidate, success: true, bytes: transferred, duration: Date.now() - startedAt, cached });
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

app.get('/api/health', (_req, res) => res.json({
    ok: true,
    cache: { entries: jsonCache.map.size, bytes: jsonCache.bytes },
    staleCache: { entries: staleCache.map.size, bytes: staleCache.bytes },
    proxied: Boolean(proxyDispatcher),
    upstream: {
        // Handy when a deployment starts misbehaving: if cooldownMs is large
        // and stays large, the IP this server egresses from is being throttled.
        cooldownMs: Math.max(0, rateLimitedUntil - Date.now()),
        globalTokens: Math.floor(globalBucket.tokens),
        atHomeTokens: Math.floor(atHomeBucket.tokens),
        reports: REPORTS_ENABLED,
    },
}));

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
