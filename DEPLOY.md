# Deploying Manhwa ni Carlo

Run it locally, push it to GitHub, ship it on Vercel.

---

## 0. What was broken (and is now fixed)

The zip you sent wouldn't run or deploy as-is. Four things:

| Problem | Effect | Fix |
|---|---|---|
| `package.json`, `package-lock.json`, `vite.config.js`, `vercel.json` and `README.md` were missing from the folder (deleted in the working tree, still in git history) | `npm install` and `npm run dev` both fail immediately — there's nothing to install | Restored from the last commit |
| `vercel.json` started with a UTF-8 BOM (`EF BB BF`) | `JSON.parse` chokes on it. Vercel fails the build with *"Could not parse File as JSON: vercel.json"* — this is almost certainly why your deploys kept dying | Rewritten without the BOM |
| No rewrite sending `/api/*` to the serverless function | `api/index.js` only answers `/api` and `/api/index` on Vercel. `/api/manga`, `/api/chapter`, `/api/image` etc. all 404, so the deployed site loads but shows no manga | Added `"/api/(.*)" → "/api"` as the first rewrite |
| `concurrently` used by `npm run dev` but never listed as a dependency | `npm run dev` fails with `concurrently: not found` | Added to `devDependencies` |

One extra hardening change: `app.set('trust proxy', 1)` in `server/app.js`. Behind Vercel every request carries the client IP in `X-Forwarded-For`; without this, `express-rate-limit` sees one IP for everyone and the 180 req/min budget becomes a *global* limit that one active user can exhaust for everybody.

Everything else was fine. All server files pass `node --check`, and `client/dist` is a valid build newer than `client/src`, so the React side compiles cleanly.

> I couldn't boot the app end-to-end here — the sandbox has no outbound network, so `npm install` can't fetch packages and the server couldn't reach `api.mangadex.org` even if it did. Step 1 below is the real smoke test; it should now work first try.

---

## 1. Run it locally

Requires **Node 18+** (the server uses built-in `fetch`). Check with `node -v`.

```bash
npm run install:all     # installs root + server + client
npm run dev             # Express on :3001, Vite on :5173
```

Open <http://localhost:5173>. Vite proxies `/api/*` through to Express, so the whole app works in dev.

Quick health check:

```bash
curl http://localhost:3001/api/health
# {"ok":true,"cache":{...},"staleCache":{...},"proxied":false}
```

To test the production path (Express serving the built client itself):

```bash
npm start               # builds the client, then serves everything on :3001
```

Open <http://localhost:3001>.

---

## 2. Push to GitHub

The folder is already a git repo with full history, so you only need to add a remote.

Create an **empty** repo on GitHub — no README, no .gitignore, no license. Then:

```bash
cd Manga-ni-Carlo

git add -A
git commit -m "Fix vercel.json BOM, add /api rewrite, restore package files"

git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If `git remote add` says the remote already exists, update it instead:

```bash
git remote set-url origin https://github.com/<your-username>/<your-repo>.git
```

Before pushing, sanity-check what's going up:

```bash
git status --short
git ls-files | head -30
```

`node_modules/`, `dist/`, `.env` and `*.log` are in `.gitignore` and stay local. That's correct — Vercel builds `client/dist` itself, so a committed build would just go stale.

---

## 3. Deploy on Vercel

### Import the repo

1. Go to <https://vercel.com/new>.
2. **Import Git Repository** → pick your repo (authorize the Vercel GitHub app if prompted).
3. **Root Directory**: leave it at `./` — the monorepo scripts are wired from the root.
4. **Framework Preset**: **Other**. Do *not* pick Vite. `vercel.json` already specifies the build, and a preset can fight with it.
5. Leave Build/Output/Install command fields blank. `vercel.json` supplies all three and takes precedence over the dashboard anyway.
6. **Deploy**.

### What `vercel.json` does

```json
{
  "installCommand": "npm run install:all",
  "buildCommand": "npm run build",
  "outputDirectory": "client/dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

- The React app is built to `client/dist` and served from Vercel's CDN.
- `api/index.js` is auto-detected as a serverless function; it re-exports the same Express app as `server/app.js`, so your local server and your deployed API can't drift apart.
- Rewrite 1 funnels every `/api/*` path into that one function. **Order matters** — it must come before rewrite 2.
- Rewrite 2 is the SPA fallback, so deep links like `/manga/<id>/chapter/<id>` survive a hard refresh.
- `server/app.js` checks `process.env.VERCEL` and skips its static-file serving there, since the CDN already handles that.

### Environment variables

None are required. One is optional:

| Variable | Purpose |
|---|---|
| `UPSTREAM_PROXY_URL` | Routes all MangaDex calls through a proxy you control, e.g. `http://user:pass@host:port`. Vercel functions egress from a shared, rotating IP pool, and MangaDex's Cloudflare blocks at the IP level — so requests fail intermittently through no fault of your own. A static-IP proxy (cheap VPS, QuotaGuard, Fixie) gives Cloudflare one stable IP to see. `HTTPS_PROXY` works as a fallback name. |

Set it under **Project → Settings → Environment Variables**, then redeploy for it to take effect.

---

## 4. Verify the deployment

```bash
curl https://<your-project>.vercel.app/api/health
```

A JSON body with `"ok": true` means the function is live and routing correctly. If that works but the gallery is empty, the problem is upstream (MangaDex/Cloudflare), not your deploy — try `/api/manga?limit=1`.

Then open the site and check: the gallery loads covers, search returns results, a chapter opens and pages render, and refreshing on a chapter URL doesn't 404.

Every push to `main` triggers a production deploy from here on. Pushes to other branches get preview URLs.

---

## 5. Troubleshooting

**Build fails: "Could not parse File as JSON"** — a BOM or trailing comma crept back into `vercel.json`. Check with:
```bash
head -c 3 vercel.json | od -An -tx1     # want "7b 0a 20", not "ef bb bf"
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"
```
VS Code: bottom-right encoding indicator → **Save with Encoding** → **UTF-8** (not "UTF-8 with BOM").

**Site loads, no manga, `/api/*` returns 404** — the `/api/(.*)` rewrite is missing or sits after the SPA fallback.

**`/api/*` returns 500** — open **Vercel → Deployments → your deployment → Functions** and read the logs. Usually an upstream timeout or a Cloudflare block on the shared IP pool; see `UPSTREAM_PROXY_URL` above.

**Deep links 404 on refresh** — the SPA fallback rewrite isn't matching. Confirm `outputDirectory` is `client/dist` and that `index.html` exists in the build output.

**`npm run dev` fails with `concurrently: not found`** — you're on the old `package.json`. Re-run `npm run install:all`.

**Blank page, console errors about MIME types** — Framework Preset got set to Vite and is overriding the output directory. Set it to **Other** and redeploy.

**Intermittent "The manga source is temporarily unreachable"** — this is the app's own message after its retries are exhausted. Expected occasionally on Vercel's shared IPs; a static-IP proxy is the real fix.
