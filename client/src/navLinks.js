// Single source of truth for the app's "browse" destinations. GalleryPage
// renders these as its in-page pill tabs; SiteHeader/mobile nav surface the
// same destinations as persistent global navigation, so a visitor reading a
// manga's details or a chapter can jump straight to a tab without first
// navigating back to an unfiltered gallery.
export const NAV_TABS = [
    { key: 'featured', label: 'Explore', heading: 'Explore Manga' },
    { key: 'popular', label: 'Popular', heading: 'Popular Manga' },
    { key: 'recent-updates', label: 'Recent Updates', heading: 'Recent Updates' },
    { key: 'new-releases', label: 'New Releases', heading: 'New Releases' },
];

// "featured" is the landing state, so it maps to the bare root URL rather
// than a redundant "?tab=featured".
export function tabHref(key) {
    return key === 'featured' ? '/' : `/?tab=${key}`;
}
