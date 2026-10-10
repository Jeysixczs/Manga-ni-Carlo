// Single source of truth for the app's "browse" destinations. GalleryPage
// renders these as its in-page pill tabs; SiteHeader/mobile nav surface the
// same destinations as persistent global navigation, so a visitor reading a
// manga's details or a chapter can jump straight to a tab without first
// navigating back to an unfiltered gallery.
// Meteorological seasons, matching how manga/anime "seasons" are usually
// counted: winter Dec-Feb, spring Mar-May, summer Jun-Aug, fall Sep-Nov.
export function currentSeason(now = new Date()) {
    const m = now.getUTCMonth(); // 0-11
    const y = now.getUTCFullYear();
    let name, startY, startM;
    if (m >= 2 && m <= 4) { name = 'Spring'; startY = y; startM = 2; }
    else if (m >= 5 && m <= 7) { name = 'Summer'; startY = y; startM = 5; }
    else if (m >= 8 && m <= 10) { name = 'Fall'; startY = y; startM = 8; }
    else { name = 'Winter'; startY = m === 11 ? y : y - 1; startM = 11; }
    const pad = (n) => String(n).padStart(2, '0');
    // Prior season start, for the "not enough new titles yet" fallback.
    const prevM = (startM + 9) % 12;
    const prevY = startM < 3 ? startY - 1 : startY;
    return {
        name,
        year: m === 11 ? y + 1 : (m <= 1 ? y : y), // winter is labelled by the year it ends in
        // MangaDex timestamps are YYYY-MM-DDTHH:MM:SS (no zone, no ms).
        since: `${startY}-${pad(startM + 1)}-01T00:00:00`,
        prevSince: `${prevY}-${pad(prevM + 1)}-01T00:00:00`,
    };
}
const SEASON = currentSeason();

export const NAV_TABS = [
    { key: 'featured', label: 'Explore', heading: 'Explore Manga' },
    { key: 'popular', label: 'Popular', heading: 'Popular Manga' },
    { key: 'recent-updates', label: 'Recent Updates', heading: 'Recent Updates' },
    { key: 'new-releases', label: 'New Releases', heading: 'New Releases' },
    { key: 'season', label: `${SEASON.name} Picks`, heading: `${SEASON.name} ${SEASON.year} Picks` },
];
export { SEASON };

// "featured" is the landing state, so it maps to the bare root URL rather
// than a redundant "?tab=featured".
export function tabHref(key) {
    return key === 'featured' ? '/' : `/?tab=${key}`;
}
