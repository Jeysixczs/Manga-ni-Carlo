export const config = { runtime: "edge" };

// Proper headers for MangaDex API compliance
function getHeaders(url: string, isImage: boolean) {
  const headers = new Headers();
  headers.set("user-agent", "Manga-ni-Carlo/1.0 (Jeysixczs; deployed via Vercel Edge Proxy)");
  if (isImage) {
    headers.set("accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
  } else {
    headers.set("accept", "application/json");
  }
  return headers;
}

export default async function handler(req: Request) {
    
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return new Response(JSON.stringify({ error: "Missing url parameter" }), { status: 400 });

  const isImage = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/.test(url);

  try {
    const headers = getHeaders(url, isImage);

    const resp = await fetch(url, { method: req.method, headers, redirect: "follow" });
    const contentType = resp.headers.get("content-type") || "";
    const outHeaders = new Headers(resp.headers);

    // Aggressive edge CDN caching
    if (contentType.startsWith("image/")) {
      outHeaders.set("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable, stale-while-revalidate=86400");
    } else if (contentType.includes("json")) {
      outHeaders.set("Cache-Control", "public, max-age=600, s-maxage=600, stale-while-revalidate=600");
    } else {
      outHeaders.set("Cache-Control", "public, max-age=60, s-maxage=60");
    }

    // Remove problematic headers & set CORS
    ["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].forEach(h => outHeaders.delete(h));
    outHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), { status: 500 });
  }
 
}