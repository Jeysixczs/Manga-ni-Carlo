export const config = { runtime: "edge" };

const ALLOWED_API_HEADERS = [
  "accept",
  "accept-language",
  "if-none-match",
  "if-modified-since",
  "user-agent", // important for MangaDex
];

const MANGADEX_UA = "Manga-ni-Carlo/1.0 (Jeysixczs; deployed via Vercel Edge Proxy)";

function filterHeaders(headers: Headers, isImage: boolean) {
  const result = new Headers();
  for (const [key, value] of headers.entries()) {
    if (isImage) {
      if (key.toLowerCase() === "accept" || key.toLowerCase() === "user-agent") {
        result.set(key, value);
      }
    } else {
      if (ALLOWED_API_HEADERS.includes(key.toLowerCase())) {
        result.set(key, value);
      }
    }
  }
  // Always set our own UA
  result.set("user-agent", MANGADEX_UA);
  // Always set Accept for images
  if (isImage) result.set("accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
  return result;
}

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return new Response(JSON.stringify({ error: "Missing url parameter" }), { status: 400 });

  // Determine if this is an image request
  const isImage = /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/i.test(url);

  try {
    // Only forward allowed headers, always set custom User-Agent
    const headers = filterHeaders(req.headers, isImage);

    const resp = await fetch(url, {
      method: req.method,
      headers,
      // Never forward cookies, referer, etc.
      redirect: "follow",
    });

    // Prepare headers for the response
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

    // Remove problematic headers
    ["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].forEach(h => outHeaders.delete(h));

    // MangaDex requires correct CORS for images if loaded cross-origin
    outHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), { status: 500 });
  }
}