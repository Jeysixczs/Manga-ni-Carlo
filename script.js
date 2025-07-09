// Manga ni Carlo: Refactored and Modular Manga Reader (Jeysixczs 2025-07-08)
// =================== DOM ELEMENTS ===================
const $ = (id) => document.getElementById(id);

// Main views & containers
const el = {
    mangaList: $('manga-list'),
    prevPageBtn: $('prev-page'),
    nextPageBtn: $('next-page'),
    pageInfo: $('page-info'),
    prevPageBtnBottom: $('prev-page-bottom'),
    nextPageBtnBottom: $('next-page-bottom'),
    pageInfoBottom: $('page-info-bottom'),
    searchInput: $('search-input'),
    searchBtn: $('search-btn'),
    clearSearchBtn: $('clear-search-btn'),
    searchSuggestions: $('search-suggestions'),
    toggleFiltersBtn: $('toggle-filters'),
    advancedFilters: $('advanced-filters'),
    statusFilter: $('status-filter'),
    yearFilter: $('year-filter'),
    ratingFilter: $('rating-filter'),
    sortFilter: $('sort-filter'),
    applyFiltersBtn: $('apply-filters'),
    resetFiltersBtn: $('reset-filters'),
    searchResultsInfo: $('search-results-info'),
    searchResultsText: $('search-results-text'),
    clearSearchResultsBtn: $('clear-search-results'),
    galleryView: $('gallery-view'),
    mangaDetailsView: $('manga-details-view'),
    chapterReaderView: $('chapter-reader-view'),
    loadingOverlay: $('loading-overlay'),
    backToGalleryBtn: $('back-to-gallery'),
    mangaDetailsTitle: $('manga-details-title'),
    mangaDetailsCover: $('manga-details-cover'),
    mangaStatus: $('manga-status'),
    mangaYear: $('manga-year'),
    mangaAuthor: $('manga-author'),
    mangaArtist: $('manga-artist'),
    mangaGenres: $('manga-genres'),
    mangaAltTitles: $('manga-alt-titles'),
    mangaFullDescription: $('manga-full-description'),
    mangaChaptersList: $('manga-chapters-list'),
    backToDetailsBtn: $('back-to-details'),
    chapterTitle: $('chapter-title'),
    chapterInfo: $('chapter-info'),
    chapterInfoBottom: $('chapter-info-bottom'),
    chapterPages: $('chapter-pages'),
    prevChapterBtn: $('prev-chapter'),
    nextChapterBtn: $('next-chapter'),
    prevChapterBtnBottom: $('prev-chapter-bottom'),
    nextChapterBtnBottom: $('next-chapter-bottom'),
    themeToggle: $('theme-toggle'),
    labels: $('labels'),
};

// =================== STATE ===================
const STATE = {
    page: 1,
    limit: 10,
    totalManga: 0,
    isLoading: false,
    currentManga: null,
    currentChapter: null,
    allChapters: [],
    currentChapterIndex: 0,
    currentTab: 'featured',
    randomOffset: 0,
    isSearchMode: false,
    currentSearchQuery: '',
    searchSuggestionsCache: new Map(),
    searchDebounceTimer: null,
    filtersActive: false,
    filters: {
        status: '',
        year: '',
        contentRating: 'safe,suggestive,erotica',
        sortBy: 'latestUploadedChapter'
    },
    featuredTotal: null // moved here to avoid undefined
};
const API = {
    MAX_LIMIT: 100,
    CHAPTER_LIMIT: 100,
    REQUEST_DELAY: 200,
    REQUEST_JITTER: 100
};
const PROXIES = [
    {
        name: 'api.codetabs.com',
        getApiUrl: (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
        getImageUrl: (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
        parse: (d) => d
    },
    {
        name: 'proxy.cors.sh',
        getApiUrl: (url) => `https://proxy.cors.sh/${url}`,
        getImageUrl: (url) => `https://proxy.cors.sh/${url}`,
        parse: (d) => d
    },
    {
        name: 'corsproxy.org',
        getApiUrl: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
        getImageUrl: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
        parse: (d) => d
    },
    {
        name: 'netlify-cors-proxy',
        getApiUrl: (url) => `https://cors-anywhere-netlify.herokuapp.com/${url}`,
        getImageUrl: (url) => `https://cors-anywhere-netlify.herokuapp.com/${url}`,
        parse: (d) => d
    }
];
let currentProxyIndex = 0;

// =================== UTILITIES ===================
function saveViewState(type, data = {}) {
    localStorage.setItem('currentView', type);
    if (type === 'details' && data.mangaId) {
        localStorage.setItem('currentMangaId', data.mangaId);
        // Save gallery context
        localStorage.setItem('galleryPage', STATE.page);
        localStorage.setItem('galleryTab', STATE.currentTab);
    } else if (type === 'reader' && data.mangaId && data.chapterId && typeof data.chapterIndex === 'number') {
        localStorage.setItem('currentMangaId', data.mangaId);
        localStorage.setItem('currentChapterId', data.chapterId);
        localStorage.setItem('currentChapterIndex', data.chapterIndex);
        // Save gallery context
        localStorage.setItem('galleryPage', STATE.page);
        localStorage.setItem('galleryTab', STATE.currentTab);
    } else if (type === 'tab' && data.tab) {
        localStorage.setItem('currentTab', data.tab);
    }
}

function clearViewState() {
    localStorage.removeItem('currentView');
    localStorage.removeItem('currentMangaId');
    localStorage.removeItem('currentChapterId');
    localStorage.removeItem('currentChapterIndex');
}
function escapeHTML(str) {
    if (typeof str !== 'string') str = String(str ?? '');
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showLoading(text = 'Loading...') {
    if (el.loadingOverlay) {
        //document.querySelector('.loading-text')?.textContent = text;
        el.loadingOverlay.classList.add('active');
    }
}
function hideLoading() {
    if (el.loadingOverlay) {
        el.loadingOverlay.classList.remove('active');
    }
}

function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    if (view) {
        view.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}
function createFallbackSVG(text, w = 300, h = 400) {
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#333"/><text x="50%" y="50%" font-family="Arial, sans-serif" font-size="16" fill="#ccc" text-anchor="middle" dominant-baseline="middle">${escapeHTML(text)}</text></svg>`;
    // btoa may fail on Unicode, so encodeURIComponent first
    function toBase64(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch {
            return btoa(str);
        }
    }
    return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function handleNetworkError(error, fallback = 'Network error occurred') {
    if (!error?.message) return fallback;
    if (error.message.includes('Failed to fetch')) return 'Unable to connect to server. Please check your internet connection.';
    if (error.message.includes('Rate limited')) return 'Too many requests. Please wait a moment and try again.';
    if (error.message.includes('timeout')) return 'Request timed out. Please try again.';
    if (error.message.includes('proxy')) return 'Connection service unavailable. Please try again later.';
    return fallback;
}

function safeJSONParse(text) {
    try { return JSON.parse(text); }
    catch {
        try {
            const unquoted = text.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
            return JSON.parse(unquoted);
        } catch {
            try {
                const jsonMatch = text.match(/\{.*\}/s);
                if (jsonMatch) return JSON.parse(jsonMatch[0]);
            } catch (e3) {
                if (text.includes('<!DOCTYPE') || text.includes('<html')) throw new Error('Received HTML instead of JSON');
                if (text.includes('Rate limit') || text.includes('Too Many Requests')) throw new Error('Rate limited by proxy');
                if (text.includes('limit query param may not be')) throw new Error('API limit parameter exceeded');
            }
        }
    }
    // Instead of throwing, return null and let caller handle
    return null;
}

// =================== PROXY NETWORK ===================
let requestQueue = [], isProcessingQueue = false;
function getCurrentProxy() { return PROXIES[currentProxyIndex]; }
function switchToNextProxy() { currentProxyIndex = (currentProxyIndex + 1) % PROXIES.length; }
async function processRequestQueue() {
    if (isProcessingQueue || !requestQueue.length) return;
    isProcessingQueue = true;
    while (requestQueue.length) {
        const { resolve, reject, url, options } = requestQueue.shift();
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 429) {
                    await new Promise(r => setTimeout(r, 3000)); // Wait longer on 429
                    requestQueue.unshift({ resolve, reject, url, options });
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            resolve(response);
        } catch (error) {
            reject(error);
        }
        if (requestQueue.length) {
            // Add random jitter to avoid being detected as a bot
            const jitter = Math.floor(Math.random() * API.REQUEST_JITTER);
            await new Promise(r => setTimeout(r, API.REQUEST_DELAY + jitter));
        }
    }
    isProcessingQueue = false;
}
function safeFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const fetchOpt = {
            method: 'GET',
            ...options,
            headers: {
                'User-Agent': 'Manga ni Carlo/1.0 (Jeysixczs)',
                'Accept': 'application/json',
                ...options.headers
            }
        };
        requestQueue.push({ resolve, reject, url, options: fetchOpt });
        processRequestQueue();
    });
}
async function fetchWithProxy(url, isImage = false) {
    let lastError = null, allProxiesFailed = false;
    for (let attempt = 0; attempt < PROXIES.length; attempt++) {
        const proxyIndex = (currentProxyIndex + attempt) % PROXIES.length;
        const proxy = PROXIES[proxyIndex];
        const proxyUrl = isImage ? proxy.getImageUrl(url) : proxy.getApiUrl(url);
        try {
            const response = await safeFetch(proxyUrl);
            if (isImage) { currentProxyIndex = proxyIndex; return proxyUrl; }
            const text = await response.text();
            if (
                text.includes('Rate limit') || text.includes('Too Many Requests') ||
                text.includes('limit reached') || text.includes('Please create an account at https://accounts.corsproxy.io') ||
                text.includes('You have exceeded your request quota')
            ) throw new Error('Rate limit reached');
            if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) throw new Error('Received HTML response instead of JSON');
            const data = safeJSONParse(text);
            if (!data) throw new Error('Invalid JSON from API');
            const parsedData = proxy.parse(data);
            currentProxyIndex = proxyIndex;
            return parsedData;
        } catch (error) {
            lastError = error;
        }
    }
    allProxiesFailed = true;
    if (allProxiesFailed) {
        throw new Error('All proxy services failed or banned. Please try again later.');
    }
    throw lastError || new Error('All proxy services failed');
}

