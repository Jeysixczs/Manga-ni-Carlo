export default async function handler(req, res) {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    try {
        // Remove some headers that may cause issues with MangaDex or other image servers
        const headers = { ...req.headers };
        delete headers.host;
        delete headers['x-forwarded-for'];
        delete headers['x-vercel-proxy-signature'];
        delete headers['referer']; // <--- remove referer for some image servers
        delete headers['cookie'];  // <--- never forward cookies

        const resp = await fetch(url, {
            method: req.method,
            headers,
        });
        res.status(resp.status);
        // Copy all headers except problematic ones
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