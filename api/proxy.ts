export const config = { runtime: "edge" };

export default async function handler(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    if (!url) return new Response(JSON.stringify({ error: "Missing url parameter" }), { status: 400 });

    try {
        const resp = await fetch(url, {
            method: req.method,
            headers: {
                // Remove problematic headers
            }
        });
        const contentType = resp.headers.get("content-type") || "";
        const headers = new Headers(resp.headers);
        headers.set("Cache-Control", contentType.startsWith("image/") ? "public, max-age=86400, s-maxage=86400, immutable, stale-while-revalidate=86400"
            : contentType.includes("json") ? "public, max-age=600, s-maxage=600, stale-while-revalidate=600"
            : "public, max-age=60, s-maxage=60"
        );
        // Remove unwanted headers
        ["content-encoding", "content-length", "transfer-encoding", "connection"].forEach(h => headers.delete(h));
        return new Response(resp.body, { status: resp.status, headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}