// =================== API HELPERS ===================

function handlePaginationForCurrentTab() {
    if (STATE.isSearchMode) {
        performSearch(STATE.page);
        return;
    }
    switch (STATE.currentTab) {
        case 'featured':
            renderRandomMangaList(STATE.page);
            break;
        case 'popular':
            renderPopularMangaList(STATE.page);
            break;
        case 'recent-updates':
            renderRecentUpdatesList(STATE.page);
            break;
        case 'new-releases':
            renderNewReleasesList(STATE.page);
            break;
        default:
            renderMangaList(STATE.page);
    }
}

function getMainTitle(attr) {
    if (!attr?.title) return 'No Title';
    const t = attr.title;
    return t.en || t['en-us'] || t.romaji || Object.values(t)[0] || 'No Title';
}
function getAltTitles(attr) {
    return (attr?.altTitles ?? [])
        .map(t => Object.values(t)[0])
        .filter(Boolean)
        .slice(0, 5)
        .join(' • ');
}
function getDescription(attr) {
    const d = attr?.description ?? {};
    return d.en || d['en-us'] || Object.values(d)[0] || '';
}
function buildSearchUrl(query = '', page = 1, filters = {}) {
    const offset = (page - 1) * STATE.limit;
    const base = 'https://api.mangadex.org/manga';
    const p = new URLSearchParams({ limit: STATE.limit, offset, 'hasAvailableChapters': 'true' });
    p.append('includes[]', 'cover_art');
    p.append('includes[]', 'author');
    p.append('includes[]', 'artist');
    if (query) p.append('title', query);
    (filters.contentRating || 'safe,suggestive,erotica').split(',').forEach(r => p.append('contentRating[]', r.trim()));
    if (filters.status) p.append('status[]', filters.status);
    if (filters.year) p.append('year', filters.year);
    const sortBy = filters.sortBy || 'latestUploadedChapter';
    if (sortBy === 'relevance' && !query) p.append('order[latestUploadedChapter]', 'desc');
    else if (sortBy === 'relevance') p.append('order[relevance]', 'desc');
    else p.append(`order[${sortBy}]`, 'desc');
    return `${base}?${p.toString()}`;
}
function populateYearFilter() {
    if (!el.yearFilter) return;

    const y = new Date().getFullYear();
    for (let i = y; i >= 1950; i--) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        el.yearFilter.appendChild(opt);
    }
}


