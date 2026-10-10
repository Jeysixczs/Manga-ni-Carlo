// One real HTML file per screen. Links are plain anchors, so the browser's
// own back/forward, open-in-new-tab and middle-click all behave natively.
export const HOME_URL = '/';
export const mangaUrl = (id) => `/manga.html?id=${encodeURIComponent(id)}`;
export const readUrl = (mangaId, chapterId) =>
    `/read.html?manga=${encodeURIComponent(mangaId)}&chapter=${encodeURIComponent(chapterId)}`;

export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}
