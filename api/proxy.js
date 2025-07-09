export default async function handler(req, res) {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    try {
        const headers = { ...req.headers };
        delete headers.host;
        delete headers['x-forwarded-for'];
        delete headers['x-vercel-proxy-signature'];
        delete headers['referer'];
        delete headers['cookie'];

        const resp = await fetch(url, {
            method: req.method,
            headers,
        });

        res.status(resp.status);

        // Set cache headers for Vercel Edge and browsers (cache images for 1 day, JSON for 10 min)
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.startsWith("image/")) {
            res.setHeader("Cache-Control", "public, max-age=86400, immutable, s-maxage=86400, stale-while-revalidate=86400");
        } else if (contentType.includes("json")) {
            res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=600");
        }

        for (const [key, value] of resp.headers.entries()) {
            if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        }
        const buf = await resp.arrayBuffer();
        res.send(Buffer.from(buf));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}