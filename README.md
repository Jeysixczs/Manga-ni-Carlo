# Manhwa ni Carlo — React + Express edition

A rewrite of the original single-page (HTML/CSS/vanilla JS) MangaDex reader as:

- **`/client`** — a React app (Vite + React Router)
- **`/server`** — a small Express server that proxies the MangaDex API and serves the built client

## Why a server?

The original app called `api.mangadex.org` straight from the browser, routed through a
rotating list of free third-party CORS proxies (`api.codetabs.com`, `proxy.cors.sh`, etc.)
to get around CORS. Those proxies are unreliable, rate-limit aggressively, and are a bit of
a trust liability since your traffic flows through someone else's server.

This version's Express server calls MangaDex directly (server-to-server, no CORS issue at
all) and also proxies cover/page images so the browser only ever talks to your own domain.
It's simpler, faster, and removes the dependency on those proxies entirely.

## Project layout

```
mangadex-reader/
├── client/           React app (Vite)
│   └── src/
│       ├── api.js              # fetch wrappers, all calls hit /api/*
│       ├── App.jsx             # router + layout
│       ├── ThemeContext.jsx    # dark/light theme
│       └── components/
│           ├── GalleryPage.jsx         # tabs, pagination, grid
│           ├── SearchAndFilters.jsx    # search box + suggestions + filters
│           ├── MangaCard.jsx
│           ├── MangaDetailsPage.jsx
│           └── ChapterReaderPage.jsx   # page-by-page reader
├── server/           Express server
│   └── index.js       # MangaDex proxy routes + static file serving
└── package.json      # root scripts (dev/build/start)
```

## Setup

Requires Node 18+ (for built-in `fetch`).

```bash
npm run install:all
```

## Development

Runs the Express server on `:3001` and the Vite dev server on `:5173` (which proxies
`/api/*` requests to the Express server) at the same time:

```bash
npm run dev
```

Open http://localhost:5173

## Production

Builds the React app and starts the Express server, which serves the built files itself:

```bash
npm start
```

Open http://localhost:3001 (or set `PORT=xxxx`).

## API routes (server)

All under `/api`, mirroring the MangaDex endpoints the app needs:

| Route | Proxies to |
|---|---|
| `GET /api/manga` | `GET https://api.mangadex.org/manga` (list/search, query forwarded as-is) |
| `GET /api/manga/:id` | `GET https://api.mangadex.org/manga/:id` |
| `GET /api/chapter` | `GET https://api.mangadex.org/chapter` (chapter list, `?manga=<id>`) |
| `GET /api/at-home/server/:id` | `GET https://api.mangadex.org/at-home/server/:id` (chapter page URLs) |
| `GET /api/cover/:id` | `GET https://api.mangadex.org/cover/:id` |
| `GET /api/image?url=` | Streams a cover/page image (only `*.mangadex.org` hosts allowed) |
| `GET /api/tag` | `GET https://api.mangadex.org/manga/tag` (genre/theme/format taxonomy) |
| `GET /api/statistics/manga/:id` | `GET https://api.mangadex.org/statistics/manga/:id` (rating + follows) |
| `GET /api/statistics/manga?manga[]=` | `GET https://api.mangadex.org/statistics/manga?manga[]=` (batch ratings) |
| `GET /api/manga/:id/aggregate` | `GET https://api.mangadex.org/manga/:id/aggregate` (volume/chapter tree) |

A light rate limiter (180 req/min per IP) sits in front of `/api` to keep the server from
getting MangaDex-rate-limited by a single runaway client.

## What changed vs. the original vanilla-JS app

- No more third-party CORS proxies — the server talks to MangaDex directly.
- Views (`Gallery` / `Details` / `Reader`) are now real routes (`/`, `/manga/:id`,
  `/manga/:id/chapter/:chapterId`), so back/forward and refresh work correctly and deep
  links are just normal URLs — no manual `sessionStorage`/query-param bookkeeping needed.
- State (search, filters, tab, page) lives in React state + the URL's `?tab=&page=&q=`
  params instead of a global mutable `STATE` object.
- The "smart" hide-on-scroll reader header and "resume where you left off" per-chapter
  page tracking (via `localStorage`) both carried over.
- Original CSS (`style.css`) is reused as-is (`client/src/styles.css`), including the
  dark/light theme via `[data-theme]`.
- Not carried over: the original's manual proxy-failover/retry logic (no longer needed)
  and the exact `sessionStorage`-based "resume last view on reload" behavior (replaced by
  URL-based routing, which does the same job more simply).