// =================== API CALLS ===================
async function fetchMangaList(page) {
    const offset = (page - 1) * STATE.limit;
    const apiUrl = `https://api.mangadex.org/manga?limit=${STATE.limit}&offset=${offset}&includes[]=cover_art&includes[]=author&includes[]=artist&order[latestUploadedChapter]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;
    if (STATE.limit > API.MAX_LIMIT) throw new Error(`Limit ${STATE.limit} exceeds maximum allowed ${API.MAX_LIMIT}`);
    const data = await fetchWithProxy(apiUrl);
    if (!data?.data?.length) throw new Error('Invalid manga data structure');
    return { data: data.data, total: data.total ?? 0 };
}
async function fetchMangaDetails(mangaId) {
    const apiUrl = `https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const data = await fetchWithProxy(apiUrl);
    if (!data?.data) throw new Error('Invalid manga details response');
    return data.data;
}
async function fetchChapters(mangaId, offset = 0, limit = API.CHAPTER_LIMIT) {
    // Only fetch one page of chapters at a time!
    const apiUrl = `https://api.mangadex.org/chapter?manga=${mangaId}&limit=${limit}&offset=${offset}&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
    const data = await fetchWithProxy(apiUrl);
    const chaps = Array.isArray(data.data) ? data.data : [];
    const total = data.total ?? 0;
    return { chapters: chaps, total };
}

async function fetchChapterPages(chapterId) {
    const apiUrl = `https://api.mangadex.org/at-home/server/${chapterId}`;
    try {
        const data = await fetchWithProxy(apiUrl);
        if (!data?.chapter) throw new Error('Invalid chapter pages response');
        let pages = Array.isArray(data.chapter.data) && data.chapter.data.length > 0
            ? data.chapter.data
            : (Array.isArray(data.chapter.dataSaver) && data.chapter.dataSaver.length > 0
                ? data.chapter.dataSaver
                : null);
        let usingDataSaver = false;
        if (!pages) throw new Error('No pages available for this chapter (both data and data-saver empty)');
        if (!data.chapter.data?.length) usingDataSaver = true;
        return { ...data, _pages: pages, _usingDataSaver: usingDataSaver };
    } catch (error) {
        if (
            error.message.includes('Network error') ||
            error.message.includes('proxy') ||
            error.message.includes('Failed to fetch') ||
            error.message.includes('timeout')
        ) {
            switchToNextProxy();
            const d = await fetchWithProxy(apiUrl);
            let pages = Array.isArray(d.chapter.data) && d.chapter.data.length > 0
                ? d.chapter.data
                : (Array.isArray(d.chapter.dataSaver) && d.chapter.dataSaver.length > 0
                    ? d.chapter.dataSaver
                    : null);
            let usingDataSaver = !d.chapter.data?.length;
            if (!pages) throw new Error('No pages available for this chapter (both data and data-saver empty)');
            return { ...d, _pages: pages, _usingDataSaver: usingDataSaver };
        }
        throw new Error('Failed to load chapter pages: ' + error.message);
    }
}
async function getCoverUrl(manga) {
    const coverRel = manga?.relationships?.find(r => r.type === 'cover_art');
    if (!coverRel) return null;
    let fileName = coverRel.attributes?.fileName;
    if (!fileName && coverRel.id) {
        const data = await fetchWithProxy(`https://api.mangadex.org/cover/${coverRel.id}`);
        fileName = data?.data?.attributes?.fileName;
    }
    if (!fileName) return null;
    const directUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}`;
    return getProxiedImageUrl(directUrl);
}
function getProxiedImageUrl(url) {
    const proxy = PROXIES[currentProxyIndex];
    return proxy.getImageUrl(url);
}

// =================== UI CREATORS ===================
function createImageElement(src, alt, mangaId) {
    const img = document.createElement('img');
    img.className = 'manga-cover';
    img.alt = alt;
    img.loading = 'lazy';
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.3s ease';
    img.style.backgroundColor = '#333';
    let loaded = false;
    img.onload = () => { if (!loaded) { loaded = true; img.style.opacity = '1'; } };
    img.onerror = () => { if (!loaded) { loaded = true; img.src = createFallbackSVG('No Cover Available'); img.style.opacity = '1'; } };
    img.src = src ?? createFallbackSVG('No Cover Available');
    return img;
}
async function createCoverElement(manga, title) {
    const coverUrl = await getCoverUrl(manga);
    return createImageElement(coverUrl, title, manga.id);
}
async function createMangaCard(manga) {
    if (!manga?.id) return null;
    const attr = manga.attributes || {};
    const title = getMainTitle(attr);
    const altTitles = getAltTitles(attr);
    const desc = getDescription(attr);
    const shortDesc = desc.length > 180 ? `${desc.substring(0, 180)}...` : desc || 'No description available.';
    const card = document.createElement('div');
    card.className = 'manga-card';
    card.setAttribute('data-manga-id', manga.id);
    const coverElement = await createCoverElement(manga, title);
    const infoDiv = document.createElement('div');
    infoDiv.className = 'manga-info';
    infoDiv.innerHTML = `
        <div class="manga-title">${escapeHTML(title)}</div>
        ${altTitles ? `<div class="manga-alt">${escapeHTML(altTitles)}</div>` : ''}
        <div class="manga-desc">${escapeHTML(shortDesc)}</div>
    `;
    card.appendChild(coverElement);
    card.appendChild(infoDiv);
    card.addEventListener('click', () => showMangaDetails(manga.id));
    return card;
}

// =================== MAIN RENDERERS ===================
async function renderMangaList(page) {
    if (STATE.isLoading) return;
    STATE.isLoading = true;
    el.mangaList.innerHTML = '<div class="loading">Loading manga collection...</div>';
    try {
        const { data: mangaList, total } = await fetchMangaList(page);
        STATE.totalManga = total;
        if (!mangaList.length) {
            el.mangaList.innerHTML = '<div class="error">No manga found for this page.</div>';
            updatePaginationInfo(page, total);
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(mangaList, el.mangaList, 4);
        updatePaginationInfo(page, total);
    } catch (err) {
        el.mangaList.innerHTML = `<div class="error">Failed to load manga collection<br><small>${escapeHTML(err.message)}</small><br><br><button onclick="location.reload()">Reload Page</button></div>`;
    } finally {
        STATE.isLoading = false;
    }
}
async function batchCards(list, container, batchSize = 20) {
    for (let i = 0; i < list.length; i += batchSize) {
        const batch = list.slice(i, i + batchSize);
        const cards = await Promise.all(batch.map(manga => createMangaCard(manga)));
        cards.forEach(card => { if (card) container.appendChild(card); });
    }
}

// =================== SEARCH ===================
async function fetchSearchSuggestions(query) {
    if (!query || query.length < 2) return [];
    if (STATE.searchSuggestionsCache.has(query)) return STATE.searchSuggestionsCache.get(query);
    const url = buildSearchUrl(query, 1, { ...STATE.filters, sortBy: 'relevance' });
    const data = await fetchWithProxy(url);
    const suggestions = (data?.data ?? []).slice(0, 5).map(manga => {
        const attr = manga.attributes || {};
        const author = manga.relationships?.find(r => r.type === 'author')?.attributes?.name || 'Unknown';
        return { title: getMainTitle(attr), author, type: 'manga', id: manga.id };
    });
    STATE.searchSuggestionsCache.set(query, suggestions);
    pruneSearchSuggestionsCache(); // <-- Limit cache size!
    return suggestions;
}
function showSearchSuggestions(suggestions) {
    if (!suggestions?.length) { el.searchSuggestions.style.display = 'none'; return; }
    el.searchSuggestions.innerHTML = '';
    suggestions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `<span class="suggestion-icon">📚</span><span class="suggestion-text">${escapeHTML(s.title)}</span><span class="suggestion-meta">${escapeHTML(s.author)}</span>`;
        item.addEventListener('click', () => {
            el.searchInput.value = s.title;
            el.searchSuggestions.style.display = 'none';
            performSearch();
        });
        el.searchSuggestions.appendChild(item);
    });
    el.searchSuggestions.style.display = 'block';
}
function pruneSearchSuggestionsCache(maxEntries = 200) {
    while (STATE.searchSuggestionsCache.size > maxEntries) {
        // Delete oldest entry (Maps preserve insertion order)
        const firstKey = STATE.searchSuggestionsCache.keys().next().value;
        STATE.searchSuggestionsCache.delete(firstKey);
    }
}
function hideSearchSuggestions() { el.searchSuggestions.style.display = 'none'; }
function updateSearchResultsInfo(query, total, page) {
    const hasQuery = query && query.trim();
    const hasFilters = Object.values(STATE.filters).some(f => f && f !== 'safe,suggestive,erotica' && f !== 'latestUploadedChapter');
    let infoText = '';
    if (hasQuery && hasFilters) infoText = `Found ${total} results for "${query}" with filters`;
    else if (hasQuery) infoText = `Found ${total} results for "${query}"`;
    else if (hasFilters) infoText = `Found ${total} results with filters`;
    else { el.searchResultsInfo.style.display = 'none'; return; }
    el.searchResultsText.textContent = infoText;
    el.searchResultsInfo.style.display = 'flex';
    el.searchResultsText.style.marginRight = '10px';
}
function clearSearch() {
    STATE.isSearchMode = false;
    STATE.currentSearchQuery = '';
    el.searchInput.value = '';
    el.clearSearchBtn.style.display = 'none';
    el.searchResultsInfo.style.display = 'none';
    hideSearchSuggestions();
    STATE.page = 1;
    STATE.currentTab = 'featured';
    saveViewState('tab', { tab: 'featured' });
    clearViewState();
    loadFeaturedContent();
}

function resetFilters() {
    STATE.filters = { status: '', year: '', contentRating: 'safe,suggestive,erotica', sortBy: 'latestUploadedChapter' };
    el.statusFilter.value = '';
    el.yearFilter.value = '';
    el.ratingFilter.value = 'safe,suggestive,erotica';
    el.sortFilter.value = 'latestUploadedChapter';
    STATE.filtersActive = false;
    el.toggleFiltersBtn.classList.remove('active');
    if (STATE.isSearchMode) performSearch(1);
}
function applyFilters() {
    STATE.filters = {
        status: el.statusFilter.value,
        year: el.yearFilter.value,
        contentRating: el.ratingFilter.value,
        sortBy: el.sortFilter.value
    };
    STATE.filtersActive = Object.values(STATE.filters).some(f => f && f !== 'safe,suggestive,erotica' && f !== 'latestUploadedChapter');
    if (STATE.filtersActive) el.toggleFiltersBtn.classList.add('active');
    else el.toggleFiltersBtn.classList.remove('active');
    if (STATE.isSearchMode || STATE.filtersActive) performSearch(1);
    else renderMangaList(1);
}
async function performSearch(page = 1) {
    // Always use the currentSearchQuery for paging, not the current input value!
    const query =
        typeof STATE.currentSearchQuery === "string"
            ? STATE.currentSearchQuery
            : el.searchInput.value.trim();

    // If this is a new search (i.e. not via Next/Prev), update currentSearchQuery
    if (page === 1) {
        STATE.currentSearchQuery = el.searchInput.value.trim();
    }

    // Use the most up-to-date query
    const activeQuery = page === 1 ? STATE.currentSearchQuery : query;

    if (!activeQuery && !STATE.filtersActive) { clearSearch(); return; }
    STATE.isSearchMode = true;
    STATE.page = page;

    try {
        const url = buildSearchUrl(activeQuery, page, STATE.filters);
        const data = await fetchWithProxy(url);
        STATE.totalManga = data.total || 0;
        updateSearchResultsInfo(activeQuery, STATE.totalManga, page);
        if (activeQuery) el.clearSearchBtn.style.display = 'flex';
        if (!data.data?.length) {
            el.mangaList.innerHTML = `<div class="error" style="grid-column: 1 / -1;"><h3>No manga found</h3><p>Try adjusting your search terms or filters</p></div>`;
            updatePaginationInfo(page, STATE.totalManga);
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(data.data, el.mangaList, 4);
        updatePaginationInfo(page, STATE.totalManga);
        hideSearchSuggestions();
    } catch (error) {
        el.mangaList.innerHTML = `<div class="error" style="grid-column: 1 / -1;">Search failed: ${escapeHTML(error.message)}<br><br><button onclick="clearSearch()">Return to Browse</button></div>`;
    } finally { hideLoading(); }
}

// =================== DETAILS/READER ===================
async function showMangaDetails(mangaId) {
    saveViewState('details', { mangaId }); // Save state
    const mangaDetails = await fetchMangaDetails(mangaId);
    await new Promise(r => setTimeout(r, 300));

    const { chapters, total } = await fetchChapters(mangaId, 0, API.CHAPTER_LIMIT);
    STATE.currentManga = mangaDetails;
    STATE.allChapters = chapters;
    STATE.totalChapters = total;
    const attr = mangaDetails.attributes || {};
    el.mangaDetailsTitle.textContent = getMainTitle(attr);
    try {
        const coverUrl = await getCoverUrl(mangaDetails);
        if (coverUrl) {
            el.mangaDetailsCover.src = coverUrl;
            el.mangaDetailsCover.style.display = 'block';
            el.mangaDetailsCover.onload = function () {
                const img = this, ratio = img.naturalWidth / img.naturalHeight;
                img.classList.remove('wide', 'tall');
                if (ratio < 0.6) img.classList.add('tall');
                else if (ratio > 0.8) img.classList.add('wide');
            };
            el.mangaDetailsCover.onerror = function () { this.style.display = 'none'; };
        } else el.mangaDetailsCover.style.display = 'none';
    } catch { el.mangaDetailsCover.style.display = 'none'; }
    el.mangaStatus.textContent = attr.status || 'Unknown';
    el.mangaYear.textContent = attr.year || 'Unknown';
    const authorRel = mangaDetails.relationships?.find(r => r.type === 'author');
    const artistRel = mangaDetails.relationships?.find(r => r.type === 'artist');
    el.mangaAuthor.textContent = authorRel?.attributes?.name || 'Unknown';
    el.mangaArtist.textContent = artistRel?.attributes?.name || 'Unknown';
    const tags = attr.tags || [];
    const genres = tags.filter(t => t.attributes?.group === 'genre').map(t => t.attributes?.name?.en || 'Unknown').join(', ');
    el.mangaGenres.textContent = genres || 'Unknown';
    el.mangaAltTitles.textContent = getAltTitles(attr) || 'No alternative titles';
    el.mangaFullDescription.textContent = getDescription(attr) || 'No description available';
    renderChaptersList(chapters);
    hideLoading();
    showView(el.mangaDetailsView);
}

function renderChaptersList(chapters) {
    const total = STATE.totalChapters || chapters.length;
    if (!chapters?.length) {
        el.mangaChaptersList.innerHTML = '<div class="error">No chapters available</div>';
        return;
    }
    el.mangaChaptersList.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'chapter-list-header';
    header.textContent = `${total} Chapters Available`;
    el.mangaChaptersList.appendChild(header);
    chapters.forEach((c, idx) => {
        const a = c.attributes || {};
        const chapterNum = a.chapter ? `Ch. ${a.chapter}` : 'Oneshot';
        const chapterTitle = a.title ? `: ${escapeHTML(a.title)}` : '';
        const volume = a.volume ? `Vol. ${escapeHTML(a.volume)}` : '';
        const pages = a.pages ? `${a.pages} pages` : '';
        const publishDate = a.publishAt ? new Date(a.publishAt).toLocaleDateString() : '';
        const div = document.createElement('div');
        div.className = 'chapter-item';
        div.innerHTML = `<span class="chapter-title">${chapterNum}${chapterTitle}</span><span class="chapter-meta">${volume} • ${pages} • ${publishDate}</span>`;
        div.addEventListener('click', () => showChapterReader(c, idx));
        el.mangaChaptersList.appendChild(div);
    });
    if (total > chapters.length) {
        const loadMore = document.createElement('button');
        loadMore.textContent = 'Load More Chapters';
        loadMore.className = 'load-more-chapters';
        loadMore.onclick = async () => {
            loadMore.disabled = true;
            const more = await fetchChapters(STATE.currentManga.id, STATE.allChapters.length, API.CHAPTER_LIMIT);
            STATE.allChapters.push(...more.chapters);
            renderChaptersList(STATE.allChapters); // no need to pass total
        };
        el.mangaChaptersList.appendChild(loadMore);
    }
}

async function showChapterReader(chapter, idx) {
    const mangaId = STATE.currentManga?.id || chapter.mangaId;
    saveViewState('reader', { mangaId, chapterId: chapter.id, chapterIndex: idx }); // Save state

    STATE.currentChapter = chapter;
    STATE.currentChapterIndex = idx;
    const chapterData = await fetchChapterPages(chapter.id);
    const a = chapter.attributes || {};
    const chapterNum = a.chapter ? `Chapter ${a.chapter}` : 'Oneshot';
    const chapterTitleText = a.title ? `: ${a.title}` : '';
    el.chapterTitle.textContent = `${chapterNum}${chapterTitleText}`;
    el.chapterInfo.textContent = chapterNum;
    el.chapterInfoBottom.textContent = chapterNum;
    updateChapterNavigation();
    renderChapterPages(chapterData);

    // After rendering pages, scroll to last-read page and track
    setupPageViewTracking(chapter.id);

    hideLoading();
    showView(el.chapterReaderView);
    setupSmartHeader();
    // Do NOT scroll to top, let the observer scroll to last page instead.
}
function saveLastReadPage(chapterId, pageIdx) {
    if (!chapterId) return;
    localStorage.setItem(`readerPage_${chapterId}`, String(pageIdx));
}

// Restore last-read page index from localStorage
function getLastReadPage(chapterId) {
    if (!chapterId) return 0;
    const val = localStorage.getItem(`readerPage_${chapterId}`);
    if (val && !isNaN(val)) return parseInt(val, 10);
    return 0;
}
function setupPageViewTracking(chapterId) {
    // Clean up previous observer if exists
    if (window._readerPageObserver) window._readerPageObserver.disconnect();

    const pageContainers = Array.from(el.chapterPages.querySelectorAll('.page-container'));
    if (!pageContainers.length) return;

    let lastPageIdx = getLastReadPage(chapterId);

    // Scroll to last-read page
    setTimeout(() => {
        if (pageContainers[lastPageIdx]) {
            pageContainers[lastPageIdx].scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    }, 10);

    // Use IntersectionObserver to save as user scrolls
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const idx = pageContainers.indexOf(entry.target);
                if (idx !== -1) {
                    saveLastReadPage(chapterId, idx);
                }
            }
        });
    }, {
        threshold: 0.6 // More than half the page is visible
    });

    pageContainers.forEach(pc => observer.observe(pc));
    window._readerPageObserver = observer;
}
function renderChapterPages(chapterData) {
    let pages = Array.isArray(chapterData._pages) ? chapterData._pages : [];
    if (!pages.length) { el.chapterPages.innerHTML = '<div class="error">No pages available for this chapter</div>'; return; }
    el.chapterPages.innerHTML = '';
    const baseUrl = chapterData.baseUrl, chapterHash = chapterData.chapter.hash, usingDataSaver = chapterData._usingDataSaver || false;
    pages.forEach((pg, idx) => {
        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        const pageImg = document.createElement('img');
        pageImg.className = 'page-image';
        pageImg.alt = `Page ${idx + 1}`;
        pageImg.loading = 'lazy';
        const urlPart = usingDataSaver ? 'data-saver' : 'data';
        const directUrl = `${baseUrl}/${urlPart}/${chapterHash}/${pg}`;
        pageImg.src = getProxiedImageUrl(directUrl);
        pageImg.onerror = () => { pageImg.src = createFallbackSVG(`Failed to load page ${idx + 1}`, 600, 800); };
        pageContainer.appendChild(pageImg);
        el.chapterPages.appendChild(pageContainer);
    });
    if (usingDataSaver) {
        const warn = document.createElement('div');
        warn.className = 'warning'; warn.style.color = '#ffb300'; warn.style.margin = '10px 0'; warn.style.textAlign = 'center';
        warn.textContent = 'Note: Low quality images (data-saver) are shown for this chapter.';
        el.chapterPages.prepend(warn);
    }
}
function updateChapterNavigation() {
    const hasPrev = STATE.currentChapterIndex > 0, hasNext = STATE.currentChapterIndex < STATE.allChapters.length - 1;
    [el.prevChapterBtn, el.prevChapterBtnBottom].forEach(btn => btn && (btn.disabled = !hasPrev));
    [el.nextChapterBtn, el.nextChapterBtnBottom].forEach(btn => btn && (btn.disabled = !hasNext));
}
function updatePaginationInfo(page, total) {
    const maxPages = Math.max(1, Math.ceil(total / STATE.limit));
    const pageText = `Page ${page} of ${maxPages}`;
    if (el.pageInfo) el.pageInfo.textContent = pageText;
    if (el.pageInfoBottom) el.pageInfoBottom.textContent = pageText;
    const isFirst = page <= 1, isLast = page >= maxPages;
    [el.prevPageBtn, el.prevPageBtnBottom].forEach(btn => btn && (btn.disabled = isFirst));
    [el.nextPageBtn, el.nextPageBtnBottom].forEach(btn => btn && (btn.disabled = isLast));
}

// =================== TABS ===================
function setupTabNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            if (STATE.isLoading) return;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            STATE.currentTab = tab.dataset.view;
            saveViewState('tab', { tab: STATE.currentTab }); // Save tab state
            clearViewState(); // Clear any detail/reader state
            STATE.isSearchMode = false;
            STATE.currentSearchQuery = '';
            if (el.searchInput) el.searchInput.value = '';
            if (el.clearSearchBtn) el.clearSearchBtn.style.display = 'none';
            if (el.searchResultsInfo) el.searchResultsInfo.style.display = 'none';
            hideSearchSuggestions();
            STATE.page = 1;
            try {
                switch (STATE.currentTab) {
                    case 'featured': await loadFeaturedContent(); break;
                    case 'popular': await renderPopularMangaList(1); break;
                    case 'recent-updates': await renderRecentUpdatesList(1); break;
                    case 'new-releases': await renderNewReleasesList(1); break;
                    default: await loadFeaturedContent();
                }
            } catch (error) {
                handleTabError(error);
            }
        });
    });
}


// Add this to the STATE object at the top:
STATE.featuredTotal = null;

// Replace your loadFeaturedContent with this:
async function loadFeaturedContent() {

    resetFiltersToDefault();

    // Use cached total if available, else fetch it
    let total = STATE.featuredTotal || 5000;
    let fetchedTotal = false;

    if (!STATE.featuredTotal) {
        try {
            const countUrl = 'https://api.mangadex.org/manga?limit=1&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true';
            const countData = await fetchWithProxy(countUrl);
            total = countData.total || 5000;
            STATE.featuredTotal = total;
            fetchedTotal = true;
        } catch {
            // Ignore count fetch errors, fallback to 5000
            total = 5000;
        }
    }

    STATE.randomOffset = Math.floor(Math.random() * Math.max(1, Math.min(total, 10000 - 10)));
    const apiUrl = `https://api.mangadex.org/manga?limit=10&offset=${STATE.randomOffset}&includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;

    try {
        const data = await fetchWithProxy(apiUrl);
        STATE.totalManga = data.total || 0;
        el.mangaList.innerHTML = '';
        if (!data.data?.length) {
            el.mangaList.innerHTML = '<div class="error-message">No random manga found</div>';
            updatePaginationInfo(1, 0);
            hideLoading();
            return;
        }
        await batchCards(data.data, el.mangaList, 1);
        updatePaginationInfo(1, STATE.totalManga);
    } catch (error) {
        el.mangaList.innerHTML = `<div class="error">Failed to load random manga: ${escapeHTML(error.message)}</div>`;
    } finally {
        hideLoading();
    }
}
async function fetchRandomMangaList(page) {
    const offset = STATE.randomOffset + ((page - 1) * STATE.limit);
    const apiUrl = `https://api.mangadex.org/manga?limit=${STATE.limit}&offset=${offset}&includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;
    const data = await fetchWithProxy(apiUrl);
    return { data: data.data, total: data.total || 0 };
}
async function renderPopularMangaList(page) {
    if (STATE.isLoading) return;
    if (!STATE.limit || STATE.limit > 100) STATE.limit = 10;
    STATE.isLoading = true;
    el.mangaList.innerHTML = '<div class="loading">Loading popular manga...</div>';
    try {
        const offset = (page - 1) * STATE.limit;
        const apiUrl = `https://api.mangadex.org/manga?limit=${STATE.limit}&offset=${offset}&includes[]=cover_art&includes[]=author&includes[]=artist&order[followedCount]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;

        const data = await fetchWithProxy(apiUrl);
        STATE.totalManga = data.total || 0;
        if (!data.data?.length) {
            el.mangaList.innerHTML = '<div class="error-message">No popular manga found</div>';
            updatePaginationInfo(page, 0);
            hideLoading();
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(data.data, el.mangaList, 4);
        updatePaginationInfo(page, STATE.totalManga);
    } catch (error) {
        console.error("Error fetching popular manga:", error);
        el.mangaList.innerHTML = `<div class="error">Failed to load popular manga: ${escapeHTML(error.message)}</div>`;
    } finally {
        STATE.isLoading = false;
        hideLoading();
    }
}

