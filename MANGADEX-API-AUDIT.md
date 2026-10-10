# MangaDex API audit (Kitsunescan)

Checked against the official docs at https://api.mangadex.org/docs/ (v5.13.1): usage policy, limitations,
pagination, search, chapter search, chapter images / MangaDex@Home, enumerations.

**Not verified:** the machine-readable OpenAPI file. The Redoc/Swagger pages are rendered in JavaScript and
could not be fetched, so per-parameter schemas (exact response shapes, every optional query key) were checked
against the written guides, not the spec. Re-check a parameter in Swagger before adding new ones.

## Endpoints this project uses (all public GET, no auth)
`/manga`, `/manga/random`, `/manga/{id}`, `/manga/{id}/feed`, `/manga/{id}/aggregate`, `/manga/tag`,
`/chapter`, `/chapter/{id}`, `/at-home/server/{id}`, `/author`, `/author/{id}`, `/group`, `/group/{id}`,
`/cover`, `/cover/{id}`, `/statistics/manga`, `/statistics/manga/{id}`, plus `POST https://api.mangadex.network/report`.

## Reference-document entries NOT used / not to be trusted
- `/auth/login|logout|refresh|check`: legacy; MangaDex now uses OAuth2 (auth.mangadex.org). Personal API clients
  are for your own account only. A public reader should not hold user credentials or client secrets at all.
- `POST /manga/{id}/read`: the official rate-limit table lists `POST /chapter/{id}/read`. Needs a logged-in user.
- `/manga/{id}/aggregate/{translatedLanguage}`: not in the official guides; the project uses
  `/manga/{id}/aggregate?translatedLanguage[]=`.
- Write routes (POST/PUT/DELETE on manga, chapter, cover, author, group, upload, client, settings, report):
  permission-gated; intentionally not implemented.
- Follows, lists, ratings, reading status, history: need a signed-in user (OAuth). Out of scope for a public reader.

## Fixes made in this pass
1. **Group credit (policy MUST).** Chapter lists now request `includes[]=scanlation_group`; the group name is
   shown on every chapter row and under the title in the reader.
2. **Removal requests (policy MUST).** `MANGADEX_BLOCKED_GROUPS` hides a group's chapters and blocks direct reads (HTTP 451).
3. **Scheduled chapters.** Sending `includeExternalUrl` turns off MangaDex's default `publishAt <= now` filter
   (docs: *Searching for chapters*), so the "Latest updates" feed could show future chapters first. Now filtered.
4. **`/manga/random`** was sent a `limit` param it does not take (removed) and now respects its documented 60/min limit.
5. **Errors.** MangaDex error bodies (`{result:"error", errors:[{title, detail}]}`) are now shown to the user, and the
   server logs `X-Request-ID` for 4xx/5xx, as the docs ask when reporting problems.
6. **Pagination.** The reader loaded only the first 100 chapters, so Prev/Next vanished for later chapters of long series.
   It now pages (bounded) until the open chapter is found.

## Already compliant (left unchanged)
User-Agent set and not spoofed; no `Via`; ~5 req/s global bucket and 40/min at-home bucket; stop-on-429/403
cooldown; `limit` ≤ 100 and `offset+limit` ≤ 10 000 clamped; images proxied (no hotlinking, no Referer, no auth
headers); at-home base URL used as-is and refreshed on failure; `@Home` success/failure reports; no ads;
MangaDex credited in the footer.

## Known limits / things to watch
- The image proxy only allows `*.mangadex.org` and `*.mangadex.network`. MangaDex says a base URL "could be whatever
  else"; if a node ever uses another domain its images will be refused (403) rather than fetched.
- Cover/image requests to `uploads.mangadex.org` are not throttled by the API bucket; MangaDex says it has
  undocumented limits for them. Browser/CDN caching (1 year, immutable) keeps this low.
- On Vercel each invocation has its own rate-limit state, so the buckets only coordinate within a warm instance.
- Blocked-group filtering hides chapters in lists and blocks reading, but the aggregate (volume) view can still
  list a blocked chapter's number; opening it is refused.
