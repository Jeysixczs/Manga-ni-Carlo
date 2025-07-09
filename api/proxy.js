export default async function handler(req, res) {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    try {
        const resp = await fetch(url, {
            method: req.method,
            headers: {
                ...req.headers,
                host: undefined,
                'x-forwarded-for': undefined,
                'x-vercel-proxy-signature': undefined,
            }
        });
        res.status(resp.status);
        for (const [key, value] of resp.headers.entries()) {
            if (key.toLowerCase() !== "content-encoding" && key.toLowerCase() !== "content-length") {
                res.setHeader(key, value);
            }
        }
        const buf = await resp.arrayBuffer();
        res.send(Buffer.from(buf));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}