async function renderRecentUpdatesList(page) {
    if (STATE.isLoading) return;
    STATE.isLoading = true;
    el.mangaList.innerHTML = '<div class="loading">Loading recent updates...</div>';
    try {
        const offset = (page - 1) * STATE.limit;
        const apiUrl = `https://api.mangadex.org/manga?limit=${STATE.limit}&offset=${offset}&includes[]=cover_art&includes[]=author&includes[]=artist&order[latestUploadedChapter]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;
        const data = await fetchWithProxy(apiUrl);
        STATE.totalManga = data.total || 0;
        if (!data.data?.length) {
            el.mangaList.innerHTML = '<div class="error-message">No recent updates found</div>';
            updatePaginationInfo(page, 0);
            hideLoading();
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(data.data, el.mangaList, 4);
        updatePaginationInfo(page, STATE.totalManga);
    } catch (error) {
        el.mangaList.innerHTML = `<div class="error">Failed to load recent updates: ${escapeHTML(error.message)}</div>`;
    } finally {
        STATE.isLoading = false;
        hideLoading();
    }
}

async function renderNewReleasesList(page) {
    if (STATE.isLoading) return;
    STATE.isLoading = true;
    el.mangaList.innerHTML = '<div class="loading">Loading new releases...</div>';
    try {
        const offset = (page - 1) * STATE.limit;
        const apiUrl = `https://api.mangadex.org/manga?limit=${STATE.limit}&offset=${offset}&includes[]=cover_art&includes[]=author&includes[]=artist&order[createdAt]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&hasAvailableChapters=true`;
        const data = await fetchWithProxy(apiUrl);
        STATE.totalManga = data.total || 0;
        if (!data.data?.length) {
            el.mangaList.innerHTML = '<div class="error-message">No new releases found</div>';
            updatePaginationInfo(page, 0);
            hideLoading();
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(data.data, el.mangaList, 4);
        updatePaginationInfo(page, STATE.totalManga);
    } catch (error) {
        el.mangaList.innerHTML = `<div class="error">Failed to load new releases: ${escapeHTML(error.message)}</div>`;
    } finally {
        STATE.isLoading = false;
        hideLoading();
    }
}
function resetFiltersToDefault() {
    STATE.filters = { status: '', year: '', contentRating: 'safe,suggestive,erotica', sortBy: 'latestUploadedChapter' };
    try {
        if (el.statusFilter) el.statusFilter.value = '';
        if (el.yearFilter) el.yearFilter.value = '';
        if (el.ratingFilter) el.ratingFilter.value = 'safe,suggestive,erotica';
        if (el.sortFilter) el.sortFilter.value = 'latestUploadedChapter';
        STATE.filtersActive = false;
        if (el.toggleFiltersBtn) el.toggleFiltersBtn.classList.remove('active');
    } catch { }
}
function handleTabError(error) {
    hideLoading();
    let errorMessage = handleNetworkError(error);
    if (el.mangaList) {
        el.mangaList.innerHTML = `
            <div class="error" style="grid-column: 1 / -1;">
                <h3>Loading Failed</h3>
                <p>${errorMessage}</p>
                <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">Reload Page</button>
            </div>
        `;
    }
}

// =================== HEADER ===================
function setupSmartHeader() {
    const readerHeader = document.querySelector('.reader-header');
    if (!readerHeader) return;
    const SCROLL_THRESHOLD = 100, SCROLL_UP_THRESHOLD = 500, HIDE_DELAY = 2000, SHOW_DELAY = 300;
    let lastPos = window.scrollY, isVisible = true, scrollTimeout = null, scrollUpStart = 0, isScrollingUp = false;
    function resetHeaderVisibility() {
        clearTimeout(scrollTimeout);
        readerHeader.classList.remove('hidden');
        isVisible = true;
    }
    window.addEventListener('scroll', () => {
        const curr = window.scrollY, diff = lastPos - curr;
        if (scrollTimeout) clearTimeout(scrollTimeout);
        if (curr > lastPos && curr > SCROLL_THRESHOLD) {
            isScrollingUp = false;
            if (isVisible) {
                scrollTimeout = setTimeout(() => {
                    readerHeader.classList.add('hidden'); isVisible = false;
                }, 100);
            }
        } else if (diff > 0) {
            if (!isScrollingUp) { scrollUpStart = curr; isScrollingUp = true; }
            if (!isVisible && (scrollUpStart - curr) > SCROLL_UP_THRESHOLD) {
                scrollTimeout = setTimeout(() => {
                    readerHeader.classList.remove('hidden');
                    isVisible = true;
                    scrollTimeout = setTimeout(() => {
                        if (window.scrollY > SCROLL_THRESHOLD) {
                            readerHeader.classList.add('hidden'); isVisible = false;
                        }
                    }, HIDE_DELAY);
                }, SHOW_DELAY);
            }
        }
        lastPos = curr;
    });
    document.addEventListener('mousemove', (e) => { if (e.clientY < 100 && !isVisible) resetHeaderVisibility(); });
    resetHeaderVisibility();
}

// =================== THEME ===================
function setupThemeToggle() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const currentTheme = localStorage.getItem('theme') || (prefersDark.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon(currentTheme);
    el.themeToggle.addEventListener('click', () => {
        const curr = document.documentElement.getAttribute('data-theme');
        const next = curr === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon(next);
    });
    prefersDark.addListener((e) => {
        if (!localStorage.getItem('theme')) {
            const next = e.matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            updateThemeIcon(next);
        }
    });
}
function updateThemeIcon(theme) {
    if (!el.themeToggle) return;
    el.themeToggle.innerHTML = theme === 'dark' ?
        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>` :
        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>`;
}

// =================== EVENTS ===================
function setupEventListeners() {
    if (el.searchInput) {
        el.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (STATE.searchDebounceTimer) clearTimeout(STATE.searchDebounceTimer);
            if (query.length < 2) { hideSearchSuggestions(); return; }
            STATE.searchDebounceTimer = setTimeout(async () => {
                try { showSearchSuggestions(await fetchSearchSuggestions(query)); }
                catch { hideSearchSuggestions(); }
            }, 300);
        });
        el.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); hideSearchSuggestions(); performSearch(1); }
            else if (e.key === 'Escape') hideSearchSuggestions();
        });
        el.searchInput.addEventListener('blur', () => setTimeout(hideSearchSuggestions, 200));
    }
    if (el.searchBtn) el.searchBtn.addEventListener('click', () => { hideSearchSuggestions(); performSearch(1); });
    if (el.clearSearchBtn) el.clearSearchBtn.addEventListener('click', clearSearch);
    if (el.clearSearchResultsBtn) el.clearSearchResultsBtn.addEventListener('click', clearSearch);

    if (el.toggleFiltersBtn) el.toggleFiltersBtn.addEventListener('click', () => {
        el.advancedFilters.style.display = el.advancedFilters.style.display === 'block' ? 'none' : 'block';
    });
    if (el.applyFiltersBtn) el.applyFiltersBtn.addEventListener('click', applyFilters);
    if (el.resetFiltersBtn) el.resetFiltersBtn.addEventListener('click', resetFilters);

    [el.prevPageBtn, el.prevPageBtnBottom].forEach(btn => btn && btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (STATE.page > 1 && !STATE.isLoading) {
            STATE.page--;
            handlePaginationForCurrentTab();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }));
    [el.nextPageBtn, el.nextPageBtnBottom].forEach(btn => btn && btn.addEventListener('click', (e) => {
        e.preventDefault();
        const maxPages = Math.ceil(STATE.totalManga / STATE.limit);
        if (STATE.page < maxPages && !STATE.isLoading) {
            STATE.page++;
            handlePaginationForCurrentTab();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }));

    if (el.backToGalleryBtn) el.backToGalleryBtn.addEventListener('click', () => {
        // Save current gallery view state to localStorage
        saveViewState('tab', { tab: STATE.currentTab });
        localStorage.setItem('galleryPage', STATE.page);
        localStorage.setItem('galleryTab', STATE.currentTab);

        // Restore tab and page from state
        const lastPage = parseInt(localStorage.getItem('galleryPage'), 10);
        const lastTab = localStorage.getItem('galleryTab');
        if (lastTab && document.querySelector(`.nav-tab[data-view="${lastTab}"]`)) {
            STATE.currentTab = lastTab;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.nav-tab[data-view="${lastTab}"]`).classList.add('active');
        }
        STATE.page = lastPage && lastPage > 0 ? lastPage : 1;
        showView(el.galleryView);
        handlePaginationForCurrentTab();
    });
    if (el.backToDetailsBtn) el.backToDetailsBtn.addEventListener('click', () => {
        if (!STATE.currentManga || !STATE.currentManga.id) {
            showView(el.galleryView);
            loadFeaturedContent();
        } else {
            showMangaDetails(STATE.currentManga.id);
        }
    });

    [el.prevChapterBtn, el.prevChapterBtnBottom].forEach(btn => btn && btn.addEventListener('click', () => {
        if (STATE.currentChapterIndex > 0) showChapterReader(STATE.allChapters[STATE.currentChapterIndex - 1], STATE.currentChapterIndex - 1);
    }));
    [el.nextChapterBtn, el.nextChapterBtnBottom].forEach(btn => btn && btn.addEventListener('click', () => {
        if (STATE.currentChapterIndex < STATE.allChapters.length - 1) showChapterReader(STATE.allChapters[STATE.currentChapterIndex + 1], STATE.currentChapterIndex + 1);
    }));

    document.addEventListener('click', (e) => {
        if (!el.searchInput.contains(e.target) && !el.searchSuggestions.contains(e.target)) hideSearchSuggestions();
    });

    // For label text on tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            const view = this.getAttribute('data-view');
            if (!el.labels) return;
            switch (view) {
                case 'featured': el.labels.textContent = 'Explore Manga'; break;
                case 'popular': el.labels.textContent = 'Popular Manga'; break;
                case 'recent-updates': el.labels.textContent = 'Recent Updates'; break;
                case 'new-releases': el.labels.textContent = 'New Releases'; break;
                default: el.labels.textContent = 'Explore Manga';
            }
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// =================== INIT ===================
// ... (keep your definitions above as is)

function initializeApp() {
    const required = [
        { element: el.mangaList, name: 'manga-list' },
        { element: el.galleryView, name: 'gallery-view' },
        { element: el.mangaDetailsView, name: 'manga-details-view' },
        { element: el.chapterReaderView, name: 'chapter-reader-view' }
    ];
    const missing = required.filter(i => !i.element);
    if (missing.length) {
        if (el.mangaList) el.mangaList.innerHTML = '<div class="error">Missing required DOM elements. Please check your HTML.</div>';
        return;
    }
    try {
        setupThemeToggle();
        populateYearFilter();

        // Restore from state if available
        let restored = false;
        const view = localStorage.getItem('currentView');
        const mangaId = localStorage.getItem('currentMangaId');
        const chapterId = localStorage.getItem('currentChapterId');
        const chapterIndex = localStorage.getItem('currentChapterIndex');
        // Unified logic for tab restore
        const savedTab = localStorage.getItem('currentTab');
        const lastPage = parseInt(localStorage.getItem('galleryPage'), 10);

        // Restore tab selection
        let validTab = savedTab && document.querySelector(`.nav-tab[data-view="${savedTab}"]`);
        if (validTab) {
            STATE.currentTab = savedTab;
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.nav-tab[data-view="${STATE.currentTab}"]`).classList.add('active');
        } else {
            STATE.currentTab = 'featured';
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            if (document.querySelector(`.nav-tab[data-view="featured"]`)) {
                document.querySelector(`.nav-tab[data-view="featured"]`).classList.add('active');
            }
        }

        setupTabNavigation();
        setupEventListeners();
        setupSmartHeader();

        // Reader view restore
        if (view === 'reader' && mangaId && chapterId && chapterIndex !== null) {
        showView(el.chapterReaderView);
        fetchMangaDetails(mangaId)
            .then(manga => {
                STATE.currentManga = manga;
                return fetchChapters(mangaId, 0, API.CHAPTER_LIMIT);
            })
            .then(({ chapters }) => {
                STATE.allChapters = chapters;
                const idx = Number(chapterIndex);
                let chapter = chapters.find(c => c.id === chapterId);
                if (!chapter && idx >= 0 && idx < chapters.length) {
                    chapter = chapters[idx];
                }
                if (chapter) {
                    // Restore last-read page for this chapter
                    const savedPageKey = `readerPage_${chapter.id}`;
                    let pageToScroll = 0;
                    const savedPage = localStorage.getItem(savedPageKey);
                    if (savedPage && !isNaN(savedPage)) {
                        pageToScroll = parseInt(savedPage, 10);
                    }
                    showChapterReader(chapter, idx); // showChapterReader will handle restore
                } else {
                    showView(el.galleryView);
                    handlePaginationForCurrentTab();
                }
            })
            .catch(() => {
                showView(el.galleryView);
                handlePaginationForCurrentTab();
            });
        restored = true;
    }
        // Details view restore
        else if (view === 'details' && mangaId) {
            showView(el.mangaDetailsView);
            showMangaDetails(mangaId).catch(() => {
                showView(el.galleryView);
                handlePaginationForCurrentTab();
            });
            restored = true;
        }
        // Tab (gallery) restore (always fall back to this logic)
        if (!restored) {
            // Restore page number if available
            STATE.page = (lastPage && lastPage > 0) ? lastPage : 1;
            showView(el.galleryView);
            handlePaginationForCurrentTab();
        }
    } catch (error) {
        if (el.mangaList) el.mangaList.innerHTML = `<div class="error" style="grid-column: 1 / -1;"><h3>Initialization Failed</h3><p>${error.message}</p><button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">Reload Page</button></div>`;
    }
}

// =================== GLOBALS/DEBUG ===================
window.clearSearch = clearSearch;
window.performSearch = performSearch;
window.debugState = function () {
    console.log('🔍 Debug State:', {
        currentPage: STATE.page,
        totalManga: STATE.totalManga,
        isLoading: STATE.isLoading,
        isSearchMode: STATE.isSearchMode,
        currentSearchQuery: STATE.currentSearchQuery,
        filtersActive: STATE.filtersActive,
        currentFilters: STATE.filters,
        currentManga: STATE.currentManga?.id,
        currentChapter: STATE.currentChapter?.id,
        currentChapterIndex: STATE.currentChapterIndex,
        totalChapters: STATE.allChapters.length,
        currentProxy: getCurrentProxy().name,
        queueLength: requestQueue.length,
        isProcessingQueue,
        apiLimits: {
            manga: STATE.limit,
            chapters: API.CHAPTER_LIMIT,
            maximum: API.MAX_LIMIT
        }
    });
};
window.switchProxy = function () { switchToNextProxy(); };
window.testUrl = function (url) {
    fetchWithProxy(url).then(data => { console.log('✅ Test successful:', data); }).catch(error => { console.error('❌ Test failed:', error); });
};


// =================== ERROR HANDLING ===================
window.addEventListener('error', (event) => { hideLoading(); });
window.addEventListener('unhandledrejection', (event) => { hideLoading(); event.preventDefault(); });

// =================== STARTUP ===================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

async function renderRandomMangaList(page) {
    if (STATE.isLoading) return;
    STATE.isLoading = true;
    el.mangaList.innerHTML = '<div class="loading">Loading random manga...</div>';
    try {
        const response = await fetchRandomMangaList(page);
        const { data: mangaList, total } = response;
        STATE.totalManga = total;
        if (!mangaList.length) {
            el.mangaList.innerHTML = '<div class="error">No random manga found for this page.</div>';
            updatePaginationInfo(page, total);
            return;
        }
        el.mangaList.innerHTML = '';
        await batchCards(mangaList, el.mangaList, 4);
        updatePaginationInfo(page, total);
    } catch (error) {
        el.mangaList.innerHTML = `<div class="error">Failed to load random manga: ${error.message}</div>`;
    } finally {
        STATE.isLoading = false;
    }
}